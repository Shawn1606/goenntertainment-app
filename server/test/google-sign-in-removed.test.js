/**
 * Google sign-in is removed from Node (F-03): POST /api/auth/google is not served, nothing calls
 * Google, and no API answer carries `google_id` (the column stays, inert). Laravel's side:
 * api/tests/Feature/GoogleSignInRemovedTest.php.
 *
 * Calls to Google are intercepted, never sent: `fetch` to googleapis.com is answered here with a
 * fixture profile and counted.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from '../src/app.js';
import { FUNCTIONAL_WRITE_LIMITS } from './support/app.js';
import { ensureSchema, first, pool } from '../src/db.js';
import { serializeUser, userPayload } from '../src/auth.js';
import { TOKENABLE_TYPE, cleanup, createUser } from './support/fixtures.js';

let base;
let server;
let googleCalls = 0;
/** What the intercepted Google call would answer (set per test). */
let googleProfile = null;
const realFetch = globalThis.fetch;

before(async () => {
  await ensureSchema();
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('https://www.googleapis.com/')) {
      googleCalls += 1;
      return new Response(JSON.stringify(googleProfile), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return realFetch(url, init);
  };
  server = createApp({ writeLimits: FUNCTIONAL_WRITE_LIMITS }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  globalThis.fetch = realFetch;
  try {
    await cleanup();
  } finally {
    await pool.end();
    server?.close();
  }
});

test('POST /api/auth/google is not served: 404, no call to Google, no token, no link', async () => {
  const { user } = await createUser('gsignin');
  // A profile that would sign this account in and link it, if the route still existed.
  googleProfile = { sub: `fixture-google-sub-${user.id}`, email: user.email, name: 'Fixture' };
  const tokensBefore = await first(
    'SELECT COUNT(*) AS n FROM personal_access_tokens WHERE tokenable_type = ? AND tokenable_id = ?',
    [TOKENABLE_TYPE, user.id],
  );

  const res = await fetch(`${base}/api/auth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ access_token: 'fake-not-a-token' }),
  });

  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { message: 'Nicht gefunden.' });
  assert.equal(googleCalls, 0, 'Google was called');
  const tokensAfter = await first(
    'SELECT COUNT(*) AS n FROM personal_access_tokens WHERE tokenable_type = ? AND tokenable_id = ?',
    [TOKENABLE_TYPE, user.id],
  );
  assert.equal(Number(tokensAfter.n), Number(tokensBefore.n));
  assert.equal((await first('SELECT google_id FROM users WHERE id = ?', [user.id])).google_id, null);
});

test('serializeUser and userPayload never return google_id', async () => {
  // Pure: a row with the column set.
  assert.equal('google_id' in serializeUser({ id: 1, name: 'x', google_id: 'fixture-google-sub' }), false);

  // The full payload of a stored account whose (legacy) column is set.
  const { user } = await createUser('gsigninrow');
  await pool.query('UPDATE users SET google_id = ? WHERE id = ?', [`fixture-google-sub-${user.id}`, user.id]);
  const row = await first('SELECT * FROM users WHERE id = ?', [user.id]);
  assert.ok(row.google_id, 'the fixture row must carry a google_id');
  const payload = await userPayload(row);
  assert.equal('google_id' in payload, false);
  assert.equal(payload.id, user.id);
});
