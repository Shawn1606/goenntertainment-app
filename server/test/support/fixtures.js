/**
 * Shared fixtures for the server tests.
 *
 * ## Stamps
 *
 * Test usernames are `<prefix><stamp>`, and registration runs them through the word filter
 * (shared/blocked-terms.json, mode 'username'). The old stamp (`Date.now()` plus a random number)
 * could contain a blocked numeric code, and in a leetspeak reading its digits could also finish a
 * blocked word that the prefix had started. Either way a registration failed with a spurious 422,
 * and a full run went red now and then for no reason in the code under test.
 *
 * Stamps here use only SAFE_DIGITS:
 *   - no 1, 4 or 8: every numeric term in today's list contains one of them;
 *   - no 9: in a leet reading it becomes a letter that completes a term after one of the prefixes.
 * The digits left read as o, e, s, t or nothing. test/test-support.test.js checks every prefix the
 * tests use against every term the filter has, and fails as soon as a new term or a new prefix makes
 * a stamp able to trip the filter again.
 * The deploy stack test (deploy/test/stack.test.mjs, run by .github/workflows/docker.yml) registers
 * its accounts through the running stack with testIdentity() from here, so it has no stamp rule of
 * its own; the same test checks its username prefixes.
 *
 * ## Password
 *
 * TEST_PASSWORD is an obviously fake value for throw-away accounts. It passes the password rule
 * (Laravel's App\Support\PasswordPolicy) and is not in shared/common-passwords.json;
 * api/tests/Unit/PasswordPolicyTest.php asserts both for this exact value (a named mirror of it), and
 * api/tests/AppFeatureTestCase.php uses the same value (api/tests/Unit/AppFeatureTestCaseTest.php
 * checks that the two are equal).
 *
 * ## Accounts and tokens
 *
 * Sign-up and sign-in belong to Laravel (api/). The tests therefore do not create their accounts
 * through an HTTP route: createUser() writes the users row and a Sanctum-compatible access token
 * straight to the database, with bound parameters. The token row is what Laravel's
 * `createToken()` writes (vendor/laravel/sanctum HasApiTokens): `tokenable_type`
 * App\Models\User, abilities ["*"], the sha256 of the plain part in `token`, and an `expires_at`
 * (here one day ahead). The bearer value is `<id>|<plain>`, the plain part 40 random letters
 * and digits plus their crc32b, like Sanctum's generateTokenString(). insertToken() writes more
 * tokens, also expired, without expiry or of another type. Every account made here is removed by
 * cleanup() or deleteTestUsers(), together with its tokens.
 */
import crypto from 'node:crypto';
import zlib from 'node:zlib';

/** Digits a stamp may use (see the module comment). */
export const SAFE_DIGITS = '023567';

/** 6^12 ≈ 2.2e9 values; a 16-character prefix plus 12 digits fits the tests' 28-character slice. */
export const STAMP_LENGTH = 12;

/** Obviously fake password for throw-away test accounts. */
export const TEST_PASSWORD = 'Fixture-Only-Pass-2468';

/** `personal_access_tokens.tokenable_type` of an account: Laravel's user model. */
export const TOKENABLE_TYPE = 'App\\Models\\User';

/** Random stamp from SAFE_DIGITS only. */
export function uniqueStamp(length = STAMP_LENGTH) {
  let stamp = '';
  for (let i = 0; i < length; i += 1) stamp += SAFE_DIGITS[crypto.randomInt(SAFE_DIGITS.length)];
  return stamp;
}

/** Name, username and e-mail for a throw-away account. */
export function testIdentity(prefix, { maxUsername = 28, domain = 'example.invalid' } = {}) {
  const stamp = uniqueStamp();
  return {
    stamp,
    name: `${prefix} Test`,
    username: `${prefix}${stamp}`.slice(0, maxUsername),
    email: `${prefix}${stamp}@${domain}`,
  };
}

/** Inserts an account directly (no HTTP route, no password) and returns its id. */
export async function insertTestUser(pool, prefix, { accountType = 'standard', isAdmin = false } = {}) {
  const identity = testIdentity(prefix);
  const [result] = await pool.query(
    `INSERT INTO users (name, username, email, account_type, is_admin, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NOW(), NOW())`,
    [identity.name, identity.username, identity.email, accountType, isAdmin ? 1 : 0],
  );
  return result.insertId;
}

/**
 * Removes throw-away accounts and their access tokens. Their own events go first: on MySQL 8.4 a
 * single DELETE of a host whose event is in their own history or points fails with a foreign-key
 * error (ER_NO_REFERENCED_ROW_2). Deleting the events first avoids that. Tokens have no foreign
 * key (Sanctum's polymorphic `tokenable`), so they are deleted explicitly.
 */
