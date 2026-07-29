import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatClock,
  formatDateTime,
  formatDateTimeCompact,
  formatDay,
  formatDayShort,
  formatDaySeparator,
  formatDayTimeShort,
  formatRelativeShort,
} from './date-format.ts';

/**
 * Feste Zeitpunkte in LOKALER Zeit gebaut.
 *
 * Bewusst mit `new Date(jahr, monat, tag, ...)` und nicht aus einem ISO-String
 * mit „Z": Alle Funktionen hier zeigen lokale Zeit an, und ein Test, der von
 * einer UTC-Zeichenkette ausgeht, wuerde je nach Zeitzone des Rechners ein
 * anderes Ergebnis erwarten.
 */
const at = (y: number, m: number, d: number, h = 0, min = 0) =>
  new Date(y, m - 1, d, h, min).toISOString();

/* ------------------------------------------------------------- Grundformen */

test('Datum und Uhrzeit in der Form, die die App ueberall zeigt', () => {
  assert.equal(formatDateTime(at(2026, 7, 4, 9, 5)), '04.07.2026, 09:05');
  assert.equal(formatDay(at(2026, 12, 31, 23, 59)), '31.12.2026');
  assert.equal(formatDayShort(at(2026, 1, 2)), '02.01.');
  assert.equal(formatClock(at(2026, 7, 4, 18, 30)), '18:30');
});

test('die Admin-Formen unterscheiden sich nur im Komma bzw. im Jahr', () => {
  // Diese beiden gab es doppelt in admin-evidence.tsx und admin-moderation.tsx
  // bzw. in admin-stories.tsx – deshalb stehen sie hier und nicht dort.
  assert.equal(formatDateTimeCompact(at(2026, 7, 4, 9, 5)), '04.07.2026 09:05');
  assert.equal(formatDayTimeShort(at(2026, 7, 4, 9, 5)), '04.07. 09:05');
});

test('einstellige Tage und Monate bekommen ihre Null', () => {
  assert.equal(formatDay(at(2026, 3, 7)), '07.03.2026');
  assert.equal(formatClock(at(2026, 3, 7, 8, 9)), '08:09');
});

test('was kein Datum ist, ergibt einen leeren Text und keinen Absturz', () => {
  // Der Grund: Diese Werte kommen aus der API und sind dort oft `null`.
  for (const fn of [
    formatDateTime,
    formatDay,
    formatDayShort,
    formatClock,
    formatDateTimeCompact,
    formatDayTimeShort,
  ]) {
    assert.equal(fn(null), '');
    assert.equal(fn(''), '');
    assert.equal(fn('kaputt'), '');
  }
});

/* -------------------------------------------------- Trennzeile im Chat */

test('der heutige Tag heisst „Heute", der davor „Gestern"', () => {
  const now = new Date(2026, 6, 28, 14, 0);
  assert.equal(formatDaySeparator(at(2026, 7, 28, 9, 0), now), 'Heute');
  assert.equal(formatDaySeparator(at(2026, 7, 27, 23, 59), now), 'Gestern');
});

test('innerhalb der letzten Woche steht der Wochentag dabei', () => {
  const now = new Date(2026, 6, 28, 14, 0); // Dienstag, 28.07.2026
  // 24.07.2026 ist ein Freitag.
  assert.equal(formatDaySeparator(at(2026, 7, 24, 12, 0), now), 'Fr, 24.07.');
});

test('aelteres steht mit vollem Datum da', () => {
  const now = new Date(2026, 6, 28, 14, 0);
  assert.equal(formatDaySeparator(at(2026, 3, 2, 12, 0), now), '02.03.2026');
});

test('„Heute" haengt am Kalendertag, nicht an 24 Stunden', () => {
  // 00:10 Uhr und 23:50 Uhr desselben Tages sind derselbe Tag – auch wenn
  // dazwischen fast ein ganzer Tag liegt.
  const now = new Date(2026, 6, 28, 0, 10);
  assert.equal(formatDaySeparator(at(2026, 7, 28, 23, 50), now), 'Heute');
  // Und 23:50 Uhr am Vortag ist „Gestern", obwohl es nur 20 Minuten her ist.
  assert.equal(formatDaySeparator(at(2026, 7, 27, 23, 50), now), 'Gestern');
});

/* ------------------------------------------------ Kurzform in der Chatliste */

test('gerade eben heisst „jetzt" – bis genau zur ersten vollen Minute', () => {
  const now = new Date(2026, 6, 28, 14, 0);
  assert.equal(formatRelativeShort(at(2026, 7, 28, 14, 0), now), 'jetzt');
  // 30 Sekunden: noch „jetzt".
  assert.equal(
    formatRelativeShort(new Date(2026, 6, 28, 13, 59, 30).toISOString(), now),
    'jetzt',
  );
  // Genau eine Minute: die Zaehlung faengt an. Die Grenze steht hier im Test,
  // damit sie eine Entscheidung bleibt und nicht ein Zufall der Rechnung wird.
  assert.equal(formatRelativeShort(at(2026, 7, 28, 13, 59), now), 'vor 1 Min');
});

test('Minuten und Stunden werden gezaehlt, danach kommt der Tag', () => {
  const now = new Date(2026, 6, 28, 14, 0);
  assert.equal(formatRelativeShort(at(2026, 7, 28, 13, 45), now), 'vor 15 Min');
  assert.equal(formatRelativeShort(at(2026, 7, 28, 11, 0), now), 'vor 3 Std');
  assert.equal(formatRelativeShort(at(2026, 7, 27, 11, 0), now), 'Gestern');
  assert.equal(formatRelativeShort(at(2026, 7, 20, 11, 0), now), '20.07.');
});

test('ein Zeitpunkt in der Zukunft gilt als „jetzt", nicht als negative Dauer', () => {
  // Passiert echt: Die Uhr des Geraets laeuft der des Servers um Sekunden nach.
  const now = new Date(2026, 6, 28, 14, 0);
  assert.equal(formatRelativeShort(at(2026, 7, 28, 14, 2), now), 'jetzt');
});

test('ohne Zeitpunkt bleibt die Kurzform leer', () => {
  assert.equal(formatRelativeShort(null, new Date()), '');
  assert.equal(formatDaySeparator(null, new Date()), '');
});
