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
 *
 * ## Password
 *
 * TEST_PASSWORD is an obviously fake value for throw-away accounts. It passes the password rule
 * (src/password-policy.js) and is not in shared/common-passwords.json; api/tests/Unit/
 * PasswordPolicyTest.php asserts the latter for this exact value (a named mirror of it).
 */
import crypto from 'node:crypto';

/** Digits a stamp may use (see the module comment). */
export const SAFE_DIGITS = '023567';

/** 6^12 ≈ 2.2e9 values; a 16-character prefix plus 12 digits fits the tests' 28-character slice. */
export const STAMP_LENGTH = 12;

/** Obviously fake password for throw-away test accounts. */
export const TEST_PASSWORD = 'Fixture-Only-Pass-2468';

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
 * Removes throw-away accounts. Their own events go first: on MySQL 8.4 a single DELETE of a host
 * whose event is in their own history or points fails with a foreign-key error
 * (ER_NO_REFERENCED_ROW_2). Deleting the events first avoids that.
 */
export async function deleteTestUsers(pool, userIds) {
  if (userIds.length === 0) return;
  await pool.query('DELETE FROM activities WHERE user_id IN (?)', [userIds]);
  await pool.query('DELETE FROM users WHERE id IN (?)', [userIds]);
}
