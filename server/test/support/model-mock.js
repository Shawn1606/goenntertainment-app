/**
 * A local stand-in for the model provider's Messages API, for the moderation tests (F-06).
 *
 * The server's moderation talks to the provider through its SDK, which takes its address from
 * ANTHROPIC_BASE_URL. The tests point that at this server on 127.0.0.1, so no request can leave
 * the machine: assertLoopbackBaseUrl() refuses any other address before a test sends anything,
 * and every test asserts that its request reached this stand-in.
 *
 * Each request is recorded (path, headers, parsed JSON body). The answer is chosen per test with
 * `respond(...answers)`: each request takes the first answer while more than one is left, the last
 * one answers every request after that. An answer is one of:
 *   { verdict: {...} }      200, a reply whose text is the verdict as JSON (stop_reason end_turn)
 *   { status: 500 }         an error status (x-should-retry: false, so the SDK does not retry);
 *                           `errorType` and `message` set the error body (defaults: api_error and
 *                           a fixed test text)
 *   { refusal: true }       200 with stop_reason 'refusal' and no text
 *   { hang: true }          no answer at all (the SDK's time limit ends the call)
 *   { stall: true }         200 headers and the start of a reply, then nothing more (only a time
 *                           limit that covers the reply's body ends the call)
 *   { drop: true }          200 headers and the start of a reply, then the connection is closed
 *
 * closedLoopbackUrl() gives a loopback address where nothing listens, for a refused connection.
 */
import http from 'node:http';
import net from 'node:net';

/** Accepted moderation addresses in tests: the loopback interface, with a port. */
const LOOPBACK_URL = /^http:\/\/(127\.0\.0\.1|\[::1\]):\d+\/?$/;

/** Throws unless `url` is a loopback http address with a port (the tests' only allowed target). */
export function assertLoopbackBaseUrl(url) {
  if (!LOOPBACK_URL.test(String(url ?? ''))) {
    throw new Error('ANTHROPIC_BASE_URL in a test must be a loopback address (http://127.0.0.1:<port>)');
  }
  return url;
}

/**
 * A loopback address where nothing listens: a free port is taken and given back at once, so a
 * request to it is refused (ECONNREFUSED) and never leaves the machine.
 */
export async function closedLoopbackUrl() {
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return assertLoopbackBaseUrl(`http://127.0.0.1:${port}`);
}

/** The first bytes of a reply, as the stall and drop answers send them before they stop. */
const REPLY_START = '{"id":"msg_test_partial","type":"message","role":"assistant","content":[';

/** A verdict as the provider returns it inside the reply text. */
export function verdict({ severity = 0, fields = [], categories = [], reason = 'Unbedenklich.' } = {}) {
  return { youth_safe: severity === 0, severity, categories, fields, reason };
}

/** Starts the stand-in on a free loopback port. */
export async function startModelMock() {
  const requests = [];
  const hanging = new Set();
  let answers = [{ verdict: verdict() }];

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      let body = null;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        body = null;
      }
      requests.push({ method: req.method, path: req.url, headers: req.headers, body });
      const next = answers.length > 1 ? answers.shift() : answers[0];

      if (next.hang) {
        hanging.add(res);
        res.on('close', () => hanging.delete(res));
        return;
      }
      if (next.stall || next.drop) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.write(REPLY_START);
        if (next.drop) {
          // Once the start has gone out: the connection breaks in the middle of the reply.
          setTimeout(() => res.socket?.destroy(), 50);
        } else {
          hanging.add(res);
          res.on('close', () => hanging.delete(res));
        }
        return;
      }
      if (next.status) {
        res.writeHead(next.status, { 'content-type': 'application/json', 'x-should-retry': 'false' });
        const error = { type: next.errorType ?? 'api_error', message: next.message ?? 'test stand-in error' };
        res.end(JSON.stringify({ type: 'error', error }));
        return;
      }
      const content = next.refusal ? [] : [{ type: 'text', text: JSON.stringify(next.verdict) }];
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          id: `msg_test_${requests.length}`,
          type: 'message',
          role: 'assistant',
          model: body?.model ?? 'test-model',
          content,
          stop_reason: next.refusal ? 'refusal' : 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      );
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;

  return {
    url,
    requests,
    /** The answers for the following requests, in order (the last one repeats). */
    respond(...next) {
      if (next.length === 0) throw new Error('respond() needs at least one answer');
      answers = next;
    },
    /** Requests that reached the Messages endpoint (any API version prefix). */
    messageCalls() {
      return requests.filter((r) => r.method === 'POST' && /\/v1\/messages(\?|$)/.test(r.path));
    },
    async close() {
      for (const res of hanging) res.destroy();
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
