/**
 * Usernames and e-mail domains only the system may use (F-05): the admin and the venue and import
 * hosts that src/seed.js and src/import/ create. The list is shared/reserved-accounts.json, which
 * Laravel reads too (api/app/Support/ReservedAccounts.php); its "about" lines say why it exists.
 *
 * Node applies it where an admin renames an account (routes/admin.js), compared the way the
 * database compares usernames; sign-up, profile changes and the e-mail change are Laravel's. The
 * seed refuses to start when it would create a name that is not listed (src/seed.js).
 *
 * Without the file the server does not start, like the word filter's list: a check that silently
 * goes missing is noticed only after the name is taken.
 */
import fs from 'node:fs';

export const MSG_RESERVED_USERNAME = 'Dieser Benutzername ist reserviert – bitte wähle einen anderen.';

function isListOfNames(list) {
  return Array.isArray(list) && list.length > 0 && list.every((v) => typeof v === 'string' && v.trim() !== '');
}

/** Reads and checks the list; `file` defaults to RESERVED_ACCOUNTS_FILE or shared/ in the repo/image. */
export function loadReservedAccounts(file = process.env.RESERVED_ACCOUNTS_FILE || new URL('../../shared/reserved-accounts.json', import.meta.url)) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!isListOfNames(data?.usernames) || !isListOfNames(data?.email_domains)) {
    throw new Error("shared/reserved-accounts.json needs non-empty 'usernames' and 'email_domains' lists");
  }
  return Object.freeze({
    usernames: Object.freeze(data.usernames.map((u) => u.toLowerCase())),
    emailDomains: Object.freeze(data.email_domains.map((d) => d.toLowerCase())),
  });
}

export const RESERVED_ACCOUNTS = loadReservedAccounts();

/**
 * The name is on the list, compared without regard to case. Exact otherwise: for the system's own
 * names (the seed's check of the names it creates, the tests). A name that comes from outside is
 * checked with isReservedUsernameInDatabase, which also catches lookalikes.
 */
export function isReservedUsername(username, lists = RESERVED_ACCOUNTS) {
  return typeof username === 'string' && lists.usernames.includes(username.trim().toLowerCase());
}

/**
 * The name equals a reserved one the way users.username compares names: under utf8mb4_unicode_ci
 * (schema.sql), which ignores case, accents and width and reads "œ" as "oe". So "Ádmin" or a
 * full-width "ａｄｍｉｎ" counts as "admin", as it would for the unique key - unlike in
 * isReservedUsername, which compares characters. Used where Node takes a username from outside
 * (the admin rename, routes/admin.js); Laravel checks the names of sign-up and profile changes.
 * The collation is named here and in schema.sql; test/admin-rename-reserved.test.js checks that
 * they agree.
 *
 * @param {{ query: Function }} db  the pool (src/db.js)
 */
export async function isReservedUsernameInDatabase(db, username, lists = RESERVED_ACCOUNTS) {
  if (typeof username !== 'string' || username.trim() === '') return false;
  const [rows] = await db.query('SELECT CONVERT(? USING utf8mb4) COLLATE utf8mb4_unicode_ci IN (?) AS reserved', [
    username.trim(),
    [...lists.usernames],
  ]);
  return Number(rows[0]?.reserved) === 1;
}

/**
 * The address's domain is a reserved one or below it. It compares characters (lower-cased), not
 * the way the database compares addresses, so a lookalike domain is not caught here; Node uses
 * this for no write (only the tests check the seed's and the importer's own addresses with it).
 * Laravel checks the addresses of sign-up and the e-mail change, and the seed and the importer
 * take over only their exact accounts (src/system-accounts.js).
 */
export function isReservedEmail(email, lists = RESERVED_ACCOUNTS) {
  if (typeof email !== 'string') return false;
  const at = email.lastIndexOf('@');
  if (at === -1) return false;
  const domain = email.slice(at + 1).trim().toLowerCase().replace(/\.$/, '');
  return lists.emailDomains.some((reserved) => domain === reserved || domain.endsWith(`.${reserved}`));
}
