/**
 * The global daily budget of AI moderation calls (F-07, src/moderation.js reserveModelCall),
 * against the local stand-in for the model provider (test/support/model-mock.js) and the real
 * database.
 *
 * MODERATION_DAILY_CALL_LIMIT caps the calls to the model per UTC day across all accounts. Its
 * counter (moderation_call_counts, one row per UTC day) is shared by everything that runs against
 * this database on the same day, so each test reads today's count first and sets the limit
 * relative to it. A check beyond the limit, or one whose counter cannot be read or written, is
 * refused before the provider is asked, whatever MODERATION_FAIL_OPEN says.
 *
 * As in moderation.test.js, the provider's address points at the stand-in on 127.0.0.1 and every
 * test asserts how many requests reached it, so nothing can leave the machine. This file also
 * loads on a server without the counter: its tests then fail on an assertion, not on loading.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { FUNCTIONAL_WRITE_LIMITS } from './support/app.js';
import { assertLoopbackBaseUrl, startModelMock, verdict } from './support/model-mock.js';

const MSG_DAILY_LIMIT = 'Die Inhaltspruefung ist fuer heute ausgelastet. Bitte versuche es spaeter erneut.';
const MSG_UNAVAILABLE = 'Die Inhaltspruefung ist gerade nicht erreichbar. Bitte versuche es spaeter erneut.';

/** Checks sent at once in the concurrency test, and how many of them the limit leaves room for. */
const CONCURRENT = 16;
const ROOM = 3;

const mock = await startModelMock();

// Set before the server's modules are loaded, never deleted (dotenv would fill a deleted variable
// from a developer's server/.env). Each test sets MODERATION_DAILY_CALL_LIMIT itself.
process.env.ANTHROPIC_API_KEY = 'test-only-fake-key-not-a-secret';
process.env.ANTHROPIC_BASE_URL = assertLoopbackBaseUrl(mock.url);
process.env.MODERATION_ENABLED = 'true';
process.env.MODERATION_FAIL_OPEN = '';
process.env.MODERATION_FALLBACKS = 'false';
process.env.MODERATION_TIMEOUT_MS = '5000';

const { createApp } = await import('../src/app.js');
const { ensureSchema, first, pool } = await import('../src/db.js');
const { cleanup, createUser } = await import('./support/fixtures.js');

let base;
let server;
const userIds = [];

