import assert from 'node:assert/strict';
import { test } from 'node:test';

import { groupByPlace } from './place-group.ts';

const BUFF = { lat: 51.5319201, lng: 9.9336904 };

/** Kurzschreibweise für einen Test-Eintrag. */
function item(
  id: number,
  starts_at: string | null,
  coords: { lat: number; lng: number },
  location = 'Nörgelbuff, Gronerstraße 23, Göttingen',
) {
  return { id, starts_at, coords, location };
}

test('143 Termine im selben Haus ergeben einen Pin', () => {
  const items = Array.from({ length: 143 }, (_, i) =>
    item(i + 1, `2026-08-${String((i % 28) + 1).padStart(2, '0')}T19:00:00Z`, BUFF),
  );

  const groups = groupByPlace(items);
  assert.equal(groups.length, 1, 'genau ein Pin');
  assert.equal(groups[0].activities.length, 143, 'alle Termine hängen daran');
});

test('zwei Schreibweisen desselben Hauses fallen zusammen', () => {
  // Der Namens-Treffer und der Adress-Treffer liegen wenige Meter auseinander.
  const groups = groupByPlace([
    item(1, '2026-08-01T19:00:00Z', { lat: 51.5319201, lng: 9.9336904 }, 'Nörgelbuff Göttingen'),
    item(2, '2026-08-02T19:00:00Z', { lat: 51.5318459, lng: 9.9337454 }, 'Gronerstraße 23, Göttingen'),
  ]);

  assert.equal(groups.length, 1, 'sonst lägen zwei Pins übereinander – das Problem zurück');
});

test('zwei echte Orte bleiben zwei Pins', () => {
  const groups = groupByPlace([
    item(1, '2026-08-01T19:00:00Z', BUFF, 'Nörgelbuff'),
    item(2, '2026-08-02T19:00:00Z', { lat: 51.5413, lng: 9.9158 }, 'musa, Hagenweg 2a'),
  ]);
  assert.equal(groups.length, 2);
});

test('innerhalb eines Pins steht der nächste Termin zuerst', () => {
  const groups = groupByPlace([
    item(3, '2026-08-20T19:00:00Z', BUFF),
    item(1, '2026-08-01T19:00:00Z', BUFF),
    item(2, '2026-08-10T19:00:00Z', BUFF),
  ]);
  assert.deepEqual(
    groups[0].activities.map((a) => a.id),
    [1, 2, 3],
  );
});

test('Pins stehen chronologisch – der nächste Abend zuerst', () => {
  const spaeter = { lat: 51.5413, lng: 9.9158 };
  const groups = groupByPlace([
    item(1, '2026-09-01T19:00:00Z', spaeter, 'musa'),
    item(2, '2026-08-01T19:00:00Z', BUFF, 'Nörgelbuff'),
  ]);
  assert.deepEqual(
    groups.map((g) => g.location),
    ['Nörgelbuff', 'musa'],
  );
});

test('am Pin steht die häufigste Schreibweise', () => {
  const groups = groupByPlace([
    item(1, '2026-08-01T19:00:00Z', BUFF, 'Nörgelbuff, Gronerstraße 23, Göttingen'),
    item(2, '2026-08-02T19:00:00Z', BUFF, 'Nörgelbuff, Gronerstraße 23, Göttingen'),
    item(3, '2026-08-03T19:00:00Z', BUFF, 'Buff'),
  ]);
  assert.equal(groups[0].location, 'Nörgelbuff, Gronerstraße 23, Göttingen');
});

test('Termine ohne Datum landen hinten, nicht vorn', () => {
  const groups = groupByPlace([
    item(1, null, BUFF),
    item(2, '2026-08-01T19:00:00Z', BUFF),
  ]);
  assert.deepEqual(
    groups[0].activities.map((a) => a.id),
    [2, 1],
  );
});

test('kaputte Koordinaten ergeben keinen Pin bei 0/0', () => {
  const groups = groupByPlace([
    item(1, '2026-08-01T19:00:00Z', { lat: Number.NaN, lng: 9.9 }),
    item(2, '2026-08-02T19:00:00Z', BUFF),
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(
    groups[0].activities.map((a) => a.id),
    [2],
  );
});

test('30 m sind derselbe Ort, 120 m sind zwei', () => {
  // 1° Breite ≈ 111.320 m. Der Test hält die Schwelle fest, nachdem das
  // Gruppieren über eine gerundete Koordinate genau hier falsch lag.
  const nah = { lat: BUFF.lat + 30 / 111_320, lng: BUFF.lng };
  const fern = { lat: BUFF.lat + 120 / 111_320, lng: BUFF.lng };

  assert.equal(
    groupByPlace([item(1, '2026-08-01T19:00:00Z', BUFF), item(2, '2026-08-02T19:00:00Z', nah)]).length,
    1,
  );
  assert.equal(
    groupByPlace([item(1, '2026-08-01T19:00:00Z', BUFF), item(2, '2026-08-02T19:00:00Z', fern)]).length,
    2,
  );
});

test('nahe Nachbarn ziehen keine Kette auf', () => {
  // Drei Punkte je 40 m auseinander: 1+2 gehören zusammen, 3 ist vom Anker 80 m
  // weg und damit ein eigener Ort. Ein mitwandernder Mittelwert würde alle drei
  // verschmelzen – und so ließe sich eine ganze Straße zu einem Pin verketten.
  const groups = groupByPlace([
    item(1, '2026-08-01T19:00:00Z', BUFF),
    item(2, '2026-08-02T19:00:00Z', { lat: BUFF.lat + 40 / 111_320, lng: BUFF.lng }),
    item(3, '2026-08-03T19:00:00Z', { lat: BUFF.lat + 80 / 111_320, lng: BUFF.lng }),
  ]);
  assert.equal(groups.length, 2);
});

test('leere Eingabe ergibt keine Gruppen', () => {
  assert.deepEqual(groupByPlace([]), []);
});

test('der Schlüssel ist stabil über zwei Läufe', () => {
  const items = [item(1, '2026-08-01T19:00:00Z', BUFF)];
  assert.equal(groupByPlace(items)[0].key, groupByPlace(items)[0].key);
});
