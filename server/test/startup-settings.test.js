/**
 * The server process refuses to start without its required settings and names them, never their
 * values (src/config.js startupProblems, the one gate in src/index.js).
 *
 * Every case starts `node src/index.js` with the complete test environment
 * (test/support/startup-env.js) and changes exactly one input, so only that input can decide the
 * result. The positive control shows that the complete environment does start.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { startupProblems } from '../src/config.js';
import { createUser, deleteTestUsers } from './support/fixtures.js';
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

/**
 * Starts the server and collects its standard output until `pattern` appears (the output so far
 * is returned) or the process exits or the limit passes (null). The process is stopped either way.
 */
function outputUntil(env, pattern) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['src/index.js'], { cwd: SERVER_DIR, env });
    let out = '';
    let done = false;
    const timer = setTimeout(() => finish(null), STARTUP_TIMEOUT_MS);
    function finish(result) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.kill();
      resolve(result);
    }
    child.stdout.on('data', (chunk) => {
      out += chunk;
      if (pattern.test(out)) finish(out);
    });
    child.on('exit', () => finish(null));
  });
}

/** Accounts the retention tests create (removed at the end); the pool is opened on first use. */
const createdUserIds = [];
let db = null;
const database = async () => (db ??= await import('../src/db.js'));

after(async () => {
  if (db === null) return;
  try {
    await deleteTestUsers(db.pool, createdUserIds);
  } finally {
    await db.pool.end();
  }
});

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

test('an invalid SANCTUM_EXPIRATION stops the start, named without its value', () => {
  const broken = '30-test-only-days';
  const r = runToExit(startupEnv({ SANCTUM_EXPIRATION: broken }));
  assert.equal(r.status, 1, `expected exit code 1, got ${r.status} (signal ${r.signal})`);
  assert.match(r.stderr, /SANCTUM_EXPIRATION/);
  assert.doesNotMatch(r.stderr, /NODE_TRUST_PROXY|NODE_INTERNAL_SECRET/, 'only the one invalid setting is named');
  assert.ok(!r.stderr.includes(broken) && !r.stdout.includes(broken), 'the value must never be printed');
  assert.doesNotMatch(r.stdout, START_LINE);
});

test('production refuses to start without ANTHROPIC_API_KEY and names it', () => {
  const r = runToExit(startupEnv({ ANTHROPIC_API_KEY: '' }));
  assert.equal(r.status, 1, `expected exit code 1, got ${r.status} (signal ${r.signal})`);
  assert.match(r.stderr, /ANTHROPIC_API_KEY/);
  assert.doesNotMatch(r.stderr, /NODE_TRUST_PROXY|NODE_INTERNAL_SECRET|MODERATION_ENABLED/, 'only the one missing setting is named');
  assert.doesNotMatch(r.stdout, START_LINE);
});

test('production refuses to start with MODERATION_ENABLED=false and names it', () => {
  const r = runToExit(startupEnv({ MODERATION_ENABLED: 'false' }));
  assert.equal(r.status, 1, `expected exit code 1, got ${r.status} (signal ${r.signal})`);
  assert.match(r.stderr, /MODERATION_ENABLED/);
  assert.doesNotMatch(r.stderr, /NODE_TRUST_PROXY|NODE_INTERNAL_SECRET|ANTHROPIC_API_KEY/, 'only the one setting is named');
  assert.doesNotMatch(r.stdout, START_LINE);
});

test('an invalid MODERATION_FAIL_OPEN stops the start, named without its value', () => {
  const broken = 'yes-test-only';
  const r = runToExit(startupEnv({ MODERATION_FAIL_OPEN: broken }));
  assert.equal(r.status, 1, `expected exit code 1, got ${r.status} (signal ${r.signal})`);
  assert.match(r.stderr, /MODERATION_FAIL_OPEN/);
  assert.ok(!r.stderr.includes(broken) && !r.stdout.includes(broken), 'the value must never be printed');
  assert.doesNotMatch(r.stdout, START_LINE);
});

test('production refuses an ANTHROPIC_BASE_URL that names another host, without printing it', () => {
  const gateway = 'https://gateway.example.invalid/test-only';
  const r = runToExit(startupEnv({ ANTHROPIC_BASE_URL: gateway }));
  assert.equal(r.status, 1, `expected exit code 1, got ${r.status} (signal ${r.signal}): the server started with another host`);
  assert.match(r.stderr, /ANTHROPIC_BASE_URL/);
  assert.doesNotMatch(r.stderr, /NODE_TRUST_PROXY|NODE_INTERNAL_SECRET|ANTHROPIC_API_KEY|MODERATION_/, 'only the one setting is named');
  assert.ok(!r.stderr.includes('gateway.example.invalid') && !r.stdout.includes('gateway.example.invalid'), 'the value must never be printed');
  assert.doesNotMatch(r.stdout, START_LINE);
});

