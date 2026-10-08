/**
 * Request bodies (F-02, F-38): small limits, and an unreadable or oversized body is the client's
 * fault - 400, 413 or 415 with a German message, never a 500 - and the raw text of a request never
 * reaches the log.
 *
 * Body parsing runs before any route, so most requests here need no account: an unauthenticated
 * POST to any /api path is parsed first. The messages are literals on purpose (the app shows them
 * verbatim; src/client-errors.js is their one source in the server).
 *
 * The same holds for a route parameter that is not valid percent-encoding: Express decodes it while
 * matching the route, before any handler runs.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';

import { createApp } from '../src/app.js';
import { FUNCTIONAL_WRITE_LIMITS } from './support/app.js';
import { ensureSchema, pool } from '../src/db.js';
import { cleanup, createUser } from './support/fixtures.js';

const MSG_NOT_JSON = 'Die Anfrage ist kein gültiges JSON.';
const MSG_TOO_LARGE = 'Die Anfrage ist zu groß.';
const MSG_UNSUPPORTED = 'Dieses Format wird nicht unterstützt.';
const MSG_UNREADABLE = 'Die Anfrage konnte nicht gelesen werden.';

/** Obviously fake marker that must never show up in the log. */
const CANARY = 'canary-limits-7f3a9c-not-a-secret';

let base;
let server;

/** Everything written to the console or to stdout/stderr while `fn` runs (passed through as well). */
async function captureOutput(fn) {
  const lines = [];
  const methods = ['log', 'info', 'warn', 'error', 'debug', 'trace'];
  const savedConsole = Object.fromEntries(methods.map((m) => [m, console[m]]));
  const savedOut = process.stdout.write;
  const savedErr = process.stderr.write;
  for (const m of methods) {
    console[m] = (...args) => {
      lines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a, Object.getOwnPropertyNames(a ?? {})))).join(' '));
      return savedConsole[m].apply(console, args);
    };
  }
  process.stdout.write = function write(chunk, ...rest) {
    lines.push(String(chunk));
    return savedOut.call(this, chunk, ...rest);
  };
  process.stderr.write = function write(chunk, ...rest) {
    lines.push(String(chunk));
    return savedErr.call(this, chunk, ...rest);
  };
  try {
    await fn();
  } finally {
    for (const m of methods) console[m] = savedConsole[m];
    process.stdout.write = savedOut;
    process.stderr.write = savedErr;
  }
  // Let late writes (an error logged after the response) land before the caller looks.
  await new Promise((resolve) => setTimeout(resolve, 50));
  return lines.join('\n');
}

const post = (path, body, headers) => fetch(`${base}${path}`, { method: 'POST', headers, body });
const postJson = (path, text, extra = {}) =>
  post(path, text, { 'Content-Type': 'application/json', Accept: 'application/json', ...extra });

/** A syntactically valid JSON text of about `bytes` bytes. */
const jsonOfSize = (bytes, key = 'note') => JSON.stringify({ [key]: 'x'.repeat(bytes) });

before(async () => {
  await ensureSchema();
  const app = createApp({ writeLimits: FUNCTIONAL_WRITE_LIMITS });
  // Test-only route behind the app's body parsers: shows what they made of a body.
  app.post('/test-only/echo', (req, res) => res.json({ body: req.body ?? null }));
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  try {
    await cleanup();
  } finally {
    await pool.end();
    server?.close();
  }
});

test('malformed JSON is answered with 400 and a German message, not 500', async () => {
  const res = await postJson('/api/posts/1/comments', '{"body": "Hallo",');
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { message: MSG_NOT_JSON });
});

test('a JSON body with an unsupported charset is answered with 415', async () => {
  const res = await post('/api/groups', '{"name":"x"}', { 'Content-Type': 'application/json; charset=latin1' });
  assert.equal(res.status, 415);
  assert.deepEqual(await res.json(), { message: MSG_UNSUPPORTED });
});

test('a body with an unsupported content encoding is answered with 415', async () => {
  const res = await post('/api/groups', '{"name":"x"}', {
    'Content-Type': 'application/json',
    'Content-Encoding': 'x-unknown-coding',
  });
  assert.equal(res.status, 415);
  assert.deepEqual(await res.json(), { message: MSG_UNSUPPORTED });
});

