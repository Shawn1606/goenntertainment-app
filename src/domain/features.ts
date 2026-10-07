/**
 * Funktions-Schalter (api/app/Support/Features.php) – Typen und die Texte der
 * Admin-Bildschirme.
 *
 *  - „Funktionen für alle" (admin-features.tsx): Was dort an ist, sehen alle.
 *  - „Nur für mich" (admin-preview.tsx): Ein Admin probiert etwas für sich aus;
 *    ohne Auswahl gilt, was für alle gilt.
 *
 * Das Stadt-Bingo ist aus der Testphase geholt und standardmäßig aus (es läuft
 * zweimal im Jahr). Das Saison-Thema steuert Deko und Goennis Look; `null`
 * heißt „nach Datum".
 */
import type { SeasonKey } from './season.ts';
import type { TestphaseState } from './testphase.ts';

/** Was für das eigene Konto gilt – GET /api/features. */
export type FeatureState = { bingo: boolean; season: SeasonKey | null };

export const DEFAULT_FEATURES: FeatureState = { bingo: false, season: null };

export type FeatureKey = 'bingo' | 'season';

export type PreviewMode = 'inherit' | 'on' | 'off';

export type AdminFeatureState = {
  definitions: { key: FeatureKey; type: 'switch' | 'choice'; label: string; hint: string; choices: string[] | null }[];
  global: { bingo: { enabled: boolean }; season: { value: string } };
  preview: { bingo: { mode: PreviewMode }; season: { value: string | null } };
  effective: FeatureState;
};

/** Das Bingo-Feld, wie es Nutzer bekommen (gleiche Form wie in der Testphase). */
export type BingoState = TestphaseState['bingo'];

/** Beschriftung der Saison-Themen im Admin-Bereich. */
export const SEASON_CHOICE_LABEL: Record<string, string> = {
  auto: 'Automatisch (nach Datum)',
  halloween: 'Halloween',
  advent: 'Advent & Weihnachten',
  newyear: 'Silvester',
  winter: 'Winter',
  valentine: 'Valentinstag',
  easter: 'Ostern',
  spring: 'Frühling',
  summer: 'Sommer',
  autumn: 'Herbst',
};

/** Die drei Stufen der Vorschau in Worten. */
export const PREVIEW_MODE_LABEL: Record<PreviewMode, string> = {
  inherit: 'Wie für alle',
  on: 'An',
  off: 'Aus',
};

/** Ist `value` ein bekanntes Saison-Thema? (Werte kommen vom Server.) */
export function isSeasonKey(value: unknown): value is SeasonKey {
  return typeof value === 'string' && value !== 'auto' && value in SEASON_CHOICE_LABEL;
}
