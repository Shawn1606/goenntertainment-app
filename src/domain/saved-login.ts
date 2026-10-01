/**
 * "E-Mail-Adresse merken" (F-20): the app remembers the e-mail address for the next sign-in, and
 * nothing else. Earlier versions stored the password too, under LEGACY_CREDENTIALS_KEY; the app
 * moves the address out of that entry and deletes it on the first start after the update
 * (src/lib/credential-store.ts, migrateSavedLogin), whether or not the sign-in screen is shown.
 *
 * Pure functions only: the storage itself (SecureStore on phones, localStorage on the web) lives
 * in src/lib/credential-store.ts.
 */
import { EMAIL_MAX_LENGTH } from './email.ts';

/** The entry earlier versions wrote: JSON `{ email, password }`. Read once, then deleted. */
export const LEGACY_CREDENTIALS_KEY = 'goenn_saved_credentials';

/** The remembered e-mail address, as plain text. */
export const SAVED_EMAIL_KEY = 'goenn_saved_email';

/** A value worth remembering: trimmed, not empty, not longer than an address can be. */
export function normalizeSavedEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim();
  return email.length > 0 && email.length <= EMAIL_MAX_LENGTH ? email : null;
}

/**
 * The e-mail address from a legacy entry, or null. Reads only `email`: whatever else the entry
 * holds (the password) is never returned and never stored again.
 */
export function emailFromLegacy(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string' || raw === '') return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object') return null;
    return normalizeSavedEmail((parsed as { email?: unknown }).email);
  } catch {
    return null;
  }
}
