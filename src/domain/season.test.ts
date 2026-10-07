import test from 'node:test';
import assert from 'node:assert/strict';

import { easterSunday, seasonByKey, seasonFor } from './season.ts';

/** Ortsdatum mittags – so kippt keine Zeitzone den Tag. */
const on = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12);

test('Ostersonntag stimmt für bekannte Jahre', () => {
  assert.deepEqual(easterSunday(2024), { month: 3, day: 31 });
  assert.deepEqual(easterSunday(2025), { month: 4, day: 20 });
  assert.deepEqual(easterSunday(2026), { month: 4, day: 5 });
  assert.deepEqual(easterSunday(2027), { month: 3, day: 28 });
});

test('der ganze Oktober ist Halloween – mit Kürbissen', () => {
  assert.equal(seasonFor(on(2026, 10, 1)).key, 'halloween');
  assert.equal(seasonFor(on(2026, 10, 5)).key, 'halloween');
  assert.equal(seasonFor(on(2026, 11, 2)).key, 'halloween');
  assert.ok(seasonFor(on(2026, 10, 31)).ornaments.includes('pumpkin'));
  assert.equal(seasonFor(on(2026, 11, 3)).key, 'autumn');
});

test('Advent mit Christbaumkugeln, danach Silvester, dann Winter', () => {
  assert.equal(seasonFor(on(2026, 12, 1)).key, 'advent');
  assert.ok(seasonFor(on(2026, 12, 24)).ornaments.includes('bauble'));
  assert.equal(seasonFor(on(2026, 12, 27)).key, 'newyear');
  assert.equal(seasonFor(on(2027, 1, 1)).key, 'newyear');
  assert.equal(seasonFor(on(2027, 1, 7)).key, 'winter');
  assert.equal(seasonFor(on(2027, 2, 20)).key, 'winter');
});

test('Valentinstag und Ostern schlagen die Jahreszeit', () => {
  assert.equal(seasonFor(on(2027, 2, 14)).key, 'valentine');
  assert.equal(seasonFor(on(2027, 3, 15)).key, 'easter');
  assert.equal(seasonFor(on(2027, 3, 29)).key, 'easter');
  assert.equal(seasonFor(on(2027, 3, 30)).key, 'spring');
  assert.equal(seasonFor(on(2026, 4, 5)).key, 'easter');
});

test('Frühling, Sommer, Herbst', () => {
  assert.equal(seasonFor(on(2027, 5, 10)).key, 'spring');
  assert.equal(seasonFor(on(2027, 7, 10)).key, 'summer');
  assert.equal(seasonFor(on(2027, 9, 15)).key, 'autumn');
});

test('jede Saison hat viele, verschiedene Anhänger – nie zweimal dasselbe nebeneinander', () => {
  const days = [on(2026, 10, 5), on(2026, 12, 10), on(2026, 12, 31), on(2027, 1, 20), on(2027, 2, 10), on(2027, 3, 20), on(2027, 5, 10), on(2027, 7, 10), on(2027, 9, 10)];
  const keys = new Set<string>();
  for (const day of days) {
    const s = seasonFor(day);
    keys.add(s.key);
    assert.ok(s.ornaments.length >= 5, s.key);
    assert.ok(new Set(s.ornaments).size >= 3, `${s.key}: zu wenig verschiedene`);
    assert.ok(s.colors.length > 0 && s.beads.length > 0, s.key);
    for (let i = 1; i < s.ornaments.length; i++) assert.notEqual(s.ornaments[i], s.ornaments[i - 1], `${s.key} bei ${i}`);
    // Auch über den Rand der Liste hinweg (die Girlande wiederholt sie).
    assert.notEqual(s.ornaments[0], s.ornaments.at(-1), `${s.key} Rand`);
  }
  assert.equal(keys.size, 9);
});

test('Halloween hat Kürbis, Gespenst, Fledermaus und Spinne; der Advent Kugel, Zuckerstange und Lebkuchen', () => {
  const h = seasonFor(on(2026, 10, 20)).ornaments;
  for (const k of ['pumpkin', 'ghost', 'bat', 'spider']) assert.ok(h.includes(k as never), k);
  const a = seasonFor(on(2026, 12, 10)).ornaments;
  for (const k of ['bauble', 'candy-cane', 'gingerbread']) assert.ok(a.includes(k as never), k);
});

test('seasonByKey liefert genau die Saison, unabhängig vom Datum', () => {
  assert.equal(seasonByKey('advent').key, 'advent');
  assert.ok(seasonByKey('summer').ornaments.includes('sun'));
});
