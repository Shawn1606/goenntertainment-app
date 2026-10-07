/**
 * Goennis Gesichter und Gesten – reine Typen und Texte, kein React.
 *
 * Was er wann sagt, steht in `mascot-tips.ts` (Startseite, passend zum Stand der
 * Person). Hier liegt nur, was die Figur überhaupt kann, und ihr Satz im
 * Fehlerfall.
 */

/** Die Stimmungen der Figur (gleiche Namen wie in `components/mascot.tsx`). */
export type MascotMood =
  | 'idle'
  | 'happy'
  | 'thinking'
  | 'asleep'
  | 'cheer'
  | 'oops'
  /** Ein Auge zu – „du weißt Bescheid". */
  | 'wink'
  /** Herzaugen. */
  | 'love'
  /** Große Augen, O-Mund – Staunen. */
  | 'wow'
  /** Zunge raus, Augen zugekniffen – albern. */
  | 'silly'
  /** Zufrieden lächelnd, Wangen rot – stolz. */
  | 'proud'
  /** Blick nach unten, rote Wangen – verlegen. */
  | 'shy'
  /** Halb geschlossene Augen – müde, aber noch wach. */
  | 'sleepy';

/** Alle Gesichter – damit ein Test prüfen kann, dass jedes gezeichnet ist und keins fehlt. */
export const MASCOT_MOODS: readonly MascotMood[] = ['idle', 'happy', 'thinking', 'asleep', 'cheer', 'oops', 'wink', 'love', 'wow', 'silly', 'proud', 'shy', 'sleepy'];

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

/**
 * Kunststücke: einmalige Bewegungen, die die Figur auf Kommando zeigt – beim
 * Antippen, nach einem Kauf, oder von selbst im „lebendigen" Modus.
 */
export type MascotTrick =
  /** Hüpfer mit Strecken beim Abheben und Stauchen beim Landen. */
  | 'hop'
  /** Salto in der Luft. */
  | 'flip'
  /** Einmal um die eigene Achse drehen. */
  | 'spin'
  /** Hin und her tänzeln, Arme im Wechsel. */
  | 'dance'
  /** Kurz schütteln – „hihi". */
  | 'wiggle'
  /** Beide Arme hoch, zweimal springen, Funkeln. Der große Moment. */
  | 'cheer'
  /** Ein Arm grüßt. */
  | 'wave'
  /** Drei kleine Hüpfer hintereinander. */
  | 'bounce'
  /** Kopfschütteln: „nee, nee". */
  | 'shake'
  /** Ganz lang machen, Arme hoch – und wieder zusammen. */
  | 'stretch'
  /** Kurzes Zittern – „brr" oder Aufregung. */
  | 'shiver'
  /** Über dem Kopf klatschen. */
  | 'clap'
  /** Hin- und herdrehen, als würde er sich umschauen. */
  | 'twist'
  /** Herzen steigen auf. */
  | 'love';

/** Alle Kunststücke (für Tests und Vorschau). */
export const MASCOT_TRICKS: readonly MascotTrick[] = ['hop', 'flip', 'spin', 'dance', 'wiggle', 'cheer', 'wave', 'bounce', 'shake', 'stretch', 'shiver', 'clap', 'twist', 'love'];

/**
 * Was die Figur von selbst zeigt. `hop` und `wave` stehen doppelt drin: Die
 * ruhigen Kunststücke sollen öfter kommen als der Salto, sonst wird aus
 * „lebendig" schnell „zappelig".
 */
export const IDLE_TRICKS: readonly MascotTrick[] = ['hop', 'wave', 'dance', 'bounce', 'hop', 'stretch', 'wave', 'twist', 'spin', 'wiggle', 'clap', 'flip'];

/**
 * Was Goenni beim Antippen zeigt – Kunststück UND Gesicht, der Reihe nach. So
 * sieht jedes Tippen anders aus: Salto mit Jubel, Herzen mit Herzaugen,
 * Kopfschütteln mit Zunge, Zwinkern …
 */
export const POKE_REACTIONS: readonly { trick: MascotTrick; mood: MascotMood }[] = [
  { trick: 'flip', mood: 'cheer' },
  { trick: 'love', mood: 'love' },
  { trick: 'shake', mood: 'silly' },
  { trick: 'twist', mood: 'wink' },
  { trick: 'clap', mood: 'happy' },
  { trick: 'stretch', mood: 'proud' },
  { trick: 'shiver', mood: 'wow' },
  { trick: 'dance', mood: 'cheer' },
  { trick: 'bounce', mood: 'silly' },
  { trick: 'spin', mood: 'wow' },
  { trick: 'wiggle', mood: 'shy' },
  { trick: 'hop', mood: 'wink' },
];

/** Die Reaktion aufs n-te Antippen (1 = erstes Mal). Läuft im Kreis, verträgt jede Zahl. */
export function pokeReaction(count: number): { trick: MascotTrick; mood: MascotMood } {
  const n = Math.max(1, Math.floor(Number.isFinite(count) ? count : 1));
  return POKE_REACTIONS[(n - 1) % POKE_REACTIONS.length];
}

/** Das nächste Kunststück – nie zweimal dasselbe hintereinander. `roll` ist eine Zufallszahl in [0, 1). */
export function pickTrick(previous: MascotTrick | null, roll: number): MascotTrick {
  const safe = Number.isFinite(roll) ? Math.min(Math.max(roll, 0), 0.999999) : 0;
  const index = Math.floor(safe * IDLE_TRICKS.length);
  const trick = IDLE_TRICKS[index];
  return trick === previous ? IDLE_TRICKS[(index + 1) % IDLE_TRICKS.length] : trick;
}

/** Pause bis zum nächsten Kunststück: 3,5–6,5 s – genug, dass der Text daneben gelesen wird. */
export function trickPause(roll: number): number {
  const safe = Number.isFinite(roll) ? Math.min(Math.max(roll, 0), 1) : 0.5;
  return Math.round(3500 + safe * 3000);
}
