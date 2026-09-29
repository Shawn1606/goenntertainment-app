import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EMPTY_FILTER,
  activeFilterCount,
  filterActivities,
  isAlwaysOn,
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

// ---------------------------------------------------------------------------
// Tageszeit und die weiteren Zeitfenster.
// ---------------------------------------------------------------------------

test('Tageszeit: abends trifft 17-21 Uhr, nicht den Nachmittag', () => {
  const items = [
    activity({ id: 1, starts_at: '2026-07-27T15:00:00' }),
    activity({ id: 2, starts_at: '2026-07-27T20:00:00' }),
  ];
  assert.deepEqual(
    filterActivities(items, { ...EMPTY_FILTER, daytime: 'evening' }, { now: NOW }).map((a) => a.id),
    [2],
  );
});

test('Tageszeit: nachts laeuft ueber Mitternacht (23 Uhr UND 2 Uhr)', () => {
  // Der Fall, an dem eine naive Von-Bis-Pruefung scheitert: 2 Uhr liegt
  // zahlenmaessig unter dem Startwert 22.
  const items = [
    activity({ id: 1, starts_at: '2026-07-27T23:00:00' }),
    activity({ id: 2, starts_at: '2026-07-28T02:00:00' }),
    activity({ id: 3, starts_at: '2026-07-28T14:00:00' }),
  ];
  assert.deepEqual(
    filterActivities(items, { ...EMPTY_FILTER, daytime: 'night' }, { now: NOW }).map((a) => a.id),
    [1, 2],
  );
});

test('Tageszeit: ohne Startzeit kein Treffer', () => {
  const items = [activity({ id: 1, starts_at: null })];
  assert.equal(filterActivities(items, { ...EMPTY_FILTER, daytime: 'evening' }, { now: NOW }).length, 0);
});

test('Tageszeit laesst sich mit dem Zeitfenster kombinieren', () => {
  const items = [
    activity({ id: 1, starts_at: '2026-07-27T20:00:00' }), // heute abend
    activity({ id: 2, starts_at: '2026-07-27T14:00:00' }), // heute mittag
    activity({ id: 3, starts_at: '2026-07-29T20:00:00' }), // spaeter abend
  ];
  assert.deepEqual(
    filterActivities(items, { ...EMPTY_FILTER, when: 'today', daytime: 'evening' }, { now: NOW }).map(
      (a) => a.id,
    ),
    [1],
  );
});

test('Wochenende: Freitagabend gehoert dazu, Freitagmittag nicht', () => {
  const freitag = new Date('2026-07-31T09:00:00');
  const items = [
    activity({ id: 1, starts_at: '2026-07-31T12:00:00' }),
    activity({ id: 2, starts_at: '2026-07-31T20:00:00' }),
    activity({ id: 3, starts_at: '2026-08-02T15:00:00' }), // Sonntag
    activity({ id: 4, starts_at: '2026-08-03T20:00:00' }), // Montag
  ];
  assert.deepEqual(
    filterActivities(items, { ...EMPTY_FILTER, when: 'weekend' }, { now: freitag }).map((a) => a.id),
    [2, 3],
  );
});

test('Wochenende: am Samstag ist das LAUFENDE gemeint, nicht das naechste', () => {
  const samstag = new Date('2026-08-01T14:00:00');
  const items = [activity({ id: 1, starts_at: '2026-08-01T22:00:00' })];
  assert.deepEqual(
    filterActivities(items, { ...EMPTY_FILTER, when: 'weekend' }, { now: samstag }).map((a) => a.id),
    [1],
  );
});

test('Monat: reicht weiter als eine Woche', () => {
  const items = [activity({ id: 1, starts_at: '2026-08-20T19:00:00Z' })];
  assert.equal(filterActivities(items, { ...EMPTY_FILTER, when: 'week' }, { now: NOW }).length, 0);
  assert.equal(filterActivities(items, { ...EMPTY_FILTER, when: 'month' }, { now: NOW }).length, 1);
});

test('activeFilterCount zaehlt die Tageszeit mit', () => {
  assert.equal(activeFilterCount({ ...EMPTY_FILTER, daytime: 'night' }), 1);
  assert.equal(activeFilterCount({ ...EMPTY_FILTER, when: 'weekend', daytime: 'night' }), 2);
});

// ---------------------------------------------------------------------------
// Dauerangebote (Bowling, Trampolinhalle, Freibad).
// ---------------------------------------------------------------------------

/** Ein Dauerangebot: `starts_at` traegt nur den Anlege-Zeitpunkt, siehe schema.sql. */
function dauerangebot(id: number) {
  return activity({
    id,
    title: 'Freibad',
    starts_at: '2026-07-01T12:00:00Z', // laengst vorbei – und genau das ist der Punkt
    is_permanent: true,
  });
}

test('isAlwaysOn erkennt nur echte Dauerangebote', () => {
  assert.equal(isAlwaysOn(dauerangebot(1)), true);
  assert.equal(isAlwaysOn(activity({ id: 2 })), false);
});

test('ein Dauerangebot ueberlebt JEDES Zeitfenster', () => {
  // Der wichtigste Fall: Sein `starts_at` liegt in der Vergangenheit. Nach Datum
  // beurteilt fiele es ueberall heraus – ein Freibad ist aber „heute" offen.
  const items = [dauerangebot(1)];
  for (const when of ['today', 'tomorrow', 'weekend', 'week', 'month'] as const) {
    assert.equal(
      filterActivities(items, { ...EMPTY_FILTER, when }, { now: NOW }).length,
      1,
      `Zeitfenster "${when}" haette es nicht ausblenden duerfen`,
    );
  }
});

test('ein Dauerangebot ueberlebt JEDE Tageszeit', () => {
  const items = [dauerangebot(1)];
  for (const daytime of ['morning', 'afternoon', 'evening', 'night'] as const) {
    assert.equal(
      filterActivities(items, { ...EMPTY_FILTER, daytime }, { now: NOW }).length,
      1,
      `Tageszeit "${daytime}" haette es nicht ausblenden duerfen`,
    );
  }
});

test('ein normales Event mit demselben Datum faellt dagegen heraus', () => {
  // Beweist, dass oben das Kennzeichen wirkt und nicht ein weiches Datum.
  const items = [activity({ id: 1, starts_at: '2026-07-01T12:00:00Z' })];
  assert.equal(filterActivities(items, { ...EMPTY_FILTER, when: 'today' }, { now: NOW }).length, 0);
});

test('Dauerangebote unterliegen weiter Suche, Kategorie und Plaetzen', () => {
  // „Immer offen" heisst nur „immer zeitlich passend", nicht „immer sichtbar".
  const items = [dauerangebot(1)];
  assert.equal(filterActivities(items, { ...EMPTY_FILTER, query: 'freibad' }, { now: NOW }).length, 1);
  assert.equal(filterActivities(items, { ...EMPTY_FILTER, query: 'oper' }, { now: NOW }).length, 0);
  assert.equal(
    filterActivities(items, { ...EMPTY_FILTER, interestIds: [999] }, { now: NOW }).length,
    0,
    'eine fremde Kategorie blendet es weiterhin aus',
  );
});
