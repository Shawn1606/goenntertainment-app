import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Kleiner Speicher für App-Einstellungen (keine Geheimnisse), z. B. die
 * gewählte Theme-Voreinstellung. Gleiches Muster wie token-store:
 * - Handy (iOS/Android): expo-secure-store.
 * - Web: localStorage.
 */
const THEME_KEY = 'goenn_theme_preference';

/** null = dem System folgen. */
export type ThemePreference = 'light' | 'dark' | null;

function isValid(value: string | null): value is 'light' | 'dark' {
  return value === 'light' || value === 'dark';
}

export async function loadThemePreference(): Promise<ThemePreference> {
  let stored: string | null;
  if (Platform.OS === 'web') {
    stored = globalThis.localStorage?.getItem(THEME_KEY) ?? null;
  } else {
    stored = await SecureStore.getItemAsync(THEME_KEY);
  }
  return isValid(stored) ? stored : null;
}

export async function saveThemePreference(preference: ThemePreference): Promise<void> {
  if (Platform.OS === 'web') {
    if (preference) {
      globalThis.localStorage?.setItem(THEME_KEY, preference);
    } else {
      globalThis.localStorage?.removeItem(THEME_KEY);
    }
    return;
  }

  if (preference) {
    await SecureStore.setItemAsync(THEME_KEY, preference);
  } else {
    await SecureStore.deleteItemAsync(THEME_KEY);
  }
}
