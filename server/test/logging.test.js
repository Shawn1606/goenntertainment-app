/**
 * Logging (F-38): the server writes to the console only through src/log.js, and what log.js
 * prints never carries request data - no request body, no SQL text, no driver message, no quoted
 * input. No database needed.
 *
 * The first test reads the source files; it imports nothing, so it runs against any version of
 * the server. The others load src/log.js and the error handler from src/app.js.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.join(import.meta.dirname, '..', 'src');

/** The one file that may write to the console. */
const LOGGER = 'log.js';

/**
 * Operator-run command-line tools, not part of the request path: they print progress for the
 * person running them (npm run seed, npm run import). Checked below: no server module imports them.
 */
const CLI_EXCLUDED = [
  { path: 'seed.js', reason: 'npm run seed: operator CLI, prints its own progress' },
  { path: 'import', reason: 'npm run import (src/import/run.js and its modules): operator CLI' },
];

const OUTPUT = /\bconsole\s*(?:\.\s*\w+|\[)|\bprocess\s*\.\s*(?:stdout|stderr)\s*\.\s*write\b/g;

function sourceFiles(dir, rel = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...sourceFiles(path.join(dir, entry.name), relPath));
    else if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs')) out.push(relPath);
  }
  return out;
}

const isExcluded = (rel) => CLI_EXCLUDED.some((e) => rel === e.path || rel.startsWith(`${e.path}/`));

test('only src/log.js writes to the console (the operator CLIs excepted)', () => {
  const files = sourceFiles(SRC);
  const scanned = files.filter((rel) => !isExcluded(rel) && rel !== LOGGER);
  assert.ok(scanned.length >= 30, `only ${scanned.length} files scanned`);

  const sites = [];
  for (const rel of scanned) {
    const lines = fs.readFileSync(path.join(SRC, rel), 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      if (line.match(OUTPUT)) sites.push(`src/${rel}:${i + 1}: ${line.trim()}`);
    });
  }
  console.log(`${scanned.length} files under src/ scanned (log.js and ${CLI_EXCLUDED.length} CLI entries excluded), ${sites.length} console sites outside log.js`);
  assert.deepEqual(sites, [], 'write through src/log.js (logError, logWarn, logInfo)');
});

test('the excluded CLIs are not part of the request path: no server module imports them', () => {
  const importers = [];
  for (const rel of sourceFiles(SRC).filter((r) => !isExcluded(r))) {
    const text = fs.readFileSync(path.join(SRC, rel), 'utf8');
    for (const m of text.matchAll(/from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1] ?? m[2]));
      if (isExcluded(target)) importers.push(`src/${rel} -> ${m[1] ?? m[2]}`);
    }
  }
  assert.deepEqual(importers, []);
});

/** Obviously fake marker that must never show up in what log.js prints. */
const CANARY = 'canary-logging-4b1e8d-not-a-secret';

/** What console.error/warn/log print while `fn` runs (not passed through). */
function captured(fn) {
  const lines = [];
  const saved = { error: console.error, warn: console.warn, log: console.log };
  for (const m of Object.keys(saved)) console[m] = (...args) => lines.push(args.map(String).join(' '));
  try {
    fn();
  } finally {
    Object.assign(console, saved);
  }
  return lines.join('\n');
}

/** An error shaped like mysql2's: statement and values in `sql`, the server's text in the message. */
function driverError() {
  const err = new Error(`Duplicate entry '${CANARY}' for key 'users.users_username_unique'`);
  err.code = 'ER_DUP_ENTRY';
  err.errno = 1062;
  err.sqlState = '23000';
  err.sqlMessage = err.message;
  err.sql = `INSERT INTO users (username) VALUES ('${CANARY}')`;
  return err;
}

/** An error shaped like body-parser's for malformed JSON: the raw text in `body`. */
function bodyParserError() {
  const err = new SyntaxError(`Unexpected token in JSON at position 12: {"password":"${CANARY}"`);
  err.type = 'entity.parse.failed';
  err.status = 400;
  err.statusCode = 400;
  err.expose = true;
  err.body = `{"password":"${CANARY}",`;
  return err;
}

test('logError prints code, errno and SQLSTATE of a driver error - not its SQL or message', async () => {
  const { logError } = await import('../src/log.js');
  const out = captured(() => logError('query failed', driverError()));
  assert.ok(!out.includes(CANARY), out);
  assert.match(out, /\[error\] query failed: Error code=ER_DUP_ENTRY errno=1062 sqlState=23000/);
});

