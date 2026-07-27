import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  loadThemePreference,
  saveThemePreference,
  type ThemePreference,
} from '@/lib/preferences-store';

type ThemePreferenceContextValue = {
  /** Vom Nutzer gewählt: 'light' | 'dark' | null (= dem System folgen). */
  preference: ThemePreference;
  /** Tatsächlich angewendetes Schema, nachdem System-Fallback aufgelöst wurde. */
  scheme: 'light' | 'dark';
  isDark: boolean;
  /** Dark-Mode an/aus schalten – setzt eine feste Voreinstellung. */
  setDark: (dark: boolean) => void;
  /** Zurück auf „dem System folgen“. */
  useSystem: () => void;
};

const ThemePreferenceContext = createContext<ThemePreferenceContextValue | null>(null);

export function ThemePreferenceProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const [preference, setPreference] = useState<ThemePreference>(null);

  // Gespeicherte Voreinstellung beim Start laden.
  useEffect(() => {
    let active = true;
    (async () => {
      const stored = await loadThemePreference();
      if (active && stored) setPreference(stored);
    })();
    return () => {
      active = false;
    };
  }, []);

  const value = useMemo<ThemePreferenceContextValue>(() => {
    const scheme: 'light' | 'dark' =
      preference ?? (systemScheme === 'dark' ? 'dark' : 'light');

    function apply(next: ThemePreference) {
      setPreference(next);
      // Persistieren im Hintergrund; Fehler sind unkritisch.
      void saveThemePreference(next);
    }

    return {
      preference,
      scheme,
      isDark: scheme === 'dark',
      setDark: (dark) => apply(dark ? 'dark' : 'light'),
      useSystem: () => apply(null),
    };
  }, [preference, systemScheme]);

  return (
    <ThemePreferenceContext.Provider value={value}>{children}</ThemePreferenceContext.Provider>
  );
}

/**
 * Aufgelöstes Farbschema ('light' | 'dark'). Fällt ohne Provider auf das
 * System-Schema zurück, damit einzelne Komponenten nie crashen.
 */
export function useResolvedScheme(): 'light' | 'dark' {
  const ctx = useContext(ThemePreferenceContext);
  const systemScheme = useColorScheme();
  if (ctx) return ctx.scheme;
  return systemScheme === 'dark' ? 'dark' : 'light';
}

export function useThemePreference(): ThemePreferenceContextValue {
  const ctx = useContext(ThemePreferenceContext);
  if (!ctx) {
    throw new Error('useThemePreference muss innerhalb von <ThemePreferenceProvider> benutzt werden.');
  }
  return ctx;
}
