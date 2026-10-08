/**
 * Welche Funktionen dieses Konto sieht – und das Stadt-Bingo, wenn es an ist.
 *
 * Kommt vom Server (GET /api/features, App\Support\Features): für normale
 * Nutzer, was ein Admin „für alle" freigeschaltet hat; für Admins zusätzlich
 * ihre Vorschau „nur für mich". Ohne Anmeldung oder bei einem Fehler gilt
 * `DEFAULT_FEATURES` (Bingo aus, Saison nach Datum) – die App läuft also auch,
 * wenn der Server die Schalter noch nicht kennt.
 *
 * Das Bingo lädt nur, wenn es freigeschaltet ist; Startseite (Vorschau) und
 * Bingo-Bildschirm teilen sich denselben Stand.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { DEFAULT_FEATURES, isSeasonKey, type BingoState, type FeatureState } from '@/domain/features';
import { keepIfSame } from '@/domain/same-data';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

type FeaturesValue = {
  features: FeatureState;
  /** Neu laden – z. B. nachdem ein Admin einen Schalter umgelegt hat. */
  refresh: () => Promise<void>;
  /** Stand des Stadt-Bingos, `null` solange aus oder nicht geladen. */
  bingo: BingoState | null;
  setBingo: (bingo: BingoState) => void;
  refreshBingo: () => Promise<void>;
};

const FeaturesContext = createContext<FeaturesValue>({
  features: DEFAULT_FEATURES,
  refresh: async () => {},
  bingo: null,
  setBingo: () => {},
  refreshBingo: async () => {},
});

export function useFeatures(): FeaturesValue {
  return useContext(FeaturesContext);
}

/**
 * Die Schalter aus der Server-Antwort; ein unbekanntes Saison-Thema zählt als keins.
 * Außerhalb der Komponente: Eine Bedingung in einem `try` kann der React Compiler
 * nicht übersetzen, und dann bliebe der ganze Provider unübersetzt.
 */
function featuresFrom(data: { bingo?: unknown; season?: unknown }): FeatureState {
  return { bingo: data.bingo === true, season: isSeasonKey(data.season) ? data.season : null };
}

export function FeaturesProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const [features, setFeatures] = useState<FeatureState>(DEFAULT_FEATURES);
  const [bingo, setBingo] = useState<BingoState | null>(null);

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const { data } = await api.features(token);
      setFeatures((prev) => keepIfSame(prev, featuresFrom(data)));
    } catch {
      // Ohne Antwort bleibt der letzte Stand – Schalter sind nie lebenswichtig.
    }
  }, [token]);

  const refreshBingo = useCallback(async () => {
    if (!token || !features.bingo) return;
    try {
      setBingo((await api.bingo(token)).data);
    } catch {
      setBingo(null);
    }
  }, [token, features.bingo]);

  // Beim Anmelden/Kontowechsel: Schalter holen (setState erst in der Antwort).
  useEffect(() => {
    if (!token) return;
    let active = true;
    api
      .features(token)
      .then(({ data }) => {
        if (active) setFeatures((prev) => keepIfSame(prev, featuresFrom(data)));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [token]);

  // Bingo nur laden, wenn es für dieses Konto an ist.
  useEffect(() => {
    if (!token || !features.bingo) return;
    let active = true;
    api
      .bingo(token)
      .then(({ data }) => {
        if (active) setBingo(data);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [token, features.bingo]);

  // Abgemeldet oder Bingo aus: abgeleitet statt im Effekt zurückgesetzt.
  const current = token ? features : DEFAULT_FEATURES;
  const shownBingo = token && current.bingo ? bingo : null;
  const value = useMemo(
    () => ({ features: current, refresh, bingo: shownBingo, setBingo, refreshBingo }),
    [current, refresh, shownBingo, refreshBingo],
  );

  return <FeaturesContext.Provider value={value}>{children}</FeaturesContext.Provider>;
}