test('logError never prints a body-parser error body or a JSON.parse snippet', async () => {
  const { logError, logWarn } = await import('../src/log.js');
  let syntax;
  try {
    JSON.parse(`{"password":"${CANARY}",`);
  } catch (err) {
    syntax = err;
  }
  const out = captured(() => {
    logError('body', bodyParserError());
    logError('parse', syntax);
    logWarn('parse', syntax);
  });
  assert.ok(!out.includes(CANARY), out);
  assert.match(out, /type=entity\.parse\.failed status=400/);
});

test('logError shortens long messages to one line and keeps only the stack frames', async () => {
  const { MAX_MESSAGE, logError } = await import('../src/log.js');
  const err = new Error(`first line\nsecond line ${'y'.repeat(2000)}`);
  const out = captured(() => logError('long', err));
  const [head, ...frames] = out.split('\n');
  assert.ok(head.startsWith('[error] long: Error: first line second line '), head);
  assert.ok(head.length < MAX_MESSAGE + 60, `head is ${head.length} characters`);
  assert.ok(frames.length > 0 && frames.every((line) => /^\s+at /.test(line)), 'only "at ..." frames follow');
});

test('a request is described by its method and route pattern, never by its URL', async () => {
  const { logError } = await import('../src/log.js');
  const req = {
    method: 'GET',
    baseUrl: '/api',
    route: { path: '/users' },
    originalUrl: `/api/users?q=${CANARY}`,
    url: `/users?q=${CANARY}`,
    body: { password: CANARY },
  };
  const out = captured(() => logError('request failed', new Error('boom'), req));
  assert.ok(!out.includes(CANARY), out);
  assert.match(out, /\[error\] request failed GET \/api\/users: Error: boom/);
});

/** A minimal Express response for the error handler. */
function fakeResponse() {
  return {
    headersSent: false,
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
}

test('the error handler answers server errors with 500 and logs them without request data', async () => {
  const { handleError } = await import('../src/app.js');
  const req = { method: 'POST', baseUrl: '/api', route: { path: '/groups' }, body: { name: CANARY } };
  for (const err of [driverError(), Object.assign(new Error('boom'), { body: CANARY, sql: `SELECT '${CANARY}'` })]) {
    const res = fakeResponse();
    const out = captured(() => handleError(err, req, res, () => assert.fail('next() called')));
    assert.equal(res.statusCode, 500);
    assert.deepEqual(res.payload, { message: 'Serverfehler.' });
    assert.ok(!out.includes(CANARY), out);
    assert.match(out, /\[error\] request failed POST \/api\/groups/);
  }
});

test('the error handler answers body-parser errors with their 4xx and logs nothing', async () => {
  const { handleError } = await import('../src/app.js');
  const res = fakeResponse();
  const out = captured(() => handleError(bodyParserError(), { method: 'POST' }, res, () => assert.fail('next() called')));
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.payload, { message: 'Die Anfrage ist kein gültiges JSON.' });
  assert.equal(out, '');
});

/** body-parser's error for a compressed body zlib cannot unpack: createError(400, zlibError), no `type`. */
function unpackError() {
  const err = new Error('incorrect header check');
  err.errno = -3;
  err.code = 'Z_DATA_ERROR';
  err.status = 400;
  err.statusCode = 400;
  err.expose = true;
  return err;
}

/** Express's error for a route parameter that is not valid percent-encoding (it quotes the raw text). */
function paramDecodeError() {
  const err = new URIError(`Failed to decode param '${CANARY}%ZZ'`);
  err.status = 400;
  err.statusCode = 400;
  return err;
}

test('the error handler answers an unpack error or a param-decode error with 400 and logs nothing', async () => {
  const { handleError } = await import('../src/app.js');
  for (const err of [unpackError(), paramDecodeError()]) {
    const res = fakeResponse();
    const out = captured(() => handleError(err, { method: 'POST' }, res, () => assert.fail('next() called')));
    assert.equal(res.statusCode, 400, err.name);
    assert.deepEqual(res.payload, { message: 'Die Anfrage konnte nicht gelesen werden.' }, err.name);
    assert.equal(out, '', err.name);
  }
});

test('the error handler still answers other errors with 500: a URIError without 400, a 4xx not marked for the client', async () => {
  const { handleError } = await import('../src/app.js');
  // A URIError the code raised itself (no status) is the server's fault; so is an error that
  // carries a 4xx status but is not marked as safe to expose.
  const ownUriError = new URIError('URI malformed');
  const unexposed = Object.assign(new Error('boom'), { status: 404 });
  for (const err of [ownUriError, unexposed]) {
    const res = fakeResponse();
    const out = captured(() => handleError(err, { method: 'GET' }, res, () => assert.fail('next() called')));
    assert.equal(res.statusCode, 500, err.message);
    assert.match(out, /\[error\] request failed GET \(no route\)/);
  }
});
