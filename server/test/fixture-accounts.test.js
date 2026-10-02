/**
 * The account fixtures (test/support/fixtures.js: createUser, insertToken, cleanup) against the
 * real database (MySQL 8.4 with server/schema.sql).
 *
 * Every server test that needs an account gets it from these fixtures, so their contract is
 * checked here: the rows they write, the token's Sanctum shape, that Node's requireAuth accepts the
 * token, and that cleanup leaves nothing behind. api/tests/Feature/SanctumTokenFormatTest.php checks
 * the same token shape against Laravel (a named mirror).
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

import { createApp } from '../src/app.js';
import { FUNCTIONAL_WRITE_LIMITS } from './support/app.js';
import { ensureSchema, first, pool } from '../src/db.js';
import bcrypt from 'bcryptjs';
import {
  TEST_PASSWORD,
  TOKENABLE_TYPE,
  cleanup,
  createUser,
  deleteTestUsers,
  insertToken,
  sanctumPlainToken,
} from './support/fixtures.js';

let base;
let server;
const createdUserIds = [];

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

/** The token row behind a bearer value `<id>|<plain>`, with how its expiry relates to NOW(). */
async function tokenRow(bearer) {
  const [id, plain] = bearer.split('|');
  const row = await first(
    `SELECT *,
            CASE WHEN expires_at IS NULL THEN 'null'
                 WHEN expires_at > NOW() THEN 'future'
                 ELSE 'past' END AS expiry,
            expires_at <= NOW() + INTERVAL 1 DAY AS within_a_day
       FROM personal_access_tokens WHERE id = ?`,
    [id],
  );
  return { row, plain };
}

