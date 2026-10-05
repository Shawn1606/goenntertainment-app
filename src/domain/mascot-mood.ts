/**
 * Goennis Gesichter und Gesten – reine Typen und Texte, kein React.
 *
 * Was er wann sagt, steht in `mascot-tips.ts` (Startseite, passend zum Stand der
 * Person). Hier liegt nur, was die Figur überhaupt kann, und ihr Satz im
 * Fehlerfall.
 */

/** Die Stimmungen der Figur (gleiche Namen wie in `components/mascot.tsx`). */
export type MascotMood = 'idle' | 'happy' | 'thinking' | 'asleep' | 'cheer' | 'oops';

/**
 * Was der Körper tut.
 *
 * `look` ist bewusst eine eigene Geste und nicht „keine": Die Augen wandern immer
 * ein wenig, beim Suchen aber weiter und häufiger – dort ist Suchen die
 * Tätigkeit und nicht bloß ein Lebenszeichen.
 */
export type MascotGesture =
  /** Ein Arm hebt sich und wedelt zweimal. */
  | 'wave'
  /** Deutliches Umsehen: größere Blickwinkel, kürzere Pausen. */
  | 'look'
  /** Kurzes Kippen – liest sich als stilles „stimmt". */
  | 'nod'
  /** Nur Atmen, Hüpfen und das übliche Blinzeln. */
  | 'none';

/**
 * Was die Figur im Fehlerfall sagt.
 *
 * Steht hier und nicht im Fehler-Baustein, damit ein Test den Ton festhalten
 * kann. „Oh oh" nimmt dem Fehler die Schärfe, ohne ihn kleinzureden, und der
 * zweite Satz sagt trocken, was los ist.
 */
export const ERROR_REACTION = {
  mood: 'oops' as const,
  headline: 'Oh oh',
  line: 'Es ist ein Fehler aufgetreten.',
};