/** What log.js prints for a logged error or warning (its line prefixes). */
const LOG_LINE = /\[(?:error|warn)\]/;

test('a valid gzip or deflate body is still read', async () => {
  for (const [encoding, pack] of [['gzip', zlib.gzipSync], ['deflate', zlib.deflateSync]]) {
    const res = await post('/test-only/echo', pack(JSON.stringify({ name: 'gepackt' })), {
      'Content-Type': 'application/json',
      'Content-Encoding': encoding,
    });
    assert.equal(res.status, 200, encoding);
    assert.deepEqual((await res.json()).body, { name: 'gepackt' }, encoding);
  }
});

test('a compressed body that cannot be unpacked is answered with 400, not 500, and not logged', async () => {
  const json = { 'Content-Type': 'application/json' };
  const form = { 'Content-Type': 'application/x-www-form-urlencoded' };
  const packed = zlib.gzipSync(JSON.stringify({ password: CANARY, pad: 'x'.repeat(200) }));
  const cases = [
    ['gzip announced, plain text sent', `{"password":"${CANARY}"}`, { ...json, 'Content-Encoding': 'gzip' }],
    ['truncated gzip', packed.subarray(0, 20), { ...json, 'Content-Encoding': 'gzip' }],
    ['deflate announced, plain text sent', `{"password":"${CANARY}"}`, { ...json, 'Content-Encoding': 'deflate' }],
    ['urlencoded, gzip announced, plain text sent', `password=${CANARY}`, { ...form, 'Content-Encoding': 'gzip' }],
  ];
  const answers = [];
  const output = await captureOutput(async () => {
    for (const [name, body, headers] of cases) {
      const res = await post('/api/posts', body, headers);
      answers.push([name, res.status, (await res.json()).message]);
    }
  });
  assert.deepEqual(
    answers,
    cases.map(([name]) => [name, 400, MSG_UNREADABLE]),
  );
  assert.doesNotMatch(output, LOG_LINE, 'a client error was logged as a server error');
  assert.ok(!output.includes(CANARY), 'the request text was written to the log');
});

test('a route parameter that is not valid percent-encoding is answered with 400 and its text is never logged', async () => {
  // Express decodes route parameters while it matches the route (before requireAuth), so no account
  // is needed; the canary stands for whatever text the parameter carried.
  const cases = [
    ['GET', `/api/users/${CANARY}%E0%A4%A`],
    ['POST', `/api/posts/${CANARY}%ZZ/like`],
  ];
  const answers = [];
  const output = await captureOutput(async () => {
    for (const [method, path] of cases) {
      const res = await fetch(`${base}${path}`, { method, headers: { Accept: 'application/json' } });
      answers.push([`${method} ${path}`, res.status, (await res.json()).message]);
    }
  });
  assert.deepEqual(
    answers,
    cases.map(([method, path]) => [`${method} ${path}`, 400, MSG_UNREADABLE]),
  );
  assert.doesNotMatch(output, LOG_LINE, 'a client error was logged as a server error');
  assert.ok(!output.includes(CANARY), 'the raw parameter text was written to the log');
});

test('JSON bodies are limited to 32 KB: 31 KB passes the parser, 40 KB is answered with 413', async () => {
  const fits = await postJson('/api/groups', jsonOfSize(31 * 1024));
  assert.equal(fits.status, 401, 'parsed, then refused for the missing token');
  const res = await postJson('/api/groups', jsonOfSize(40 * 1024));
  assert.equal(res.status, 413);
  assert.deepEqual(await res.json(), { message: MSG_TOO_LARGE });
});

test('a JSON body over the old 100 KB default is a 413, not a 500', async () => {
  const res = await postJson('/api/groups', jsonOfSize(150 * 1024));
  assert.equal(res.status, 413);
  assert.deepEqual(await res.json(), { message: MSG_TOO_LARGE });
});

