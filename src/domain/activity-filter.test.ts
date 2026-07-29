import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EMPTY_FILTER,
  activeFilterCount,
  filterActivities,
  type FilterableActivity,
} from './activity-filter.ts';

const NOW = new Date('2026-07-27T10:00:00Z'); // Montag

function activity(over: Partial<FilterableActivity> & { id: number }): FilterableActivity {
  return {
    title: 'Kickern im Park',
    description: 'Locker kicken, jeder darf mit.',
    location: 'Musterstrasse 1, 50667 Koeln',
    starts_at: '2026-07-27T18:00:00Z',
    interests: [{ id: 1, name: 'Sport' }],
    participants_count: 3,
    max_participants: null,
    ...over,
  };
}

test('ohne Filter kommt alles unveraendert zurueck', () => {
  const items = [activity({ id: 1 }), activity({ id: 2 })];
  assert.deepEqual(
    filterActivities(items, EMPTY_FILTER, { now: NOW }).map((a) => a.id),
    [1, 2],
  );
});

test('Suche findet Treffer im Titel, egal wie gross geschrieben', () => {
  const items = [activity({ id: 1, title: 'Kickern im Park' }), activity({ id: 2, title: 'Lernen in der Bib' })];
  const res = filterActivities(items, { ...EMPTY_FILTER, query: 'KICKERN' }, { now: NOW });
  assert.deepEqual(res.map((a) => a.id), [1]);
});

test('Suche ist umlaut-tolerant (fussball findet Fussball und Fußball)', () => {
  const items = [activity({ id: 1, title: 'Fußball am Abend' }), activity({ id: 2, title: 'Yoga' })];
  assert.deepEqual(
    filterActivities(items, { ...EMPTY_FILTER, query: 'fussball' }, { now: NOW }).map((a) => a.id),
    [1],
  );
  assert.deepEqual(
    filterActivities(items, { ...EMPTY_FILTER, query: 'FUßBALL' }, { now: NOW }).map((a) => a.id),
    [1],
  );
});

test('Suche greift auch in Beschreibung, Ort und Interessen', () => {
  const items = [
    activity({ id: 1, description: 'Wir brauchen noch einen Torwart' }),
    activity({ id: 2, location: 'Aachener Strasse 5' }),
    activity({ id: 3, interests: [{ id: 9, name: 'Brettspiele' }] }),
    activity({ id: 4 }),
  ];
  const hit = (q: string) => filterActivities(items, { ...EMPTY_FILTER, query: q }, { now: NOW }).map((a) => a.id);
  assert.deepEqual(hit('torwart'), [1]);
  assert.deepEqual(hit('aachener'), [2]);
  assert.deepEqual(hit('brettspiele'), [3]);
});

test('Interessen-Filter: ODER-Verknuepfung ueber die gewaehlten Kategorien', () => {
  const items = [
    activity({ id: 1, interests: [{ id: 1, name: 'Sport' }] }),
    activity({ id: 2, interests: [{ id: 2, name: 'Musik' }] }),
    activity({ id: 3, interests: [{ id: 3, name: 'Kochen' }] }),
  ];
  const res = filterActivities(items, { ...EMPTY_FILTER, interestIds: [1, 3] }, { now: NOW });
  assert.deepEqual(res.map((a) => a.id), [1, 3]);
});

test('Zeitfenster "heute" nimmt nur den heutigen Tag', () => {
  const items = [
    activity({ id: 1, starts_at: '2026-07-27T18:00:00Z' }), // heute
    activity({ id: 2, starts_at: '2026-07-28T18:00:00Z' }), // morgen
  ];
  assert.deepEqual(
    filterActivities(items, { ...EMPTY_FILTER, when: 'today' }, { now: NOW }).map((a) => a.id),
    [1],
  );
});

test('Zeitfenster "morgen" nimmt nur den Folgetag', () => {
  const items = [
    activity({ id: 1, starts_at: '2026-07-27T18:00:00Z' }),
    activity({ id: 2, starts_at: '2026-07-28T09:00:00Z' }),
  ];
  assert.deepEqual(
    filterActivities(items, { ...EMPTY_FILTER, when: 'tomorrow' }, { now: NOW }).map((a) => a.id),
    [2],
  );
});

