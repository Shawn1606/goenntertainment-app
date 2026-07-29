import assert from 'node:assert/strict';
import { test } from 'node:test';

import { clockTime, dayDiff, dayKey, shiftDay, weekdayShort } from './day.ts';

/**
 * Diese Tests standen vorher in `streak.test.ts`. Das war die falsche Adresse:
 * `day.ts` wird von der Serie UND von der Dringlichkeit auf den Karten benutzt,
 * also darf seine Absicherung nicht an einem der beiden Aufrufer hängen. Wer
 * `urgency.ts` anfasst und die Datumsrechnung bricht, soll das nicht in einem
 * Serien-Test lesen.
 */

test('dayKey liefert das lokale Datum als YYYY-MM-DD', () => {
  assert.equal(dayKey(new Date(2026, 0, 5, 23, 30)), '2026-01-05');
  assert.equal(dayKey(new Date(2026, 11, 31, 0, 1)), '2026-12-31');
});

test('dayKey füllt einstellige Monate und Tage auf', () => {
  assert.equal(dayKey(new Date(2026, 2, 7, 12)), '2026-03-07');
});

test('shiftDay laeuft ueber Monats- und Jahresgrenzen', () => {
  assert.equal(shiftDay('2026-01-01', -1), '2025-12-31');
  assert.equal(shiftDay('2026-02-28', 1), '2026-03-01');
  assert.equal(shiftDay('2024-02-28', 1), '2024-02-29'); // Schaltjahr
  assert.equal(shiftDay('2100-02-28', 1), '2100-03-01'); // kein Schaltjahr
});

test('shiftDay ueberspringt bei der Zeitumstellung keinen Tag', () => {
  // 29.03.2026 ist die Nacht der Umstellung auf Sommerzeit (MEZ -> MESZ).
  // Von UTC-Mittag aus gerechnet ist der Abstand immer genau ein Tag; mit
  // „+86400000 ms" auf lokale Mitternacht landete man auf demselben Datum.
  assert.equal(shiftDay('2026-03-28', 1), '2026-03-29');
  assert.equal(shiftDay('2026-03-29', 1), '2026-03-30');
  assert.equal(shiftDay('2026-10-24', 1), '2026-10-25');
  assert.equal(shiftDay('2026-10-25', -1), '2026-10-24');
});

test('shiftDay mit 0 laesst den Tag stehen', () => {
  assert.equal(shiftDay('2026-07-28', 0), '2026-07-28');
});

test('shiftDay verkraftet grosse Spruenge', () => {
  assert.equal(shiftDay('2026-01-01', 365), '2027-01-01');
  assert.equal(shiftDay('2026-01-01', -365), '2025-01-01');
});

test('dayDiff zaehlt Tage in beide Richtungen', () => {
  assert.equal(dayDiff('2026-07-01', '2026-07-08'), 7);
  assert.equal(dayDiff('2026-07-08', '2026-07-01'), -7);
  assert.equal(dayDiff('2026-07-01', '2026-07-01'), 0);
});

test('dayDiff bleibt ueber die Zeitumstellung glatt', () => {
  // Genau der Fall, für den hier gerundet wird: Ein 23- oder 25-Stunden-Tag
  // ergäbe sonst 1,96 bzw. 2,04 – und nach dem Abschneiden den falschen Tag.
  assert.equal(dayDiff('2026-03-28', '2026-03-30'), 2);
  assert.equal(dayDiff('2026-10-24', '2026-10-26'), 2);
});

test('dayDiff rechnet ueber Jahresgrenzen', () => {
  assert.equal(dayDiff('2025-12-30', '2026-01-02'), 3);
});

test('dayDiff ist mit shiftDay konsistent', () => {
  // Die beiden müssen zusammenpassen – die Serie verlässt sich darauf.
  const start = '2026-02-26';
  for (const delta of [-400, -31, -7, -1, 0, 1, 7, 31, 400]) {
    assert.equal(dayDiff(start, shiftDay(start, delta)), delta, `delta ${delta}`);
  }
});

test('weekdayShort liefert deutsche Kuerzel', () => {
  assert.equal(weekdayShort('2026-07-27'), 'Mo');
  assert.equal(weekdayShort('2026-07-26'), 'So');
  assert.equal(weekdayShort('2026-07-25'), 'Sa');
});

test('clockTime zeigt die lokale Uhrzeit zweistellig', () => {
  assert.equal(clockTime(new Date(2026, 6, 28, 9, 5)), '09:05');
  assert.equal(clockTime(new Date(2026, 6, 28, 18, 30)), '18:30');
  assert.equal(clockTime(new Date(2026, 6, 28, 0, 0)), '00:00');
});
