import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Speichert E-Mail + Passwort für „Passwort speichern für die nächste App-Nutzung".
 * - Handy (iOS/Android): expo-secure-store (verschlüsselt im Gerät).
 * - Web: localStorage (SecureStore gibt es im Browser nicht).
 *
 * Hinweis: Ein Passwort auf dem Gerät zu halten ist bequem, aber weniger sicher
 * als nur ein Sitzungs-Token. Wird nur gespeichert, wenn der Nutzer den Schalter
 * bewusst aktiviert.
 */
const KEY = 'goenn_saved_credentials';

export type SavedCredentials = {
  email: string;
  password: string;
};

export async function saveCredentials(creds: SavedCredentials): Promise<void> {
  const value = JSON.stringify(creds);
  if (Platform.OS === 'web') {
    globalThis.localStorage?.setItem(KEY, value);
    return;
  }
  await SecureStore.setItemAsync(KEY, value);
}

export async function loadCredentials(): Promise<SavedCredentials | null> {
  let raw: string | null;
  if (Platform.OS === 'web') {
    raw = globalThis.localStorage?.getItem(KEY) ?? null;
  } else {
    raw = await SecureStore.getItemAsync(KEY);
  }
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as SavedCredentials;
    if (typeof parsed?.email === 'string' && typeof parsed?.password === 'string') {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export async function clearCredentials(): Promise<void> {
  if (Platform.OS === 'web') {
    globalThis.localStorage?.removeItem(KEY);
    return;
  }
  await SecureStore.deleteItemAsync(KEY);
}
