import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import {
  LEGACY_CREDENTIALS_KEY,
  SAVED_EMAIL_KEY,
  migrateLegacyEntry,
  normalizeSavedEmail,
} from '@/domain/saved-login';

/**
 * „E-Mail-Adresse merken": die zuletzt benutzte E-Mail-Adresse für die nächste Anmeldung.
 * - Handy (iOS/Android): expo-secure-store (verschlüsselt im Gerät).
 * - Web: localStorage (SecureStore gibt es im Browser nicht).
 *
 * Only the address is kept (F-20): a stored secret survives on the device after sign-out and is
 * readable by anything with access to the browser storage. Earlier versions also kept the secret
 * under the legacy key; migrateSavedLogin() moves the address out and deletes that entry on the
 * first start after the update (src/lib/auth-context.tsx calls it before anything else).
 *
 * Every function here fails quietly: a device without working storage simply remembers nothing.
 */

async function readKey(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    return globalThis.localStorage?.getItem(key) ?? null;
  }
  return SecureStore.getItemAsync(key);
}

async function writeKey(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    globalThis.localStorage?.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function deleteKey(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    globalThis.localStorage?.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

/** Remembers the address for the next sign-in (nothing is saved for an empty value). */
export async function saveEmail(email: string): Promise<void> {
  const value = normalizeSavedEmail(email);
  try {
    if (value) await writeKey(SAVED_EMAIL_KEY, value);
    else await deleteKey(SAVED_EMAIL_KEY);
  } catch {
    // No storage available: then the app simply remembers nothing.
  }
}

/** The remembered address, or null. */
export async function loadSavedEmail(): Promise<string | null> {
  try {
    return normalizeSavedEmail(await readKey(SAVED_EMAIL_KEY));
  } catch {
    return null;
  }
}

/** Forgets the remembered address (and any legacy entry). */
export async function clearSavedEmail(): Promise<void> {
  for (const key of [SAVED_EMAIL_KEY, LEGACY_CREDENTIALS_KEY]) {
    try {
      await deleteKey(key);
    } catch {
      // Nothing to delete, or no storage: either way nothing is stored.
    }
  }
}

/**
 * Removes what earlier versions stored: keeps the address of the legacy entry (unless a newer one
 * is already saved) and deletes the entry itself. Safe to run on every start, and never rejects.
 * The logic and its tests: migrateLegacyEntry in src/domain/saved-login.ts.
 */
export async function migrateSavedLogin(): Promise<void> {
  await migrateLegacyEntry({ get: readKey, set: writeKey, remove: deleteKey });
}
