import assert from 'node:assert/strict';
import { test } from 'node:test';

import { REST_TITLE, groupByInterest } from './interest-group.ts';

const MUSIK = { id: 5, name: 'Musik' };
const KUNST = { id: 9, name: 'Kunst & Design' };
const SOZIAL = { id: 2, name: 'Soziales & Community' };

function item(
  id: number,
  interests: { id: number; name: string }[],
  starts_at: string | null = '2026-08-01T19:00:00Z',
) {
  return { id, interests, starts_at };
}

test('Abschnitte tragen den Namen ihres Interesses', () => {
  const sections = groupByInterest([item(1, [MUSIK]), item(2, [KUNST])]);
  assert.deepEqual(
    sections.map((s) => s.title).sort(),
    ['Kunst & Design', 'Musik'],
  );
});

test('jede Aktivität steht in genau einem Abschnitt – die Summe stimmt', () => {
  // Der eigentliche Zweck: Ein Event mit drei Kategorien darf nicht dreimal
  // auftauchen, sonst summieren sich die Zahlen auf mehr als die Trefferzahl.
  const items = [
    item(1, [MUSIK, KUNST, SOZIAL]),
    item(2, [KUNST, MUSIK]),
    item(3, [SOZIAL]),
  ];
  const sections = groupByInterest(items);
  const summe = sections.reduce((n, s) => n + s.activities.length, 0);
  assert.equal(summe, items.length);

  const ids = sections.flatMap((s) => s.activities.map((a) => a.id)).sort();
  assert.deepEqual(ids, [1, 2, 3], 'keine Dubletten, nichts verloren');
});

test('mehrere Interessen landen im Restposten, nicht beim ersten', () => {
  // Ein Event mit zwei Kategorien gehört in keines der beiden Regale allein –
  // sonst sucht es im anderen Regal jemand vergeblich.
  const sections = groupByInterest([item(1, [KUNST, MUSIK])]);
  assert.equal(sections.length, 1);
  assert.equal(sections[0].title, REST_TITLE);
  assert.equal(sections[0].interestId, null);
});

test('ein Kategorie-Abschnitt trägt nur Events mit GENAU dieser Kategorie', () => {
  const sections = groupByInterest([item(1, [MUSIK]), item(2, [MUSIK, KUNST])]);
  const musik = sections.find((s) => s.title === 'Musik');
  assert.deepEqual(musik?.activities.map((a) => a.id), [1]);
  const rest = sections.find((s) => s.title === REST_TITLE);
  assert.deepEqual(rest?.activities.map((a) => a.id), [2]);
});

test('eine häufige Kombination bekommt einen eigenen Abschnitt', () => {
  // Sechs Termine „Konzerte + Musik" sind kein Zufall, sondern eine Kategorie
  // ohne eigenen Namen – der Restposten bleibt leer.
  const sections = groupByInterest(
    Array.from({ length: 6 }, (_, index) => item(index + 1, [KUNST, MUSIK])),
  );
  assert.equal(sections.length, 1);
  assert.equal(sections[0].title, 'Kunst & Design + Musik');
  assert.equal(sections[0].activities.length, 6);
  // Das Zeichen der ersten Kategorie – besser als keins.
  assert.equal(sections[0].interestId, KUNST.id);
});

test('die Reihenfolge der Interessen ist für die Kombination gleichgültig', () => {
  const sections = groupByInterest([
    item(1, [KUNST, MUSIK]),
    item(2, [MUSIK, KUNST]),
    item(3, [KUNST, MUSIK]),
    item(4, [MUSIK, KUNST]),
    item(5, [KUNST, MUSIK]),
    item(6, [MUSIK, KUNST]),
  ]);
  assert.equal(sections.length, 1, 'eine Kombination, ein Abschnitt');
  assert.equal(sections[0].title, 'Kunst & Design + Musik');
});

test('eine seltene Kombination bleibt im Restposten', () => {
  // Fünf ist die Grenze: „mehr als fünf" bekommt einen Abschnitt, fünf nicht.
  const sections = groupByInterest(
    Array.from({ length: 5 }, (_, index) => item(index + 1, [KUNST, MUSIK])),
  );
  assert.equal(sections.length, 1);
  assert.equal(sections[0].title, REST_TITLE);
  assert.equal(sections[0].interestId, null);
});

