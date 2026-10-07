/**
 * Wie weit ist eine Gruppe bis zur nächsten Rabattstufe?
 *
 * Die Gruppenkarte zeigt einen Balken: „−10 % – noch 2 Personen bis −12,5 %".
 * Das macht den Gruppenrabatt greifbar: Man sieht, dass Einladen etwas bringt.
 * Gerechnet wird mit denselben Regeln wie beim Buchen (`discountFor`, shared/club.json).
 */
import { discountFor, type ClubRules } from './club.ts';

export type DiscountStep = {
  /** Rabatt heute, mit `people` Personen. */
  percent: number;
  /** Nächste Stufe – `null`, wenn es nicht mehr mehr gibt (Höchstrabatt erreicht). */
  next: { people: number; percent: number } | null;
  /** Anteil auf dem Weg zur nächsten Stufe, 0 … 1 (1 = Höchstrabatt). */
  progress: number;
};

/** Ab so vielen Personen wird nicht weiter gesucht – größere Gruppen bucht niemand über die App. */
const SEARCH_LIMIT = 30;

export function discountStep(rules: ClubRules, plan: string | null | undefined, people: number): DiscountStep {
  const count = Math.max(1, Math.floor(Number.isFinite(people) ? people : 1));
  const percent = discountFor(rules, plan, count).percent;

  // Wo begann die aktuelle Stufe? (Für den Balken: von dort bis zur nächsten.)
  let start = count;
  while (start > 1 && discountFor(rules, plan, start - 1).percent === percent) start--;

  for (let n = count + 1; n <= SEARCH_LIMIT; n++) {
    const p = discountFor(rules, plan, n).percent;
    if (p > percent) {
      const span = n - start;
      return { percent, next: { people: n, percent: p }, progress: span > 0 ? (count - start) / span : 0 };
    }
  }
  return { percent, next: null, progress: 1 };
}