before(async () => {
  await ensureSchema();
  server = createApp({ writeLimits: FUNCTIONAL_WRITE_LIMITS }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  // Closed even when the cleanup throws; open handles would keep `npm test` from exiting.
  try {
    await cleanup();
    await deleteTestUsers(pool, createdUserIds);
  } finally {
    await pool.end();
    server?.close();
  }
});

test('sanctumPlainToken: 40 letters and digits plus their crc32b, as Sanctum builds it', () => {
  // The crc32b PHP's hash() gives for this text (php -r "echo hash('crc32b', ...);").
  assert.equal(zlib.crc32('The quick brown fox jumps over the lazy dog').toString(16), '414fa339');
  const plain = sanctumPlainToken();
  assert.match(plain, /^[A-Za-z0-9]{40}[0-9a-f]{8}$/);
  assert.equal(plain.slice(40), zlib.crc32(plain.slice(0, 40)).toString(16).padStart(8, '0'));
  assert.notEqual(sanctumPlainToken(), plain);
});

test('createUser: users row with the fixture identity, and a token Node accepts', async () => {
  const { token, user } = await createUser('fixacct', { accountType: 'creator', created: createdUserIds });

  assert.ok(createdUserIds.includes(user.id));
  const row = await first('SELECT * FROM users WHERE id = ?', [user.id]);
  assert.match(row.username, /^fixacct[0-9]+$/);
  assert.equal(row.email, `${row.username}@example.invalid`);
  assert.equal(row.name, 'fixacct Test');
  assert.equal(row.account_type, 'creator');
  assert.equal(row.is_admin, 0);
  assert.equal(row.two_factor_method, null);
  assert.equal(await bcrypt.compare(TEST_PASSWORD, row.password), true);

  // The returned user is the serialized row: no password, no 2FA secrets.
  assert.equal(user.username, row.username);
  assert.equal(user.account_type, 'creator');
  assert.equal(user.is_admin, false);
  assert.deepEqual(user.interests, []);
  for (const key of ['password', 'remember_token', 'two_factor_secret', 'two_factor_recovery_codes']) {
    assert.equal(key in user, false, `${key} must not be in the fixture's user`);
  }

  // The token row: what Laravel's createToken() writes.
  assert.match(token, /^[0-9]+\|[A-Za-z0-9]{40}[0-9a-f]{8}$/);
  const { row: t, plain } = await tokenRow(token);
  assert.equal(t.tokenable_type, TOKENABLE_TYPE);
  assert.equal(t.tokenable_type, 'App\\Models\\User');
  assert.equal(Number(t.tokenable_id), user.id);
  assert.equal(t.token, sha256(plain));
  assert.equal(t.abilities, '["*"]');
  assert.equal(t.expiry, 'future');
  assert.equal(Number(t.within_a_day), 1);

  // Node's requireAuth takes it (GET /api/notifications is a Node route behind requireAuth).
  const res = await fetch(`${base}/api/notifications`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(res.status, 200);
  const wrong = await fetch(`${base}/api/notifications`, { headers: { Authorization: `Bearer ${token}x` } });
  assert.equal(wrong.status, 401);
});

test('createUser: admin, two-factor method and an account without a password', async () => {
  const admin = await createUser('fixadmin', { isAdmin: true, twoFactorMethod: 'totp' });
  assert.equal(admin.user.is_admin, true);
  assert.equal(admin.user.two_factor_method, 'totp');
  assert.equal(admin.user.account_type, 'standard');

  const passwordless = await createUser('fixnopw', { password: null });
  assert.equal((await first('SELECT password FROM users WHERE id = ?', [passwordless.user.id])).password, null);

  const own = await createUser('fixownpw', { password: 'Other-Fixture-Pass-3579' });
  const hash = (await first('SELECT password FROM users WHERE id = ?', [own.user.id])).password;
  assert.equal(await bcrypt.compare('Other-Fixture-Pass-3579', hash), true);
  assert.equal(await bcrypt.compare(TEST_PASSWORD, hash), false);
});

test('insertToken: future, past and no expiry, another tokenable_type, and nothing else', async () => {
  const { user } = await createUser('fixtoken');

  for (const expires of ['future', 'past', 'null']) {
    const { row, plain } = await tokenRow(await insertToken(user.id, { expires }));
    assert.equal(row.expiry, expires, `expires: '${expires}'`);
    assert.equal(row.token, sha256(plain));
    assert.equal(row.tokenable_type, TOKENABLE_TYPE);
  }
  const other = await tokenRow(await insertToken(user.id, { type: 'App\\Models\\Other' }));
  assert.equal(other.row.tokenable_type, 'App\\Models\\Other');

  await assert.rejects(insertToken(user.id, { expires: 'tomorrow' }), /expires must be 'future', 'past' or 'null'/);
  await assert.rejects(insertToken(user.id, { expires: 'toString' }), /expires must be/);
});

test('insertToken: created now by default, or the given minutes ago (database clock)', async () => {
  const { user } = await createUser('fixtoken');
  const age = async (bearer) =>
    Number((await first('SELECT TIMESTAMPDIFF(MINUTE, created_at, NOW()) AS m FROM personal_access_tokens WHERE id = ?', [bearer.split('|')[0]])).m);

  assert.equal(await age(await insertToken(user.id)), 0);
  assert.equal(await age(await insertToken(user.id, { createdMinutesAgo: 90 })), 90);
  for (const bad of [-1, 1.5, '60', null]) {
    await assert.rejects(insertToken(user.id, { createdMinutesAgo: bad }), /createdMinutesAgo must be a whole number/, String(bad));
  }
});

test('cleanup: removes every account createUser made, with all of its tokens', async () => {
  const one = await createUser('fixclean');
  const two = await createUser('fixcleantwo');
  await insertToken(two.user.id, { expires: 'past' });
  const ids = [one.user.id, two.user.id];
  const [[tokensBefore]] = await pool.query(
    'SELECT COUNT(*) AS n FROM personal_access_tokens WHERE tokenable_type = ? AND tokenable_id IN (?)',
    [TOKENABLE_TYPE, ids],
  );
  assert.equal(Number(tokensBefore.n), 3);

  await cleanup();

  const [[users]] = await pool.query('SELECT COUNT(*) AS n FROM users WHERE id IN (?)', [ids]);
  const [[tokens]] = await pool.query(
    'SELECT COUNT(*) AS n FROM personal_access_tokens WHERE tokenable_type = ? AND tokenable_id IN (?)',
    [TOKENABLE_TYPE, ids],
  );
  assert.equal(Number(users.n), 0);
  assert.equal(Number(tokens.n), 0);
  // The account of the first test is in createdUserIds too; cleanup() took it already.
  assert.equal(await first('SELECT id FROM users WHERE id = ?', [createdUserIds[0]]), null);
});