test('Zeitfenster "week" nimmt die naechsten 7 Tage, aber nichts danach', () => {
  const items = [
    activity({ id: 1, starts_at: '2026-07-29T18:00:00Z' }),
    activity({ id: 2, starts_at: '2026-08-20T18:00:00Z' }),
  ];
  assert.deepEqual(
    filterActivities(items, { ...EMPTY_FILTER, when: 'week' }, { now: NOW }).map((a) => a.id),
    [1],
  );
});

test('Vergangene Events fallen bei jedem Zeitfenster raus, ausser bei "all"', () => {
  const items = [activity({ id: 1, starts_at: '2026-07-20T18:00:00Z' })];
  assert.equal(filterActivities(items, { ...EMPTY_FILTER, when: 'week' }, { now: NOW }).length, 0);
  assert.equal(filterActivities(items, { ...EMPTY_FILTER, when: 'all' }, { now: NOW }).length, 1);
});

test('Events ohne Datum ueberleben nur das Zeitfenster "all"', () => {
  const items = [activity({ id: 1, starts_at: null })];
  assert.equal(filterActivities(items, { ...EMPTY_FILTER, when: 'all' }, { now: NOW }).length, 1);
  assert.equal(filterActivities(items, { ...EMPTY_FILTER, when: 'today' }, { now: NOW }).length, 0);
});

test('Entfernungsfilter nutzt die uebergebenen Distanzen', () => {
  const items = [activity({ id: 1 }), activity({ id: 2 }), activity({ id: 3 })];
  const distanceById = new Map([
    [1, 0.5],
    [2, 12],
  ]);
  const res = filterActivities(items, { ...EMPTY_FILTER, maxDistanceKm: 5 }, { now: NOW, distanceById });
  // id 3 hat keine bekannte Distanz -> bewusst behalten statt faelschlich verstecken.
  assert.deepEqual(res.map((a) => a.id), [1, 3]);
});

test('hideFull blendet volle Events aus, unbegrenzte bleiben', () => {
  const items = [
    activity({ id: 1, participants_count: 4, max_participants: 4 }),
    activity({ id: 2, participants_count: 2, max_participants: 4 }),
    activity({ id: 3, participants_count: 99, max_participants: null }),
  ];
  const res = filterActivities(items, { ...EMPTY_FILTER, hideFull: true }, { now: NOW });
  assert.deepEqual(res.map((a) => a.id), [2, 3]);
});

test('Filter lassen sich kombinieren (UND-Verknuepfung)', () => {
  const items = [
    activity({ id: 1, title: 'Fussball', interests: [{ id: 1, name: 'Sport' }], starts_at: '2026-07-27T18:00:00Z' }),
    activity({ id: 2, title: 'Fussball', interests: [{ id: 2, name: 'Musik' }], starts_at: '2026-07-27T18:00:00Z' }),
    activity({ id: 3, title: 'Yoga', interests: [{ id: 1, name: 'Sport' }], starts_at: '2026-07-27T18:00:00Z' }),
  ];
  const res = filterActivities(items, { ...EMPTY_FILTER, query: 'fussball', interestIds: [1], when: 'today' }, { now: NOW });
  assert.deepEqual(res.map((a) => a.id), [1]);
});

test('activeFilterCount zaehlt, wie viele Filter gesetzt sind (fuer den Zuruecksetzen-Knopf)', () => {
  assert.equal(activeFilterCount(EMPTY_FILTER), 0);
  assert.equal(activeFilterCount({ ...EMPTY_FILTER, query: '  ' }), 0, 'leere Suche zaehlt nicht');
  assert.equal(activeFilterCount({ ...EMPTY_FILTER, query: 'yoga' }), 1);
  assert.equal(activeFilterCount({ ...EMPTY_FILTER, query: 'yoga', interestIds: [1], when: 'today', hideFull: true }), 4);
});

test('Filtern veraendert die Ausgangsliste nicht', () => {
  const items = [activity({ id: 1 }), activity({ id: 2 })];
  const copy = [...items];
  filterActivities(items, { ...EMPTY_FILTER, query: 'kickern' }, { now: NOW });
  assert.deepEqual(items, copy);
});
