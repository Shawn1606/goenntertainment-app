/**
 * Kalendertage – die paar Datums-Griffe, die mehrere Regeln brauchen.
 *
 * Liegt absichtlich in einer eigenen Datei: Sowohl die Serie (`streak.ts`) als
 * auch die Dringlichkeit auf den Karten (`urgency.ts`) müssen „ist das derselbe
 * Tag?" beantworten. Zwei Kopien derselben Datumsrechnung wären genau die Art
 * von Doppelung, die später auseinanderläuft.
 *
 * Alles rechnet in LOKALER Zeit bzw. wandelt zum Verschieben nach UTC-Mittag –
 * nie mit `Intl`, weil das auf Hermes nicht überall vollständig vorhanden ist.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Deutsche Wochentags-Kürzel, indexiert wie `Date.getDay()`. */
const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'] as const;

/** Lokales Datum als `YYYY-MM-DD`. */
export function dayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Tagesschlüssel um `delta` Tage verschieben.
 *
 * Rechnet in UTC-Mittag: Über eine Zeitumstellung hinweg hat ein lokaler Tag 23
 * oder 25 Stunden, und „+86400000 ms" landet dann auf demselben oder einem
 * übersprungenen Datum. Von UTC-Mittag aus ist der Abstand immer genau ein Tag.
 */
export function shiftDay(key: string, delta: number): string {
  const [year, month, day] = key.split('-').map(Number);
  const at = Date.UTC(year, (month ?? 1) - 1, day ?? 1, 12);
  const moved = new Date(at + delta * DAY_MS);
  const mm = String(moved.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(moved.getUTCDate()).padStart(2, '0');
  return `${moved.getUTCFullYear()}-${mm}-${dd}`;
}

/**
 * Abstand zweier Tagesschlüssel in Tagen (`b - a`).
 *
 * Aus demselben Grund über UTC-Mittag gerechnet wie {@link shiftDay}: Läge ein
 * Zeitumstellungs-Tag zwischen den beiden, käme sonst 0,96 oder 1,04 heraus –
 * und nach dem Runden gelegentlich der falsche Tag.
 */
export function dayDiff(a: string, b: string): number {
  const at = (key: string) => {
    const [year, month, day] = key.split('-').map(Number);
    return Date.UTC(year, (month ?? 1) - 1, day ?? 1, 12);
  };
  return Math.round((at(b) - at(a)) / DAY_MS);
}

/** Wochentags-Kürzel zu einem Tagesschlüssel, z. B. „Mo". */
export function weekdayShort(key: string): string {
  const [year, month, day] = key.split('-').map(Number);
  const at = new Date(Date.UTC(year, (month ?? 1) - 1, day ?? 1, 12));
  return WEEKDAYS[at.getUTCDay()];
}

/** Uhrzeit als „HH:MM" (lokal). */
export function clockTime(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
