/**
 * Begrüßung nach Tageszeit – reine Logik, keine Anzeige.
 *
 * Stand vorher direkt im Startseiten-Screen. Hier gehört sie hin, weil sie zwei
 * Dinge tut, die man prüfen können muss: Sie schneidet den Tag in Abschnitte
 * (und an Grenzen wie 5, 11, 17, 22 Uhr passieren die Fehler), und sie holt aus
 * einem eingegebenen Namen den Vornamen heraus – bei Eingaben, die Menschen
 * machen, also mit doppelten Leerzeichen, nur Nachname oder gar nichts.
 *
 * Das Symbol kommt als **Name** zurück, nicht als Zeichen: Die Tageszeit ist
 * eine Aussage über den Tag, wie sie gezeichnet wird, entscheidet die Anzeige.
 */
import type { UiIconName } from './ui-icon.ts';

export type Greeting = {
  /** „Guten Morgen", „Hallo" … */
  text: string;
  /** Passendes Symbol: Sonnenauf-/untergang, Sonne, Mond. */
  icon: UiIconName;
};

/**
 * Abschnitte des Tages, aufsteigend nach oberer Grenze (Stunde, exklusiv).
 *
 * Als Tabelle statt if-Kette: Wer eine Zeit verschieben will, ändert eine Zahl
 * und sieht dabei alle anderen Grenzen daneben stehen.
 */
const SECTIONS: readonly { until: number; text: string; icon: UiIconName }[] = [
  { until: 5, text: 'Noch wach', icon: 'moon' },
  { until: 11, text: 'Guten Morgen', icon: 'sunrise' },
  { until: 17, text: 'Hallo', icon: 'sun' },
  { until: 22, text: 'Guten Abend', icon: 'sunset' },
];

/** Nach dem letzten Abschnitt (ab 22 Uhr). */
const LATE: Greeting = { text: 'Gute Nacht', icon: 'moon' };

/**
 * Begrüßung zur übergebenen Uhrzeit.
 *
 * @param date Referenzzeit. Wird übergeben, damit die Funktion testbar bleibt
 *   und nicht heimlich an der Systemuhr hängt – gleiches Muster wie in
 *   `streak.ts` und `urgency.ts`.
 */
export function greetingFor(date: Date): Greeting {
  const hours = date.getHours();
  // Eine ungültige Zeit (`new Date('kaputt')`) liefert NaN. Dann lieber der
  // neutrale Nachtgruß als „Guten undefined".
  if (!Number.isFinite(hours)) return LATE;

  for (const section of SECTIONS) {
    if (hours < section.until) return { text: section.text, icon: section.icon };
  }
  return LATE;
}

/**
 * Vorname aus einem eingegebenen vollen Namen.
 *
 * Nur zum Anreden gedacht („Hallo, Mia"). Absichtlich anspruchslos: Beim ersten
 * Leerzeichen wird geschnitten. Namen sind zu vielfältig, um sie zu zerlegen –
 * wer „Anna-Lena van der Berg" einträgt, wird mit „Anna-Lena" angesprochen, und
 * das ist richtig.
 *
 * @returns Der Vorname, oder `null` wenn nichts Brauchbares übrig bleibt. `null`
 *   statt `''`, damit Aufrufer den Fall bewusst behandeln müssen und nicht
 *   versehentlich „Hallo, " anzeigen.
 */
export function firstName(name: string | null | undefined): string | null {
  if (typeof name !== 'string') return null;
  // Auch mehrfache und ungewöhnliche Leerzeichen trennen.
  const first = name.trim().split(/\s+/)[0] ?? '';
  return first === '' ? null : first;
}

/**
 * Die fertige Anrede: Gruß plus Vorname, wenn einer da ist.
 *
 * Hier zusammengesetzt und nicht im Screen, weil genau an dieser Stelle sonst
 * das Komma zu viel steht („Hallo, "), sobald ein Name fehlt.
 */
export function greetingLine(date: Date, name?: string | null): Greeting {
  const greeting = greetingFor(date);
  const first = firstName(name);
  return first ? { ...greeting, text: `${greeting.text}, ${first}` } : greeting;
}
