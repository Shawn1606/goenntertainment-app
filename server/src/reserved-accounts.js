/**
 * Usernames and e-mail domains only the system may use (F-05): the admin and the venue and import
 * hosts that src/seed.js and src/import/ create. The list is shared/reserved-accounts.json, which
 * Laravel reads too (api/app/Support/ReservedAccounts.php); its "about" lines say why it exists.
 *
 * Node applies it where an admin renames an account (routes/admin.js); sign-up, profile changes
 * and the e-mail change are Laravel's. The seed refuses to start when it would create a name that
 * is not listed (src/seed.js).
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

/** Compared without regard to case, like the database compares usernames. */
export function isReservedUsername(username, lists = RESERVED_ACCOUNTS) {
  return typeof username === 'string' && lists.usernames.includes(username.trim().toLowerCase());
}

/** The address's domain is a reserved one or below it. */
export function isReservedEmail(email, lists = RESERVED_ACCOUNTS) {
  if (typeof email !== 'string') return false;
  const at = email.lastIndexOf('@');
  if (at === -1) return false;
  const domain = email.slice(at + 1).trim().toLowerCase().replace(/\.$/, '');
  return lists.emailDomains.some((reserved) => domain === reserved || domain.endsWith(`.${reserved}`));
}
