import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { setHapticsEnabled } from '@/lib/haptics';
import { releaseSounds, setSoundEnabled } from '@/lib/sound';
import {
  DEFAULT_APP_SETTINGS,
  loadAppSettings,
  saveAppSettings,
  type AppSettings,
} from '@/lib/preferences-store';

type AppSettingsContextValue = {
  settings: AppSettings;
  /** true, solange die gespeicherten Werte noch geladen werden. */
  loading: boolean;
  /** Einen Schalter umlegen – wird sofort angewendet und im Hintergrund gesichert. */
  update: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
};

const AppSettingsContext = createContext<AppSettingsContextValue | null>(null);

/**
 * Hält die Einstellungen, die ohne Server auskommen (Benachrichtigungswünsche,
 * Standortnutzung), und macht sie der ganzen App zugänglich.
 *
 * Geschrieben wird optimistisch: Der Schalter reagiert sofort, das Sichern
 * läuft nebenher. Ein fehlgeschlagener Schreibvorgang darf die Bedienung nicht
 * blockieren – schlimmstenfalls steht die Auswahl beim nächsten Start wieder
 * auf dem alten Wert.
 */
export function AppSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      const stored = await loadAppSettings();
      if (active) {
        setSettings(stored);
        setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const update = useCallback<AppSettingsContextValue['update']>((key, value) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      void saveAppSettings(next);
      return next;
    });
  }, []);

  /**
   * Den Vibrations-Schalter an das Haptik-Modul weitergeben.
   *
   * Die Haptik-Funktionen werden aus Ereignis-Handlern überall in der App
   * gerufen, oft weit weg von React. Ein Hook würde jeden Aufrufer zur
   * Komponente machen – also spiegeln wir den einen Schalter einmal hierhin,
   * wo er ohnehin schon liegt.
   */
  useEffect(() => {
    setHapticsEnabled(settings.haptics);
  }, [settings.haptics]);

  /**
   * Dasselbe für die Klänge – mit einem Unterschied: Beim Abschalten werden die
   * Native-Player abgeräumt. Ein stiller Player, der weiter Speicher und einen
   * Audio-Kanal hält, ist genau die Art Rest, die man später nicht mehr findet.
   */
  useEffect(() => {
    setSoundEnabled(settings.sounds);
    if (!settings.sounds) releaseSounds();
  }, [settings.sounds]);

  const value = useMemo(() => ({ settings, loading, update }), [settings, loading, update]);

  return <AppSettingsContext.Provider value={value}>{children}</AppSettingsContext.Provider>;
}

/**
 * Einstellungen lesen und ändern. Ohne Provider gelten die Vorgaben – so
 * crasht keine Komponente, die außerhalb gerendert wird (z. B. in Tests).
 */
export function useAppSettings(): AppSettingsContextValue {
  return (
    useContext(AppSettingsContext) ?? {
      settings: DEFAULT_APP_SETTINGS,
      loading: false,
      update: () => {},
    }
  );
}
