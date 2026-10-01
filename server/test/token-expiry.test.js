/**
 * Node honours a token's expiry and owner type (F-20): requireAuth accepts a token only when it
 * belongs to an account (tokenable_type App\Models\User), has an `expires_at` and that date has
 * not passed - the rule Laravel applies too (api/tests/Feature/TokenLifetimeTest.php).
 * The route used is a Node-owned one behind requireAuth (GET /api/notifications).
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from '../src/app.js';
import { ensureSchema, pool } from '../src/db.js';
import * as auth from '../src/auth.js';
import { TOKENABLE_TYPE, cleanup, createUser, insertToken } from './support/fixtures.js';
import { FUNCTIONAL_WRITE_LIMITS } from './support/app.js';

let base;
let server;

before(async () => {
  await ensureSchema();
  server = createApp({ writeLimits: FUNCTIONAL_WRITE_LIMITS }).listen(0);
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

const notifications = (token) =>
  fetch(`${base}/api/notifications`, { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } });

test('a token whose expires_at has passed is rejected', async () => {
  const { user } = await createUser('tokenexpiry');
  const res = await notifications(await insertToken(user.id, { expires: 'past' }));
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { message: 'Unauthenticated.' });
});

test('a token without expires_at is rejected', async () => {
  const { user } = await createUser('tokenexpiry');
  const res = await notifications(await insertToken(user.id, { expires: 'null' }));
  assert.equal(res.status, 401);
});

test('a token of another tokenable_type is rejected', async () => {
  const { user } = await createUser('tokenexpiry');
  const res = await notifications(await insertToken(user.id, { type: 'App\\Models\\Other' }));
  assert.equal(res.status, 401);
});

test('a token that expires in the future works (and so does the one createUser returns)', async () => {
  const { user, token } = await createUser('tokenexpiry');
  assert.equal((await notifications(await insertToken(user.id, { expires: 'future' }))).status, 200);
  assert.equal((await notifications(token)).status, 200);
});

test('a malformed token id is rejected without a lookup error', async () => {
  const { token } = await createUser('tokenexpiry');
  const plain = token.slice(token.indexOf('|') + 1);
  for (const id of ['1 OR 1=1', '-1', 'abc', '1.0', '1e3']) {
    const res = await notifications(`${id}|${plain}`);
    assert.equal(res.status, 401, id);
  }
});

test('the owner type Node checks is the fixtures\' (named mirror of Laravel\'s user class)', () => {
  assert.equal(auth.TOKENABLE_TYPE, TOKENABLE_TYPE);
  assert.equal(TOKENABLE_TYPE, 'App\\Models\\User');
});