before(async () => {
  await ensureSchema();
  server = createApp({ writeLimits: FUNCTIONAL_WRITE_LIMITS }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  try {
    if (userIds.length > 0) await pool.query('DELETE FROM moderation_reports WHERE user_id IN (?)', [userIds]);
    await cleanup();
  } finally {
    await pool.end();
    server?.close();
    await mock.close();
  }
});

/** Runs `fn` with some environment values changed, and restores them afterwards. */
async function withEnv(values, fn) {
  const saved = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  try {
    return await fn();
  } finally {
    Object.assign(process.env, saved);
  }
}

/** A post as the app sends it (multipart, text only); returns the status and the answer. */
async function post(token, body) {
  const form = new FormData();
  form.append('body', body);
  const res = await fetch(`${base}/api/posts`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
  return { status: res.status, json: await res.json() };
}

/** Posts once and also returns how many requests reached the stand-in meanwhile. */
async function postAndCount(token, body) {
  const callsBefore = mock.messageCalls().length;
  const r = await post(token, body);
  return { ...r, calls: mock.messageCalls().length - callsBefore };
}

const postCount = async (userId) => Number((await first('SELECT COUNT(*) AS c FROM posts WHERE user_id = ?', [userId])).c);
const lastReport = (userId) =>
  first('SELECT verdict, action FROM moderation_reports WHERE user_id = ? ORDER BY id DESC LIMIT 1', [userId]);

/** Today as the server keys its counter: the UTC day. */
const utcDay = () => new Date().toISOString().slice(0, 10);

/** Calls counted today; 0 on a server without the counter table. */
async function callsToday() {
  const table = await first(
    "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'moderation_call_counts'",
  );
  if (Number(table.n) === 0) return 0;
  const row = await first('SELECT calls FROM moderation_call_counts WHERE day = ?', [utcDay()]);
  return Number(row?.calls ?? 0);
}

/**
 * Runs `fn` while every query on the call counter whose text matches `pattern` fails, as a counter
 * the database cannot read or write would. The failure is made at the server's own pool (the same
 * module instance the routes use); every other query runs unchanged. Returns `fn`'s result and
 * how many counter queries were refused.
 */
async function withCounterFailing(pattern, fn) {
  const own = Object.hasOwn(pool, 'query');
  const original = pool.query;
  let refused = 0;
  pool.query = function query(sql, ...rest) {
    const text = String(typeof sql === 'string' ? sql : sql?.sql ?? '');
    if (/moderation_call_counts/.test(text) && pattern.test(text)) {
      refused += 1;
      return Promise.reject(Object.assign(new Error('test-only: the counter cannot be reached'), { code: 'ER_TEST_ONLY' }));
    }
    return original.call(this, sql, ...rest);
  };
  try {
    return { result: await fn(), refused };
  } finally {
    if (own) pool.query = original;
    else delete pool.query;
  }
}

/** Runs `fn` and returns its result and the lines it wrote to console.warn and console.error. */
async function capturingLog(fn) {
  const lines = [];
  const saved = { warn: console.warn, error: console.error };
  for (const level of ['warn', 'error']) {
    console[level] = (...args) => {
      lines.push(args.map(String).join(' '));
      saved[level](...args);
    };
  }
  try {
    return { result: await fn(), lines };
  } finally {
    Object.assign(console, saved);
  }
}

test('at the daily limit a check is refused before the provider is asked, whatever MODERATION_FAIL_OPEN says', async () => {
  const author = await createUser('zbudcap', { accountType: 'creator', created: userIds });
  mock.respond({ verdict: verdict({ severity: 0 }) });
  const limit = (await callsToday()) + 1;
  const marker = 'Ueber dem Tageslimit';

  const { lines } = await capturingLog(() =>
    withEnv({ MODERATION_DAILY_CALL_LIMIT: String(limit) }, async () => {
      const within = await postAndCount(author.token, 'Innerhalb des Tageslimits');
      assert.equal(within.status, 201, JSON.stringify(within.json));
      assert.equal(within.calls, 1, 'the last call of the day reached the local stand-in');

      for (const failOpen of ['', 'true']) {
        await withEnv({ MODERATION_FAIL_OPEN: failOpen }, async () => {
          const before = await postCount(author.user.id);
          const r = await postAndCount(author.token, `${marker} ${failOpen === '' ? 'zu' : 'offen'}`);
          assert.equal(r.status, 422, `MODERATION_FAIL_OPEN=${JSON.stringify(failOpen)}: ${JSON.stringify(r.json)}`);
          assert.equal(r.json.message, MSG_DAILY_LIMIT);
          assert.equal(r.calls, 0, 'the provider is not asked beyond the limit');
          assert.equal(await postCount(author.user.id), before, 'nothing was stored');
          assert.deepEqual({ ...(await lastReport(author.user.id)) }, { verdict: 'error', action: 'blocked' });
        });
      }
    }),
  );

  assert.equal(await callsToday(), limit, 'the counter stops at the limit');
  const reached = lines.filter((line) => /Daily AI moderation call limit reached/.test(line));
  assert.equal(reached.length, 1, `logged once, not once per refused check:\n${lines.join('\n')}`);
  assert.match(reached[0], new RegExp(`\\b${limit} calls\\b`), 'the log line has the count');
  for (const line of lines) {
    for (const personal of [marker, author.user.username, author.user.email].filter(Boolean)) {
      assert.ok(!line.includes(personal), `the log holds counts only, never the content or the account: ${line}`);
    }
  }
});

test('concurrent checks never take more than the daily limit together', async () => {
  const author = await createUser('zbudpar', { accountType: 'creator', created: userIds });
  mock.respond({ verdict: verdict({ severity: 0 }) });
  const limit = (await callsToday()) + ROOM;

  await withEnv({ MODERATION_DAILY_CALL_LIMIT: String(limit) }, async () => {
    const callsBefore = mock.messageCalls().length;
    // Letters, not digits, in the texts (a digit could form a blocked number code).
    const texts = Array.from({ length: CONCURRENT }, (_, i) => `Gleichzeitig ${String.fromCharCode(97 + i)}`);
    const results = await Promise.all(texts.map((text) => post(author.token, text)));
    const calls = mock.messageCalls().length - callsBefore;

    const outcome = { stored: 0, limit: 0 };
    const other = [];
    for (const r of results) {
      if (r.status === 201) outcome.stored += 1;
      else if (r.status === 422 && r.json.message === MSG_DAILY_LIMIT) outcome.limit += 1;
      else other.push(`${r.status} ${JSON.stringify(r.json)}`);
    }
    assert.equal(calls, ROOM, `${calls} of ${CONCURRENT} concurrent checks reached the provider; the limit left room for ${ROOM}`);
    assert.deepEqual(outcome, { stored: ROOM, limit: CONCURRENT - ROOM }, other.join('\n'));
    assert.deepEqual(other, []);
  });
  assert.equal(await callsToday(), limit, 'the counter stops exactly at the limit');
});

test('a counter that cannot be read or written refuses the check before the provider is asked, whatever MODERATION_FAIL_OPEN says', async () => {
  const author = await createUser('zbudfail', { accountType: 'creator', created: userIds });
  mock.respond({ verdict: verdict({ severity: 0 }) });
  const limit = (await callsToday()) + 100;

  const failures = [];
  for (const [statement, pattern] of [
    ['the row check (INSERT)', /^\s*INSERT/i],
    ['the reservation (UPDATE)', /^\s*UPDATE/i],
  ]) {
    for (const failOpen of ['', 'true']) {
      const label = `${statement}, MODERATION_FAIL_OPEN=${JSON.stringify(failOpen)}`;
      const before = await postCount(author.user.id);
      const { result: r, refused } = await withCounterFailing(pattern, () =>
        withEnv({ MODERATION_DAILY_CALL_LIMIT: String(limit), MODERATION_FAIL_OPEN: failOpen }, () =>
          postAndCount(author.token, 'Zaehler nicht erreichbar'),
        ),
      );
      if (r.status !== 422 || r.json.message !== MSG_UNAVAILABLE) failures.push(`${label}: ${r.status} ${JSON.stringify(r.json)}`);
      if (r.calls !== 0) failures.push(`${label}: ${r.calls} request(s) reached the provider`);
      if ((await postCount(author.user.id)) !== before) failures.push(`${label}: the post was stored`);
      const report = { ...(await lastReport(author.user.id)) };
      if (report.verdict !== 'error' || report.action !== 'blocked') failures.push(`${label}: report ${JSON.stringify(report)}`);
      if (refused < 1) failures.push(`${label}: the check never asked the counter`);
    }
  }
  assert.deepEqual(failures, []);
  const banned = await first('SELECT banned_until FROM users WHERE id = ?', [author.user.id]);
  assert.equal(banned.banned_until, null, 'never a ban');
});

test('outside production an unset limit means no cap, and nothing is counted (control)', async () => {
  const author = await createUser('zbudnone', { accountType: 'creator', created: userIds });
  mock.respond({ verdict: verdict({ severity: 0 }) });
  assert.notEqual(process.env.NODE_ENV, 'production', 'precondition: the tests run outside production');
  const before = await callsToday();

  await withEnv({ MODERATION_DAILY_CALL_LIMIT: '' }, async () => {
    for (const text of ['Ohne Tageslimit eins', 'Ohne Tageslimit zwei']) {
      const r = await postAndCount(author.token, text);
      assert.equal(r.status, 201, JSON.stringify(r.json));
      assert.equal(r.calls, 1, 'the check reached the local stand-in');
    }
  });
  assert.equal(await callsToday(), before, 'without a limit nothing is counted');
});