test('urlencoded bodies are limited to 16 KB and 50 fields', async () => {
  const form = { 'Content-Type': 'application/x-www-form-urlencoded' };
  const big = await post('/api/groups', `name=${'x'.repeat(20 * 1024)}`, form);
  assert.equal(big.status, 413);
  assert.deepEqual(await big.json(), { message: MSG_TOO_LARGE });

  const many = await post('/api/groups', Array.from({ length: 51 }, (_, i) => `f${i}=1`).join('&'), form);
  assert.equal(many.status, 413);
  assert.deepEqual(await many.json(), { message: MSG_TOO_LARGE });

  const fifty = await post('/api/groups', Array.from({ length: 50 }, (_, i) => `f${i}=1`).join('&'), form);
  assert.equal(fifty.status, 401, '50 fields are parsed, then refused for the missing token');
});

test('100,000-character JSON and urlencoded values are refused with 413 in under 1 s', async () => {
  for (const [body, type] of [
    [JSON.stringify({ name: 'x'.repeat(100_000) }), 'application/json'],
    [`name=${'x'.repeat(100_000)}`, 'application/x-www-form-urlencoded'],
  ]) {
    const started = performance.now();
    const res = await post('/api/groups', body, { 'Content-Type': type });
    const ms = performance.now() - started;
    assert.equal(res.status, 413, type);
    assert.equal((await res.json()).message, MSG_TOO_LARGE, type);
    assert.ok(ms < 1000, `${type}: ${ms.toFixed(0)} ms`);
  }
});

test('urlencoded bodies stay flat: bracketed names are not turned into nested objects', async () => {
  const res = await post('/test-only/echo', 'a[b][c]=1&list[]=2', { 'Content-Type': 'application/x-www-form-urlencoded' });
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).body, { 'a[b][c]': '1', 'list[]': '2' });
});

test('the RevenueCat webhook has its own JSON limit: 64 KB is parsed, 200 KB is a 413', async () => {
  const fits = await postJson('/api/webhooks/revenuecat', jsonOfSize(64 * 1024, 'event'));
  assert.notEqual(fits.status, 413);
  assert.ok(fits.status < 500 || fits.status === 503, `64 KB answered ${fits.status}`);
  const res = await postJson('/api/webhooks/revenuecat', jsonOfSize(200 * 1024, 'event'));
  assert.equal(res.status, 413);
  assert.deepEqual(await res.json(), { message: MSG_TOO_LARGE });
});

test('request bodies never reach the log: malformed and oversized bodies', async () => {
  const statuses = [];
  const output = await captureOutput(async () => {
    statuses.push((await postJson('/api/groups', `{"password":"${CANARY}","name":`)).status);
    statuses.push((await postJson('/api/groups', JSON.stringify({ password: CANARY, pad: 'x'.repeat(150 * 1024) }))).status);
    const fields = `password=${CANARY}&${Array.from({ length: 60 }, (_, i) => `f${i}=1`).join('&')}`;
    statuses.push((await post('/api/groups', fields, { 'Content-Type': 'application/x-www-form-urlencoded' })).status);
  });
  // The log first: that is what this test is about; the statuses are covered above as well.
  assert.ok(!output.includes(CANARY), 'the request text was written to the log');
  assert.deepEqual(statuses, [400, 413, 413]);
});

test('request data never reaches the log when a route fails on the database', async () => {
  // A title sent as a JSON list passes the route's length check and reaches the INSERT, where the
  // driver expands it into a value list and MySQL refuses the statement. Whatever the outcome
  // (today a 500), the statement with its values must not be logged.
  const { token } = await createUser('bodylogsql', { accountType: 'creator' });
  let status = 0;
  const output = await captureOutput(async () => {
    const res = await postJson(
      '/api/activities',
      JSON.stringify({
        title: [CANARY, 'zweiter Teil'],
        description: 'Beschreibung',
        location: 'Teststrasse 1',
        starts_at: new Date(Date.now() + 86_400_000).toISOString(),
      }),
      { Authorization: `Bearer ${token}` },
    );
    status = res.status;
  });
  assert.ok(!output.includes(CANARY), 'request data (SQL with its values) was written to the log');
  assert.ok(status >= 400, `answered ${status}`);
});