test('verschiedene Kombinationen zählen getrennt', () => {
  // Je drei – zusammen sechs, aber keine der beiden verdient einen Abschnitt.
  const sections = groupByInterest([
    ...Array.from({ length: 3 }, (_, index) => item(index + 1, [KUNST, MUSIK])),
    ...Array.from({ length: 3 }, (_, index) => item(index + 4, [KUNST, SOZIAL])),
  ]);
  assert.deepEqual(sections.map((s) => s.title), [REST_TITLE]);
  assert.equal(sections[0].activities.length, 6);
});

test('ein Kombinations-Abschnitt steht vor dem Restposten', () => {
  const sections = groupByInterest([
    ...Array.from({ length: 6 }, (_, index) => item(index + 1, [KUNST, MUSIK])),
    item(7, []),
    item(8, [MUSIK, SOZIAL]),
  ]);
  assert.deepEqual(
    sections.map((s) => `${s.title}:${s.activities.length}`),
    ['Kunst & Design + Musik:6', `${REST_TITLE}:2`],
  );
});

test('eine doppelt vergebene Kategorie ist keine Kombination', () => {
  const sections = groupByInterest(
    Array.from({ length: 6 }, (_, index) => item(index + 1, [MUSIK, MUSIK])),
  );
  assert.deepEqual(sections.map((s) => s.title), ['Musik']);
  assert.equal(sections[0].interestId, MUSIK.id);
});

test('der vollste Abschnitt steht vorn', () => {
  const sections = groupByInterest([
    item(1, [KUNST]),
    item(2, [MUSIK]),
    item(3, [MUSIK]),
    item(4, [MUSIK]),
  ]);
  assert.deepEqual(
    sections.map((s) => `${s.title}:${s.activities.length}`),
    ['Musik:3', 'Kunst & Design:1'],
  );
});

test('bei gleicher Größe entscheidet der Name – die Reihenfolge springt nicht', () => {
  const a = groupByInterest([item(1, [MUSIK]), item(2, [KUNST])]);
  const b = groupByInterest([item(2, [KUNST]), item(1, [MUSIK])]);
  assert.deepEqual(a.map((s) => s.title), b.map((s) => s.title));
});

test('Events ohne Kategorie landen im Restposten „Weitere" am Ende', () => {
  const sections = groupByInterest([
    item(1, []),
    item(2, []),
    item(3, []),
    item(4, [MUSIK]),
  ]);
  // Der Restposten hat DREI Einträge und Musik nur einen – trotzdem steht er hinten.
  assert.equal(sections[sections.length - 1].title, REST_TITLE);
  assert.equal(sections[sections.length - 1].interestId, null);
  assert.equal(sections[0].title, 'Musik');
});

test('innerhalb eines Abschnitts steht der nächste Termin zuerst', () => {
  const sections = groupByInterest([
    item(3, [MUSIK], '2026-08-20T19:00:00Z'),
    item(1, [MUSIK], '2026-08-01T19:00:00Z'),
    item(2, [MUSIK], '2026-08-10T19:00:00Z'),
  ]);
  assert.deepEqual(sections[0].activities.map((a) => a.id), [1, 2, 3]);
});

test('sortWithin: false lässt eine vorhandene Ordnung stehen', () => {
  // Wichtig fuer „nach Nähe sortiert": Das Unterteilen darf die Sortierung nicht
  // ueberschreiben.
  const sections = groupByInterest(
    [
      item(3, [MUSIK], '2026-08-20T19:00:00Z'),
      item(1, [MUSIK], '2026-08-01T19:00:00Z'),
    ],
    { sortWithin: false },
  );
  assert.deepEqual(sections[0].activities.map((a) => a.id), [3, 1]);
});

test('Termine ohne Datum landen hinten, nicht vorn', () => {
  const sections = groupByInterest([item(1, [MUSIK], null), item(2, [MUSIK], '2026-08-01T19:00:00Z')]);
  assert.deepEqual(sections[0].activities.map((a) => a.id), [2, 1]);
});

test('leere Eingabe ergibt keine Abschnitte', () => {
  assert.deepEqual(groupByInterest([]), []);
});

test('Schlüssel sind eindeutig', () => {
  const sections = groupByInterest([item(1, [MUSIK]), item(2, [KUNST]), item(3, [])]);
  const keys = sections.map((s) => s.key);
  assert.equal(new Set(keys).size, keys.length);
});

test('ein fehlendes interests-Feld wirft nicht', () => {
  // Kommt bei Teil-Antworten vor; der Restposten „Weitere" ist die richtige
  // Antwort darauf, kein Absturz.
  const sections = groupByInterest([{ id: 1, interests: undefined as never, starts_at: null }]);
  assert.equal(sections[0].title, REST_TITLE);
});
