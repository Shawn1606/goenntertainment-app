/**
 * The accounts the system creates for itself: the venue hosts of src/seed.js and the import hosts
 * of src/import/ (F-05). Both find such an account by its address and create it when it is missing.
 *
 * Finding it is the risky part. The database compares users.email under
 * utf8mb4_unicode_ci, which ignores case, accents and width: an address with an accented or
 * full-width letter in the system domain, or "œ" for "oe", is found by a lookup for the system's
 * address. It is a different address, though, so sign-up does not see the reserved domain in it,
 * and anyone may register it. Taking such an account over would give whoever registered it the
 * business tier and the system's events.
 *
 * So an account is taken over only when it is exactly the system's: the same address, character
 * for character, and the expected username. The username may differ in the case of its ASCII
 * letters only: usernames compare without case in the database, and an admin may rename an
 * account to its own name in another case (routes/admin.js). Any other account that the database
 * matches by the address or by the username is refused with SystemAccountConflict before anything
 * is written; the operator resolves the conflict by hand.
 */

/** An account matches a system account's address or username but is not that account. */
export class SystemAccountConflict extends Error {
  constructor(message) {
    super(message);
    this.name = 'SystemAccountConflict';
  }
}

/** Lower-cases ASCII letters only: no Unicode case mapping may turn a lookalike into ASCII. */
const asciiLower = (value) => value.replace(/[A-Z]/g, (char) => char.toLowerCase());

/**
 * The id of the system account with this address and username, or null when no account matches
 * either. Throws SystemAccountConflict when an account matches the address or the username the
 * way the database compares them but is not exactly that account. Writes nothing.
 *
 * The message names the username the system wanted and the ids of the accounts in the way - not
 * their addresses or usernames, which belong to whoever registered them.
 *
 * @param {{ query: Function }} db  the pool (src/db.js)
 * @param {{ email: string, username: string }} account
 */
export async function findSystemAccount(db, { email, username }) {
  const [rows] = await db.query('SELECT id, username, email FROM users WHERE email = ? OR username = ?', [
    email,
    username,
  ]);
  if (rows.length === 0) return null;

  const [row] = rows;
  const exact =
    rows.length === 1 &&
    row.email === email &&
    typeof row.username === 'string' &&
    asciiLower(row.username) === asciiLower(username);
  if (!exact) {
    const ids = rows.map((r) => r.id).join(', ');
    const which = rows.length === 1 ? `account id ${ids} matches` : `accounts with the ids ${ids} match`;
    throw new SystemAccountConflict(
      `system account '${username}': ${which} its address or username but not exactly; ` +
        'no account was taken over and nothing was written for it. Resolve this by hand.',
    );
  }
  return row.id;
}
