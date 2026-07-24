import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Speichert den API-Token sicher.
 * - Handy (iOS/Android): expo-secure-store (verschlüsselt im Gerät).
 * - Web: localStorage (SecureStore gibt es im Browser nicht).
 */
const KEY = 'goenn_api_token';

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

export async function clearToken(): Promise<void> {
  if (Platform.OS === 'web') {
    globalThis.localStorage?.removeItem(KEY);
    return;
  }
  await SecureStore.deleteItemAsync(KEY);
}
