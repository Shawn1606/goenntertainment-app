import assert from 'node:assert/strict';
import { test } from 'node:test';

import { UNDATED_TITLE, groupByMonth, listSections } from './list-sections.ts';

const KONZERTE = { id: 81, name: 'Konzerte' };
const TANZEN = { id: 83, name: 'Tanzen' };

function item(id: number, starts_at: string | null, interests = [KONZERTE]) {
  return { id, interests, starts_at };
}

test('groupByMonth: Abschnitt je Monat, mit Jahr in der Überschrift', () => {
  // Mit Jahr, weil der Feed bis 2028 reicht – „Juli" zweimal waere falsch.
  const sections = groupByMonth([
    item(1, '2026-08-05T19:00:00'),
    item(2, '2026-09-02T19:00:00'),
  ]);
  assert.deepEqual(
    sections.map((s) => s.title),
    ['August 2026', 'September 2026'],
  );
});

test('groupByMonth: derselbe Monat in verschiedenen Jahren bleibt getrennt', () => {
  const sections = groupByMonth([
    item(1, '2028-07-24T19:00:00'),
    item(2, '2026-07-31T19:00:00'),
  ]);
  assert.deepEqual(
    sections.map((s) => s.title),
    ['Juli 2026', 'Juli 2028'],
  );
});

test('groupByMonth: Monate stehen chronologisch, nicht alphabetisch', () => {
  // „August" vor „Dezember" waere alphabetisch richtig und zeitlich falsch.
  const sections = groupByMonth([
    item(1, '2026-12-07T19:00:00'),
    item(2, '2026-08-05T19:00:00'),
    item(3, '2027-01-09T19:00:00'),
  ]);
  assert.deepEqual(
    sections.map((s) => s.title),
    ['August 2026', 'Dezember 2026', 'Januar 2027'],
  );
});

test('groupByMonth: innerhalb eines Monats steht der nächste Termin zuerst', () => {
  const sections = groupByMonth([
    item(3, '2026-08-20T19:00:00'),
    item(1, '2026-08-01T19:00:00'),
    item(2, '2026-08-10T19:00:00'),
  ]);
  assert.deepEqual(sections[0].activities.map((a) => a.id), [1, 2, 3]);
});

test('groupByMonth: Termine ohne Datum bekommen einen eigenen Abschnitt am Ende', () => {
  const sections = groupByMonth([
    item(1, null),
    item(2, null),
    item(3, null),
    item(4, '2026-08-05T19:00:00'),
  ]);
  // Drei ohne Datum, einer mit – trotzdem steht der Restposten hinten.
  assert.equal(sections[sections.length - 1].title, UNDATED_TITLE);
  assert.equal(sections[0].title, 'August 2026');
});

test('groupByMonth: ein unlesbares Datum gilt als ohne Datum, nicht als 1970', () => {
  const sections = groupByMonth([item(1, 'demnächst')]);
  assert.equal(sections[0].title, UNDATED_TITLE);
});

test('groupByMonth: die Summe der Abschnitte ist die Länge der Liste', () => {
  const items = Array.from({ length: 40 }, (_, i) =>
    item(i + 1, `2026-${String((i % 12) + 1).padStart(2, '0')}-05T19:00:00`),
  );
  const summe = groupByMonth(items).reduce((n, s) => n + s.activities.length, 0);
  assert.equal(summe, items.length);
});

test('groupByMonth: leere Eingabe ergibt keine Abschnitte', () => {
  assert.deepEqual(groupByMonth([]), []);
});

test('listSections: mehrere Kategorien → nach Kategorie', () => {
  // Der Fall „Karten-Pin": alles an einem Ort, aber verschiedene Abende.
  const result = listSections([
    item(1, '2026-08-05T19:00:00', [KONZERTE]),
    item(2, '2026-08-06T19:00:00', [TANZEN]),
  ]);
  assert.equal(result.axis, 'interest');
  assert.deepEqual(result.sections.map((s) => s.title).sort(), ['Konzerte', 'Tanzen']);
});

test('listSections: eine Kategorie → nach Monat', () => {
  // Der Fall „Kategorie-Regal": 79 Konzerte. Nach Kategorie zu unterteilen waere
  // ein Abschnitt mit allem drin, also keine Unterteilung.
  const result = listSections([
    item(1, '2026-08-05T19:00:00', [KONZERTE]),
    item(2, '2026-09-06T19:00:00', [KONZERTE]),
  ]);
  assert.equal(result.axis, 'month');
  assert.deepEqual(result.sections.map((s) => s.title), ['August 2026', 'September 2026']);
});

test('listSections: alles im selben Monat UND einer Kategorie ergibt einen Abschnitt', () => {
  const result = listSections([
    item(1, '2026-08-05T19:00:00', [KONZERTE]),
    item(2, '2026-08-06T19:00:00', [KONZERTE]),
  ]);
  assert.equal(result.axis, 'month');
  assert.equal(result.sections.length, 1);
});

test('listSections: es geht nichts verloren, egal welche Achse', () => {
  const gemischt = [
    item(1, '2026-08-05T19:00:00', [KONZERTE]),
    item(2, '2026-09-06T19:00:00', [TANZEN]),
    item(3, null, [KONZERTE]),
  ];
  const einzeln = [
    item(1, '2026-08-05T19:00:00', [KONZERTE]),
    item(2, '2026-09-06T19:00:00', [KONZERTE]),
  ];
  for (const liste of [gemischt, einzeln]) {
    const { sections } = listSections(liste);
    const ids = sections.flatMap((s) => s.activities.map((a) => a.id)).sort();
    assert.deepEqual(ids, liste.map((a) => a.id).sort());
  }
});

test('listSections: leere Eingabe ergibt keine Abschnitte', () => {
  const result = listSections([]);
  assert.deepEqual(result.sections, []);
});

test('listSections: Schlüssel sind eindeutig', () => {
  const { sections } = listSections([
    item(1, '2026-08-05T19:00:00'),
    item(2, '2026-09-05T19:00:00'),
    item(3, null),
  ]);
  const keys = sections.map((s) => s.key);
  assert.equal(new Set(keys).size, keys.length);
});