export async function deleteTestUsers(pool, userIds) {
  if (userIds.length === 0) return;
  await pool.query('DELETE FROM personal_access_tokens WHERE tokenable_type = ? AND tokenable_id IN (?)', [
    TOKENABLE_TYPE,
    userIds,
  ]);
  await pool.query('DELETE FROM activities WHERE user_id IN (?)', [userIds]);
  await pool.query('DELETE FROM users WHERE id IN (?)', [userIds]);
}

/**
 * `expires_at` of a fixture token, as SQL. Fixed fragments chosen by name, never a caller's text;
 * the database clock decides, the same clock a token check compares with.
 */
const TOKEN_EXPIRY_SQL = {
  future: 'NOW() + INTERVAL 1 DAY',
  past: 'NOW() - INTERVAL 1 HOUR',
  null: 'NULL',
};

const TOKEN_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** Plain part of a token in Sanctum's shape: 40 random letters and digits, then their crc32b. */
export function sanctumPlainToken() {
  let entropy = '';
  for (let i = 0; i < 40; i += 1) entropy += TOKEN_CHARS[crypto.randomInt(TOKEN_CHARS.length)];
  return `${entropy}${zlib.crc32(entropy).toString(16).padStart(8, '0')}`;
}

/** The server modules, loaded on first use, so this file stays importable without a database. */
const serverModules = () => Promise.all([import('../../src/db.js'), import('../../src/auth.js')]);

/** Every account createUser() made in this process, for cleanup(). */
const createdAccounts = new Set();

/** bcrypt of TEST_PASSWORD, made once per process (the production hash function, cost 10). */
let testPasswordHash = null;

/**
 * Inserts an access token for `userId` and returns its bearer value `<id>|<plain>`.
 * `expires`: 'future' (one day ahead), 'past' (an hour ago) or 'null' (no expiry);
 * `type`: the tokenable_type (another value makes a token that belongs to no account);
 * `createdMinutesAgo`: how long ago the token was issued (`created_at`, by the database clock).
 */
export async function insertToken(
  userId,
  { expires = 'future', type = TOKENABLE_TYPE, name = 'test', createdMinutesAgo = 0 } = {},
) {
  const expiresSql = Object.hasOwn(TOKEN_EXPIRY_SQL, expires) ? TOKEN_EXPIRY_SQL[expires] : null;
  if (expiresSql === null) throw new Error("insertToken: expires must be 'future', 'past' or 'null'");
  if (!Number.isSafeInteger(createdMinutesAgo) || createdMinutesAgo < 0) {
    throw new Error('insertToken: createdMinutesAgo must be a whole number of minutes, 0 or more');
  }
  const [{ pool }] = await serverModules();
  const plain = sanctumPlainToken();
  const [result] = await pool.query(
    `INSERT INTO personal_access_tokens
       (tokenable_type, tokenable_id, name, token, abilities, expires_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ${expiresSql}, NOW() - INTERVAL ? MINUTE, NOW())`,
    [type, userId, name, crypto.createHash('sha256').update(plain).digest('hex'), '["*"]', createdMinutesAgo],
  );
  return `${result.insertId}|${plain}`;
}

/**
 * A throw-away account plus a valid access token, written straight to the database. Returns
 * `{ token, user }` like the sign-up answer did: `user` is the serialized row (no password, no
 * 2FA secrets) with an empty `interests` list.
 *
 * Username `<prefix><stamp>` (see Stamps), name `<prefix> Test`, e-mail `@example.invalid`,
 * password TEST_PASSWORD unless `password` says otherwise (null = an account without password).
 * `created` (optional) is the test file's own list of ids to remove afterwards.
 */
export async function createUser(
  prefix,
  { accountType = 'standard', isAdmin = false, password = TEST_PASSWORD, twoFactorMethod = null, created } = {},
) {
  const [{ pool, first }, { hashPassword, serializeUser }] = await serverModules();
  let hash = null;
  if (password === TEST_PASSWORD) hash = testPasswordHash ??= await hashPassword(TEST_PASSWORD);
  else if (password !== null) hash = await hashPassword(password);

  const identity = testIdentity(prefix);
  const [result] = await pool.query(
    `INSERT INTO users (name, username, email, password, account_type, is_admin, two_factor_method, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
    [identity.name, identity.username, identity.email, hash, accountType, isAdmin ? 1 : 0, twoFactorMethod],
  );
  const id = result.insertId;
  createdAccounts.add(id);
  created?.push(id);

  const token = await insertToken(id);
  const row = await first('SELECT * FROM users WHERE id = ?', [id]);
  return { token, user: { ...serializeUser(row), interests: [] } };
}

/** Removes every account createUser() made in this process (and their tokens). */
export async function cleanup() {
  const ids = [...createdAccounts];
  createdAccounts.clear();
  if (ids.length === 0) return;
  const [{ pool }] = await serverModules();
  await deleteTestUsers(pool, ids);
}
