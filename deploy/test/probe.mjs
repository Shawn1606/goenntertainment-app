// The client side of the stack test (deploy/test/stack.test.mjs). CI AND LOCAL TESTS ONLY.
//
// Runs inside the `probe` service of deploy/docker-compose.ci.yml (profile `test`): a container
// on the edge network next to caddy, so its requests arrive at caddy the way a visitor's do,
// from the probe's own address. It talks to caddy and nothing else.
//
//   node probe.mjs --idle     keeps the container running (the test runs the requests with exec)
//   node probe.mjs            reads one JSON job on stdin, sends its requests, prints one JSON
//                             result on stdout
//
// A job: { requests: [request, ...] }. A request:
//   { method = 'GET', path, scheme = 'https' | 'http', headers = {}, body?: string,
//     bodyBase64?: string, repeat?: n, concurrency?: n }
// `path` is sent exactly as written (no clean-up of `..`, `//` or escapes). With `repeat`, the same
// request is sent n times (`concurrency` at once) and only the statuses come back.
// A result: { address, results: [{ status, headers, body, bodyBytes, bodySha256 } |
//   { statuses: [...] } | { error }] }. `body` is the first 64 KiB as UTF-8 text; the test never
// prints a body that may hold a token.
//
// TLS: DOMAIN is localhost in CI (deploy/ci.env), and caddy serves it with its own internal
// certificate authority, which nothing here trusts; the certificate is therefore not verified.
// Test use only.
import { Buffer } from 'node:buffer';
import crypto from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';

const EDGE_HOST = 'caddy';
const BODY_LIMIT = 64 * 1024;

const domain = process.env.DOMAIN;

/** The probe's IPv4 addresses (one per network it sits on). */
function ownAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

const agents = {
  https: new https.Agent({ keepAlive: true, maxSockets: 16, rejectUnauthorized: false }),
  http: new http.Agent({ keepAlive: true, maxSockets: 16 }),
};

/** One request to caddy; resolves with the answer or { error }. */
function send(spec) {
  const scheme = spec.scheme === 'http' ? 'http' : 'https';
  const body = spec.bodyBase64 !== undefined
    ? Buffer.from(spec.bodyBase64, 'base64')
    : spec.body !== undefined ? Buffer.from(String(spec.body), 'utf8') : null;
  const headers = { Host: domain, ...(spec.headers ?? {}) };
  if (body) headers['Content-Length'] = String(body.length);
  const options = {
    host: EDGE_HOST,
    port: scheme === 'https' ? 443 : 80,
    method: spec.method ?? 'GET',
    path: spec.path,
    headers,
    agent: agents[scheme],
  };
  if (scheme === 'https') options.servername = domain;
  const lib = scheme === 'https' ? https : http;
  return new Promise((resolve) => {
    const req = lib.request(options, (res) => {
      const chunks = [];
      let size = 0;
      const hash = crypto.createHash('sha256');
      res.on('data', (chunk) => {
        hash.update(chunk);
        if (size < BODY_LIMIT) chunks.push(chunk);
        size += chunk.length;
      });
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).subarray(0, BODY_LIMIT).toString('utf8'),
        bodyBytes: size,
        bodySha256: hash.digest('hex'),
      }));
      res.on('error', (err) => resolve({ error: err.code ?? err.message }));
    });
    req.setTimeout(60_000, () => req.destroy(new Error('timeout')));
    req.on('error', (err) => resolve({ error: err.code ?? err.message }));
    req.end(body ?? undefined);
  });
}

/** The same request `repeat` times, `concurrency` at once: the statuses in sending order. */
async function burst(spec) {
  const statuses = new Array(spec.repeat);
  let next = 0;
  const worker = async () => {
    while (next < spec.repeat) {
      const i = next;
      next += 1;
      const r = await send(spec);
      statuses[i] = r.error ? `error:${r.error}` : r.status;
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, spec.concurrency ?? 1) }, worker));
  return { statuses };
}

async function runJob(job) {
  const results = [];
  for (const spec of job.requests ?? []) {
    results.push(spec.repeat ? await burst(spec) : await send(spec));
  }
  return { address: ownAddresses(), results };
}

if (process.argv.includes('--idle')) {
  // Stays up until the test stops the container.
  const stop = () => process.exit(0);
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  setInterval(() => {}, 1 << 30);
} else {
  if (!domain) {
    console.error('probe: DOMAIN is not set');
    process.exit(2);
  }
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => { input += c; });
  process.stdin.on('end', async () => {
    const result = await runJob(JSON.parse(input));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    for (const agent of Object.values(agents)) agent.destroy();
  });
}
