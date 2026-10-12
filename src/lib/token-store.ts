import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { parseSessionUserId, serializeSessionUserId } from '@/domain/session';

/**
 * Speichert den API-Token sicher.
 * - Handy (iOS/Android): expo-secure-store (verschlüsselt im Gerät).
 * - Web: localStorage (SecureStore gibt es im Browser nicht).
 */
const KEY = 'goenn_api_token';

/**
 * The signed-in account's id, kept beside the token (src/domain/session.ts): the offline copy of
 * bookings and pass belongs to it and is read for this account only (F-44,
 * src/lib/offline-cache.ts). Reading and writing it never fails a sign-in or the app start.
 */
const USER_KEY = 'goenn_session_user_id';

export async function saveToken(token: string): Promise<void> {
  if (Platform.OS === 'web') {
    globalThis.localStorage?.setItem(KEY, token);
    return;
  }
  await SecureStore.setItemAsync(KEY, token);
}

export async function loadToken(): Promise<string | null> {
  if (Platform.OS === 'web') {
    return globalThis.localStorage?.getItem(KEY) ?? null;
  }
  return SecureStore.getItemAsync(KEY);
}

/** Removes the token and, also when that fails, the account id stored beside it. */
export async function clearToken(): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      globalThis.localStorage?.removeItem(KEY);
      return;
    }
    await SecureStore.deleteItemAsync(KEY);
  } finally {
    await forgetSessionUserId();
  }
}

/** Stores the signed-in account's id beside the token. Never throws. */
export async function saveSessionUserId(userId: number): Promise<void> {
  const value = serializeSessionUserId(userId);
  if (value === null) return;
  try {
    if (Platform.OS === 'web') globalThis.localStorage?.setItem(USER_KEY, value);
    else await SecureStore.setItemAsync(USER_KEY, value);
  } catch {
    // Without it the app start falls back to what the storage can list (the web).
  }
}

/** The account id stored beside the token, or null. Never throws. */
export async function loadSessionUserId(): Promise<number | null> {
  try {
    const raw = Platform.OS === 'web' ? (globalThis.localStorage?.getItem(USER_KEY) ?? null) : await SecureStore.getItemAsync(USER_KEY);
    return parseSessionUserId(raw);
  } catch {
    return null;
  }
}

/** Removes the stored account id. Never throws: without a token it is unused, and the next sign-in overwrites it. */
async function forgetSessionUserId(): Promise<void> {
  try {
    if (Platform.OS === 'web') globalThis.localStorage?.removeItem(USER_KEY);
    else await SecureStore.deleteItemAsync(USER_KEY);
  } catch {
    // See above.
  }
}
