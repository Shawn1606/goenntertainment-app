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
  /**
   * Zurück auf „dem System folgen“.
   *
   * Heißt bewusst nicht `useSystem`: alles mit `use…` gilt der Lint-Regel für
   * Hooks als Hook und darf dann nicht in einem Callback aufgerufen werden.
   */
  followSystem: () => void;
};

const ThemePreferenceContext = createContext<ThemePreferenceContextValue | null>(null);

/**
 * Erzwungenes Schema für einen Teilbaum. Nötig für die Anmelde-Screens: deren
 * Hintergrund ist bewusst immer hell, also müssen auch Felder, Karten und
 * Texte darin hell bleiben – selbst wenn im Konto Dark-Mode gewählt ist.
 */
const SchemeOverrideContext = createContext<'light' | 'dark' | null>(null);

export function ForceScheme({
  scheme,
  children,
}: {
  scheme: 'light' | 'dark';
  children: ReactNode;
}) {
  return <SchemeOverrideContext.Provider value={scheme}>{children}</SchemeOverrideContext.Provider>;
}

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
      followSystem: () => apply(null),
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
  const override = useContext(SchemeOverrideContext);
  const ctx = useContext(ThemePreferenceContext);
  const systemScheme = useColorScheme();
  if (override) return override;
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
