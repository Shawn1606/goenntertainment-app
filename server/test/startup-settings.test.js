/**
 * The server process refuses to start without its required settings and names them, never their
 * values (src/config.js startupProblems, the one gate in src/index.js).
 *
 * Every case starts `node src/index.js` with the complete test environment
 * (test/support/startup-env.js) and changes exactly one input, so only that input can decide the
 * result. The positive control shows that the complete environment does start.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { startupEnv } from './support/startup-env.js';

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const START_LINE = /Goenntertainment-Backend laeuft/;
/**
 * Generous on purpose: loading the server's modules takes well under a second on CI, but many
 * seconds from a slow mounted folder. A server that never stops is ended at this limit.
 */
const STARTUP_TIMEOUT_MS = 90_000;

/** Starts the server and waits for it to exit (a server that keeps running is stopped after the limit). */
function runToExit(env) {
  return spawnSync(process.execPath, ['src/index.js'], { cwd: SERVER_DIR, env, encoding: 'utf8', timeout: STARTUP_TIMEOUT_MS });
}

/** Starts the server and resolves true once it listens, false if it exits first (stopped either way). */
function startsListening(env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['src/index.js'], { cwd: SERVER_DIR, env });
    let out = '';
    let done = false;
    const timer = setTimeout(() => finish(false), STARTUP_TIMEOUT_MS);
    function finish(result) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.kill();
      resolve(result);
    }
    child.stdout.on('data', (chunk) => {
      out += chunk;
      if (START_LINE.test(out)) finish(true);
    });
    child.on('exit', () => finish(false));
  });
}

test('the complete test environment starts (positive control)', async () => {
  assert.equal(await startsListening(startupEnv()), true);
});

test('production refuses to start without NODE_TRUST_PROXY and names it', () => {
  const r = runToExit(startupEnv({ NODE_TRUST_PROXY: '' }));
  assert.equal(r.status, 1, `expected exit code 1, got ${r.status} (signal ${r.signal})`);
  assert.match(r.stderr, /NODE_TRUST_PROXY/);
  assert.doesNotMatch(r.stderr, /NODE_INTERNAL_SECRET/, 'only the one missing setting is named');
  assert.doesNotMatch(r.stdout, START_LINE);
});

test('a NODE_TRUST_PROXY that trusts every address is refused', () => {
  const r = runToExit(startupEnv({ NODE_TRUST_PROXY: '0.0.0.0/0' }));
  assert.equal(r.status, 1, `expected exit code 1, got ${r.status} (signal ${r.signal})`);
  assert.match(r.stderr, /NODE_TRUST_PROXY/);
  assert.ok(!r.stderr.includes('0.0.0.0/0'), 'the value must never be printed');
});

test('production refuses to start without NODE_INTERNAL_SECRET and names it', () => {
  const r = runToExit(startupEnv({ NODE_INTERNAL_SECRET: '' }));
  assert.equal(r.status, 1, `expected exit code 1, got ${r.status} (signal ${r.signal})`);
  assert.match(r.stderr, /NODE_INTERNAL_SECRET/);
  assert.doesNotMatch(r.stderr, /NODE_TRUST_PROXY/, 'only the one missing setting is named');
  assert.doesNotMatch(r.stdout, START_LINE);
});

test('a too short NODE_INTERNAL_SECRET is refused without printing it', () => {
  const tooShort = 'short-test-only-value';
  const r = runToExit(startupEnv({ NODE_INTERNAL_SECRET: tooShort }));
  assert.equal(r.status, 1, `expected exit code 1, got ${r.status} (signal ${r.signal})`);
  assert.match(r.stderr, /NODE_INTERNAL_SECRET/);
  assert.ok(!r.stderr.includes(tooShort) && !r.stdout.includes(tooShort), 'the value must never be printed');
});

test('an invalid write limit setting stops the start, named without its value', () => {
  const broken = 'user:test-only-broken-rule';
  const r = runToExit(startupEnv({ WRITE_LIMIT_MODERATED: broken }));
  assert.equal(r.status, 1, `expected exit code 1, got ${r.status} (signal ${r.signal})`);
  assert.match(r.stderr, /WRITE_LIMIT_MODERATED/);
  assert.doesNotMatch(r.stderr, /NODE_TRUST_PROXY|NODE_INTERNAL_SECRET/, 'only the one invalid setting is named');
  assert.ok(!r.stderr.includes(broken) && !r.stdout.includes(broken), 'the value must never be printed');
  assert.doesNotMatch(r.stdout, START_LINE);
});

test('outside production empty NODE_TRUST_PROXY and NODE_INTERNAL_SECRET do not stop the start', async () => {
  const env = startupEnv({ NODE_ENV: 'development', NODE_TRUST_PROXY: '', NODE_INTERNAL_SECRET: '' });
  assert.equal(await startsListening(env), true);
});
