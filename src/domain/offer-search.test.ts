import test from 'node:test';
import assert from 'node:assert/strict';

import { matchesQuery, normalizeSearch, sortMatches } from './offer-search.ts';

test('Umlaute, ß und Groß/klein sind egal', () => {
  assert.equal(normalizeSearch('  Große  MÜHLE '), 'grosse muehle');
  assert.ok(matchesQuery(['Kletterhalle Mühle'], 'muehle'));
  assert.ok(matchesQuery(['Kletterhalle Mühle'], 'MÜHLE'));
  assert.ok(matchesQuery(['Straße der Abenteuer'], 'strasse'));
});

test('jedes Wort muss irgendwo vorkommen – auch verteilt auf mehrere Felder', () => {
  assert.ok(matchesQuery(['Escape Room', 'Rätselhaus Göttingen'], 'escape göttingen'));
  assert.ok(!matchesQuery(['Escape Room', 'Rätselhaus'], 'escape bowling'));
});

test('leere Suche passt immer, fehlende Felder stören nicht', () => {
  assert.ok(matchesQuery([null, undefined], ''));
  assert.ok(matchesQuery(['Bowling', null], 'bowl'));
});

test('sortieren nach Preis und Entfernung, ohne die Eingabe zu verändern', () => {
  const list = [
    { perPersonCents: 2000, offer: { id: 1 } },
    { perPersonCents: null, offer: { id: 2 } },
    { perPersonCents: 900, offer: { id: 3 } },
  ];
  assert.deepEqual(sortMatches(list, 'price').map((m) => m.offer.id), [3, 1, 2]);
  const distances = new Map([[1, 0.5], [3, 12]]);
  assert.deepEqual(sortMatches(list, 'distance', distances).map((m) => m.offer.id), [1, 3, 2]);
  assert.deepEqual(sortMatches(list, 'best').map((m) => m.offer.id), [1, 2, 3]);
  assert.equal(list[0].offer.id, 1);
});
