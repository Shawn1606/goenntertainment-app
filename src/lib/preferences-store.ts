import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Kleiner Speicher für App-Einstellungen (keine Geheimnisse), z. B. die
 * gewählte Theme-Voreinstellung. Gleiches Muster wie token-store:
 * - Handy (iOS/Android): expo-secure-store.
 * - Web: localStorage.
 */
const THEME_KEY = 'goenn_theme_preference';
const SETTINGS_KEY = 'goenn_app_settings';

/** null = dem System folgen. */
export type ThemePreference = 'light' | 'dark' | null;

function isValid(value: string | null): value is 'light' | 'dark' {
  return value === 'light' || value === 'dark';
}

/**
 * Schalter aus den Einstellungen, die kein Server-Konto brauchen.
 *
 * Bewusst ein einziges Objekt statt vieler Schlüssel: Ein neuer Schalter ist
 * eine Zeile hier plus eine Zeile in {@link DEFAULT_APP_SETTINGS} – Laden,
 * Speichern und die Rückfall-Logik bleiben unverändert.
 */
export type AppSettings = {
  /** Neue Events im Umkreis. */
  notifyNearby: boolean;
  /** Erinnerung, bevor ein Event startet. */
  notifyReminder: boolean;
  /** Jemand tritt einem eigenen Event bei. */
  notifyJoins: boolean;
  /** Änderungen an Events, bei denen man dabei ist. */
  notifyUpdates: boolean;
  /** Wochenrückblick per Mail. */
  notifyDigest: boolean;
  /** Standort für „In deiner Nähe" und Entfernungen benutzen. */
  useLocation: boolean;
  /**
   * Kurze Vibration bei Auswahl, Beitreten und Fehlern.
   *
   * An, weil eine fühlbare Rückmeldung verhindert, dass man aus Unsicherheit ein
   * zweites Mal tippt. Abschaltbar, weil Vibration für manche Menschen
   * unangenehm oder bei Reisekrankheit und Tremor sogar störend ist – und weil
   * sie Akku kostet.
   */
  haptics: boolean;
  /**
   * Kurze Klänge bei Beitreten, Fehlern und erreichten Zielen.
   *
   * **Aus**, und das ist der wichtigere Teil der Vorgabe. Vibration spürt nur
   * die Person am Gerät; einen Ton hören alle im Bus mit. Klänge, die ungefragt
   * an sind, sind der häufigste Grund, warum Leute den ganzen Bereich
   * abschalten – also fragen wir. Details in `src/lib/sound.ts`.
   */
  sounds: boolean;
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  notifyNearby: true,
  notifyReminder: true,
  notifyJoins: true,
  notifyUpdates: true,
  notifyDigest: false,
  useLocation: true,
  haptics: true,
  sounds: false,
};

/** Nur bekannte Schlüssel übernehmen – alles andere kommt aus den Vorgaben. */
function mergeSettings(raw: unknown): AppSettings {
  if (!raw || typeof raw !== 'object') return DEFAULT_APP_SETTINGS;

  const source = raw as Record<string, unknown>;
  const merged = { ...DEFAULT_APP_SETTINGS };
  for (const key of Object.keys(DEFAULT_APP_SETTINGS) as (keyof AppSettings)[]) {
    if (typeof source[key] === 'boolean') merged[key] = source[key] as boolean;
  }
  return merged;
}

async function readRaw(key: string): Promise<string | null> {
  if (Platform.OS === 'web') return globalThis.localStorage?.getItem(key) ?? null;
  return SecureStore.getItemAsync(key);
}

export async function loadAppSettings(): Promise<AppSettings> {
  try {
    const stored = await readRaw(SETTINGS_KEY);
    return stored ? mergeSettings(JSON.parse(stored)) : DEFAULT_APP_SETTINGS;
  } catch {
    // Kaputter oder alter Eintrag darf den Start nicht blockieren.
    return DEFAULT_APP_SETTINGS;
  }
}

export async function saveAppSettings(settings: AppSettings): Promise<void> {
  const value = JSON.stringify(settings);
  if (Platform.OS === 'web') {
    globalThis.localStorage?.setItem(SETTINGS_KEY, value);
    return;
  }
  await SecureStore.setItemAsync(SETTINGS_KEY, value);
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
