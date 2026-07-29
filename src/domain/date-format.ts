/**
 * Datum und Uhrzeit als Text.
 *
 * ## Warum es diese Datei gibt
 *
 * Vor dieser Änderung stand `const pad = (n) => String(n).padStart(2, '0')` in
 * zwölf Dateien, und darüber jeweils eine eigene `formatDate`-Funktion – drei
 * davon Zeichen für Zeichen identisch, zwei weitere unterschieden sich nur in
 * einem Komma. Das ist die Sorte Doppelung, die nicht auffällt, solange niemand
 * etwas ändert: Wer das Format anpassen will, ändert eine Stelle, und die App
 * zeigt danach zwei Formate.
 *
 * Jede Funktion hier nimmt einen ISO-String (so kommt es aus der API) und gibt
 * Text zurück. Ein `null` oder ein unlesbarer Wert ergibt einen **leeren Text**
 * und keinen Fehler: Diese Werte kommen aus dem Netz, und ein fehlendes Datum ist
 * dort normal, kein Ausnahmefall.
 *
 * ## Kein `Intl`
 *
 * Alles ist von Hand gebaut. `Intl.DateTimeFormat` ist auf Hermes (der
 * JS-Maschine von React Native) nicht überall vollständig vorhanden – je nach
 * Build fehlen Zeitzonen oder Sprachdaten, und dann steht plötzlich ein
 * englisches Datum in der App. Die Formate hier sind ohnehin deutsch und fest.
 *
 * ## Alles rechnet in LOKALER Zeit
 *
 * `getDate()` und Geschwister, nicht `getUTC…`: Angezeigt wird, was auf der Uhr
 * der Nutzer:in steht. Für „ist das derselbe Tag?" gilt derselbe Grundsatz wie in
 * {@link ./day.ts} – der Kalendertag entscheidet, nicht der Abstand in Stunden.
 */

const pad = (value: number) => String(value).padStart(2, '0');

/** Deutsche Wochentags-Kürzel, indexiert wie `Date.getDay()`. */
const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'] as const;

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

/**
 * ISO-String → `Date`, oder `null`, wenn daraus kein Datum wird.
 *
 * Der eine Ort, an dem geprüft wird, ob überhaupt ein Datum vorliegt. Alle
 * Funktionen unten fangen damit an, deshalb muss keine von ihnen es noch einmal
 * selbst tun.
 */
function parse(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Stehen beide Zeitpunkte am selben Kalendertag (lokal)? */
function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** `TT.MM.JJJJ` – z. B. „04.07.2026". */
export function formatDay(iso: string | null | undefined): string {
  const date = parse(iso);
  if (!date) return '';
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`;
}

/** `TT.MM.` – für schmale Achsen und Zeilen, wo das Jahr nur Platz kostet. */
export function formatDayShort(iso: string | null | undefined): string {
  const date = parse(iso);
  if (!date) return '';
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.`;
}

/** `HH:MM` – z. B. „18:30". */
export function formatClock(iso: string | null | undefined): string {
  const date = parse(iso);
  if (!date) return '';
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * `TT.MM.JJJJ, HH:MM` – die Form auf Event-Karten und im Detail-Popup.
 *
 * Das Komma ist Absicht und der Unterschied zu {@link formatDateTimeCompact}:
 * Hier liest jemand ein Datum in einem Satz, dort steht es in einer Tabelle.
 */
export function formatDateTime(iso: string | null | undefined): string {
  const date = parse(iso);
  if (!date) return '';
  return `${formatDay(iso)}, ${formatClock(iso)}`;
}

/** `TT.MM.JJJJ HH:MM` – die Form im Admin-Bereich (ohne Komma). */
export function formatDateTimeCompact(iso: string | null | undefined): string {
  const date = parse(iso);
  if (!date) return '';
  return `${formatDay(iso)} ${formatClock(iso)}`;
}

/** `TT.MM. HH:MM` – wenn das Jahr aus dem Zusammenhang klar ist (Storys). */
export function formatDayTimeShort(iso: string | null | undefined): string {
  const date = parse(iso);
  if (!date) return '';
  return `${formatDayShort(iso)} ${formatClock(iso)}`;
}

/**
 * Trennzeile zwischen den Tagen im Chat: „Heute", „Gestern", „Fr, 24.07."
 * oder das vollständige Datum.
 *
 * Die Abstufung folgt dem, was man beim Zurückscrollen wissen will: Bei den
 * letzten Tagen genügt der Wochentag („war das nicht Freitag?"), älteres braucht
 * ein Datum. Entscheidend ist der **Kalendertag** und nicht der Abstand in
 * Stunden – sonst hieße eine Nachricht von gestern 23:50 Uhr um 0:10 Uhr noch
 * „Heute".
 */
export function formatDaySeparator(iso: string | null | undefined, now: Date): string {
  const date = parse(iso);
  if (!date) return '';

  if (sameDay(date, now)) return 'Heute';

  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (sameDay(date, yesterday)) return 'Gestern';

  // Innerhalb der letzten Woche: Wochentag + Tag/Monat. Gerechnet wird über den
  // Tagesbeginn, damit die Uhrzeit die Grenze nicht verschiebt.
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const daysAgo = Math.round((startOfToday.getTime() - startOfDate.getTime()) / (24 * HOUR_MS));

  if (daysAgo > 0 && daysAgo < 7) {
    return `${WEEKDAYS[date.getDay()]}, ${formatDayShort(iso)}`;
  }

  return formatDay(iso);
}

/**
 * Kurzform für die Chat-Übersicht: „jetzt", „vor 15 Min", „vor 3 Std",
 * „Gestern", „20.07.".
 *
 * Ein Zeitpunkt in der Zukunft gilt als „jetzt". Das ist kein theoretischer Fall:
 * Die Uhr des Geräts weicht regelmäßig um Sekunden von der des Servers ab, und
 * „vor -1 Min" wäre die schlechtere Antwort darauf.
 */
export function formatRelativeShort(iso: string | null | undefined, now: Date): string {
  const date = parse(iso);
  if (!date) return '';

  const elapsed = now.getTime() - date.getTime();

  if (elapsed < MINUTE_MS) return 'jetzt';
  if (elapsed < HOUR_MS) return `vor ${Math.floor(elapsed / MINUTE_MS)} Min`;
  if (sameDay(date, now)) return `vor ${Math.floor(elapsed / HOUR_MS)} Std`;

  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (sameDay(date, yesterday)) return 'Gestern';

  return formatDayShort(iso);
}
