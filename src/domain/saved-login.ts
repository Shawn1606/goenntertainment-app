/**
 * "E-Mail-Adresse merken" (F-20): the app remembers the e-mail address for the next sign-in, and
 * nothing else. Earlier versions stored the password too, under LEGACY_CREDENTIALS_KEY; the app
 * moves the address out of that entry and deletes it on the first start after the update
 * (migrateLegacyEntry below, called through src/lib/credential-store.ts, migrateSavedLogin),
 * whether or not the sign-in screen is shown.
 *
 * No platform code here: the storage itself (SecureStore on phones, localStorage on the web)
 * lives in src/lib/credential-store.ts and is passed in, so the tests can use a store in memory.
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

/** The device storage as the migration sees it: read, write and delete one text value by key. */
export type KeyValueStore = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
};

/**
 * Removes what earlier versions stored. The address of the legacy entry is kept, unless a newer
 * one is already saved; the entry itself is deleted in every case once it was read: malformed,
 * without an address, or when keeping the address failed. Safe to run on every start.
 *
 * Never rejects: the app start awaits it before anything else, so a storage error must not stop
 * the start. A delete that fails is tried again on the next start, because the entry is still
 * there to be read.
 */
export async function migrateLegacyEntry(store: KeyValueStore): Promise<void> {
  let legacy: string | null;
  try {
    legacy = await store.get(LEGACY_CREDENTIALS_KEY);
  } catch {
    return;
  }
  if (legacy === null || legacy === undefined) return;

  const email = emailFromLegacy(legacy);
  if (email) {
    let saved: string | null = null;
    try {
      saved = normalizeSavedEmail(await store.get(SAVED_EMAIL_KEY));
    } catch {
      saved = null;
    }
    try {
      if (!saved) await store.set(SAVED_EMAIL_KEY, email);
    } catch {
      // Keeping the address is a convenience; the entry is deleted all the same.
    }
  }

  try {
    await store.remove(LEGACY_CREDENTIALS_KEY);
  } catch {
    // Still stored: the next start reads it again and retries the delete.
  }
}