test('production starts with a loopback ANTHROPIC_BASE_URL (the CI stack and the tests use one)', async () => {
  assert.equal(await startsListening(startupEnv({ ANTHROPIC_BASE_URL: 'http://localhost:9' })), true);
});

test("the provider's own address passes the startup gate", () => {
  // Checked through the gate itself, not by starting a server: a started test server is never
  // pointed at the real provider.
  assert.deepEqual(startupProblems(startupEnv({ ANTHROPIC_BASE_URL: 'https://api.anthropic.com' })), []);
});

test('outside production MODERATION_ENABLED=false and an empty key do not stop the start', async () => {
  const env = startupEnv({ NODE_ENV: 'development', ANTHROPIC_API_KEY: '', MODERATION_ENABLED: 'false' });
  assert.equal(await startsListening(env), true);
});

test('outside production empty NODE_TRUST_PROXY and NODE_INTERNAL_SECRET do not stop the start', async () => {
  const env = startupEnv({ NODE_ENV: 'development', NODE_TRUST_PROXY: '', NODE_INTERNAL_SECRET: '' });
  assert.equal(await startsListening(env), true);
});

/* ------------------------------------------------------------- retention (F-16) */

const RETENTION_KEYS = [
  'EVIDENCE_RETENTION_DAYS',
  'MODERATION_REPORT_RETENTION_DAYS',
  'TOKEN_RETENTION_DAYS',
  'USAGE_RETENTION_DAYS',
];
const NO_RETENTION = Object.fromEntries(RETENTION_KEYS.map((key) => [key, '']));

test('production refuses to start without the retention settings and names all four', () => {
  const r = runToExit(startupEnv(NO_RETENTION));
  assert.equal(r.status, 1, `expected exit code 1, got ${r.status} (signal ${r.signal}): the server started without retention settings`);
  for (const key of RETENTION_KEYS) assert.match(r.stderr, new RegExp(key), `${key} is not named`);
  assert.doesNotMatch(r.stderr, /NODE_TRUST_PROXY|NODE_INTERNAL_SECRET/, 'only the missing settings are named');
  assert.doesNotMatch(r.stdout, START_LINE);
});

test('a usage retention shorter than the streak window stops the start, named without its value', () => {
  const r = runToExit(startupEnv({ USAGE_RETENTION_DAYS: '119' }));
  assert.equal(r.status, 1, `expected exit code 1, got ${r.status} (signal ${r.signal})`);
  assert.match(r.stderr, /USAGE_RETENTION_DAYS/);
  for (const key of RETENTION_KEYS.filter((k) => k !== 'USAGE_RETENTION_DAYS')) {
    assert.doesNotMatch(r.stderr, new RegExp(key), 'only the one invalid setting is named');
  }
  assert.ok(!r.stderr.includes('119') && !r.stdout.includes('119'), 'the value must never be printed');
  assert.doesNotMatch(r.stdout, START_LINE);
});

test('outside production without retention settings the server starts and prunes nothing', async () => {
  const out = await outputUntil(startupEnv({ NODE_ENV: 'development', ...NO_RETENTION }), /Retention prune/);
  assert.ok(out !== null, 'the server never said whether it prunes');
  assert.match(out, /Retention prune off/);
  assert.doesNotMatch(out, /Retention prune:/);
});

test('with the retention settings the server prunes once at start', async () => {
  const { pool, first } = await database();
  // An active day older than the test retention (ten years, support/startup-env.js) of a
  // throw-away account: the first prune after the start removes it.
  const { user } = await createUser('zstartret', { created: createdUserIds });
  await pool.query("INSERT INTO user_active_days (user_id, day) VALUES (?, '2015-01-01')", [user.id]);

  const out = await outputUntil(startupEnv(), /Retention prune: .*\n/);
  assert.ok(out !== null, 'the server never logged a retention prune');
  for (const key of ['tokens', 'activityViews', 'activeDays', 'evidenceImages', 'moderationReports', 'filesRemoved', 'filesFailed']) {
    assert.match(out, new RegExp(`Retention prune: .*\\b${key}=\\d+`), `the log line has no count for ${key}`);
  }
  assert.equal(
    await first('SELECT day FROM user_active_days WHERE user_id = ?', [user.id]),
    null,
    'the aged active day is still there',
  );
});
