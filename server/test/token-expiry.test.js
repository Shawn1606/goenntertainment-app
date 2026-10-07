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

/** Runs `fn` with these environment settings, then puts the previous ones back. */
async function withEnv(settings, fn) {
  const saved = Object.fromEntries(Object.keys(settings).map((name) => [name, process.env[name]]));
  Object.assign(process.env, settings);
  try {
    return await fn();
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test('a token older than the lifetime is refused even with a later expires_at', async () => {
  // Laravel's Sanctum guard refuses it too: created_at older than the lifetime (SANCTUM_EXPIRATION,
  // unset = 30 days = 43200 minutes), whatever the stored expires_at says.
  const { user } = await createUser('tokenexpiry');
  assert.equal((await notifications(await insertToken(user.id, { createdMinutesAgo: 43200 + 1 }))).status, 401);
  assert.equal((await notifications(await insertToken(user.id, { createdMinutesAgo: 43200 - 1 }))).status, 200);
});

test('a lower SANCTUM_EXPIRATION ends older sessions at once, as on the Laravel routes', async () => {
  const { user } = await createUser('tokenexpiry');
  // Both issued under the old lifetime; their expires_at (tomorrow) has not passed.
  const older = await insertToken(user.id, { createdMinutesAgo: 61 });
  const newer = await insertToken(user.id, { createdMinutesAgo: 59 });

  await withEnv({ SANCTUM_EXPIRATION: '60' }, async () => {
    assert.equal((await notifications(older)).status, 401);
    assert.equal((await notifications(newer)).status, 200);
  });
});

test('with an invalid SANCTUM_EXPIRATION no token is accepted (the server does not start with one)', async () => {
  const { token } = await createUser('tokenexpiry');
  for (const bad of ['0', 'abc', '1.5']) {
    await withEnv({ SANCTUM_EXPIRATION: bad }, async () => {
      assert.equal((await notifications(token)).status, 500, bad);
    });
  }
  assert.equal((await notifications(token)).status, 200, 'and the same token works again with the default');
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
