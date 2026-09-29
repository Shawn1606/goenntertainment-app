import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatEventWhen } from './event-when.ts';

// Mittwoch, 30. September 2026, 12:00 Ortszeit.
const NOW = new Date(2026, 8, 30, 12, 0);

const at = (y: number, m: number, d: number, h: number, min = 0) =>
  new Date(y, m, d, h, min).toISOString();

test('heute und morgen stehen als Wort da', () => {
  assert.equal(formatEventWhen(at(2026, 8, 30, 18), NOW), 'Heute, 18:00');
  assert.equal(formatEventWhen(at(2026, 9, 1, 9, 5), NOW), 'Morgen, 09:05');
});

test('Mitternacht zählt nach Kalendertag, nicht nach 24 Stunden', () => {
  const lateEvening = new Date(2026, 8, 30, 23, 50);
  assert.equal(formatEventWhen(at(2026, 9, 1, 0, 10), lateEvening), 'Morgen, 00:10');
});

test('innerhalb der Woche reicht der Wochentag', () => {
  // Samstag, 3. Oktober
  assert.equal(formatEventWhen(at(2026, 9, 3, 20), NOW), 'Sa., 20:00');
});

test('später mit Datum, in einem anderen Jahr mit Jahreszahl', () => {
  assert.equal(formatEventWhen(at(2026, 9, 12, 18), NOW), 'Mo., 12.10., 18:00');
  assert.equal(formatEventWhen(at(2027, 0, 2, 18), NOW), 'Sa., 02.01.2027, 18:00');
});

test('gestern bleibt lesbar, falls ein laufendes Event noch in der Liste steht', () => {
  assert.equal(formatEventWhen(at(2026, 8, 29, 20), NOW), 'Gestern, 20:00');
});

test('Dauerangebote haben keine Uhrzeit', () => {
  assert.equal(formatEventWhen(at(2026, 8, 30, 18), NOW, { permanent: true }), 'Jederzeit');
});

test('ohne oder mit kaputtem Datum kein Text statt „Invalid Date"', () => {
  assert.equal(formatEventWhen(null, NOW), '');
  assert.equal(formatEventWhen('kein datum', NOW), '');
});
