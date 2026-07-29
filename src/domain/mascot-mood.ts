/**
 * Wie Goenni auf welchem Tab auftritt – reine Zuordnung, kein React.
 *
 * ## Warum das eine eigene Datei ist
 *
 * Die Figur soll auf jedem Tab **anders reagieren**, nicht überall gleich
 * dastehen. Diese Regel gehört an eine Stelle: Läge sie in den Screens, würde der
 * fünfte Tab irgendwann „idle" bekommen, weil niemand mehr weiß, was die anderen
 * vier haben – und die Figur wäre wieder Tapete.
 *
 * ## Drei Dinge pro Tab
 *
 *  - **Gesichter** (`moods`): mehr als eines, damit die Figur nicht einfriert.
 *    Der Wechsel bleibt innerhalb des Charakters des Tabs – auf der Startseite
 *    zwischen „freundlich" und „wach", nicht zwischen „jubelnd" und „schläfrig".
 *    Ein Gesichtswechsel ist Variation, keine neue Information: Man darf ihn
 *    verpassen, ohne etwas zu verlieren.
 *  - **Geste** (`gesture`): was der Körper dazu tut. Winken dort, wo man jemanden
 *    begrüßt oder trifft; Umsehen dort, wo gesucht wird; Nicken als stilles
 *    „stimmt"; nichts dort, wo nichts los ist.
 *  - **Satz** (`line`): auch der Vorlesetext. Eine Figur ohne Text wäre für
 *    Screenreader stumm.
 *
 * ## Die Regel dahinter
 *
 * Jeder Tab bekommt, was zu dem passt, was man dort TUT:
 *  - **Startseite** – begrüßen: freundlich, und sie winkt.
 *  - **Karte** – suchen: nachdenklich, Augen wandern deutlich.
 *  - **Freunde** – Leute treffen: der große Moment, also jubeln und winken.
 *  - **Aktivitäten** – der eigene Verlauf: zufrieden, ein Nicken.
 *  - **Einstellungen** – hier passiert nichts Aufregendes: ruhig, keine Geste.
 */

/** Die Stimmungen der Figur (gleiche Namen wie in `components/mascot.tsx`). */
export type MascotMood = 'idle' | 'happy' | 'thinking' | 'asleep' | 'cheer' | 'oops';

/**
 * Was der Körper tut.
 *
 * `look` ist bewusst eine eigene Geste und nicht „keine": Die Augen wandern immer
 * ein wenig, auf der Karte aber weiter und häufiger – dort ist Suchen die
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

/** Die Tabs der unteren Leiste – zugleich die Schlüssel dieser Tabelle. */
export const TAB_KEYS = ['home', 'map', 'friends', 'activities', 'settings'] as const;

export type TabKey = (typeof TAB_KEYS)[number];

export type MascotReaction = {
  /**
   * Die Hauptstimmung – das erste Gesicht und der Rückfall, wenn nicht gewechselt
   * wird (etwa bei abgeschalteter Bewegung).
   */
  mood: MascotMood;
  /** Die Gesichter, zwischen denen gewechselt wird. Immer mindestens eines. */
  moods: readonly MascotMood[];
  gesture: MascotGesture;
  /** Was die Figur „sagt" – eine Zeile, die auch vorgelesen werden kann. */
  line: string;
};

/** Ohne die Hauptstimmung doppelt schreiben zu müssen: sie ist immer die erste. */
function reaction(
  moods: readonly [MascotMood, ...MascotMood[]],
  gesture: MascotGesture,
  line: string,
): MascotReaction {
  return { mood: moods[0], moods, gesture, line };
}

const REACTIONS: Record<TabKey, MascotReaction> = {
  home: reaction(['happy', 'idle'], 'wave', 'Schön, dass du da bist!'),
  map: reaction(['thinking', 'idle'], 'look', 'Mal sehen, was in der Nähe läuft …'),
  friends: reaction(['cheer', 'happy'], 'wave', 'Zusammen ist es schöner!'),
  activities: reaction(['idle', 'happy'], 'nod', 'Das hast du alles schon gemacht.'),
  // Nur ein Gesicht: Wer schläft, wechselt den Ausdruck nicht.
  settings: reaction(['asleep'], 'none', 'Hier ist alles ruhig.'),
};

/** Stimmung, Geste und Satz für einen Tab. Unbekannte Schlüssel fallen auf `home`. */
export function reactionFor(tab: string): MascotReaction {
  return REACTIONS[tab as TabKey] ?? REACTIONS.home;
}

/**
 * Das Gesicht eines Tabs im Schritt `step`.
 *
 * Läuft im Kreis und verträgt jede Zahl – auch negative und krumme. Das ist
 * wichtig, weil `step` aus einem Zähler kommt, der beliebig weit läuft: Ein
 * Zähler, der irgendwann aus dem Feld läuft, würde die Figur einfrieren.
 */
export function moodAt(tab: string, step: number): MascotMood {
  const { moods } = reactionFor(tab);
  if (!Number.isFinite(step)) return moods[0];
  const index = Math.floor(step) % moods.length;
  return moods[index < 0 ? index + moods.length : index];
}

/**
 * Was die Figur im Fehlerfall sagt.
 *
 * Steht hier und nicht im Fehler-Baustein, damit „Oh oh" und die Erklärung
 * dieselbe Quelle haben wie die Tab-Sätze – und damit ein Test sie festhalten
 * kann. Der Ton ist Absicht: „Oh oh" nimmt dem Fehler die Schärfe, ohne ihn
 * kleinzureden, und der zweite Satz sagt trocken, was los ist.
 */
export const ERROR_REACTION = {
  mood: 'oops' as const,
  headline: 'Oh oh',
  line: 'Es ist ein Fehler aufgetreten.',
};
