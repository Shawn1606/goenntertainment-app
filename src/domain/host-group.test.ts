import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MIN_GROUP, groupByHost } from './host-group.ts';

const KINO = { id: 10, name: 'CinemaxX', username: 'cinemaxx', account_type: 'business' };
const BUFF = { id: 20, name: 'Nörgelbuff', username: 'noergelbuff', account_type: 'business' };
const ANNA = { id: 30, name: 'Anna', username: 'anna', account_type: 'creator' };

function item(id: number, host: typeof KINO | null, starts_at: string | null = '2026-08-01T19:00:00Z') {
  return { id, host, starts_at };
}

test('ein Haus mit vielen Terminen wird eine Karte', () => {
  const entries = groupByHost([
    item(1, KINO, '2026-08-01T17:00:00Z'),
    item(2, KINO, '2026-08-01T20:00:00Z'),
    item(3, KINO, '2026-08-02T17:00:00Z'),
  ]);

  assert.equal(entries.length, 1);
  assert.equal(entries[0].kind, 'host');
  if (entries[0].kind === 'host') {
    assert.equal(entries[0].host.name, 'CinemaxX');
    assert.equal(entries[0].activities.length, 3);
  }
});

test('unter der Schwelle bleibt jedes Event seine eigene Karte', () => {
  const entries = groupByHost([item(1, KINO), item(2, KINO)]);
  assert.equal(entries.length, 2);
  assert.ok(entries.every((entry) => entry.kind === 'single'));
});

test('die Schwelle liegt bei drei', () => {
  assert.equal(MIN_GROUP, 3);
  assert.equal(groupByHost([item(1, KINO), item(2, KINO), item(3, KINO)]).length, 1);
});

test('die Rangfolge des Regals bleibt erhalten', () => {
  // Anna steht zwischen den Kino-Terminen. Die Gruppe muss an der Stelle des
  // ERSTEN Kino-Treffers erscheinen, Anna danach – sonst wäre die Empfehlung
  // umsortiert.
  const entries = groupByHost([
    item(1, KINO),
    item(2, ANNA),
    item(3, KINO),
    item(4, KINO),
  ]);

  assert.deepEqual(
    entries.map((entry) => (entry.kind === 'host' ? entry.host.name : 'Anna-Event')),
    ['CinemaxX', 'Anna-Event'],
  );
});

test('mehrere Häuser werden getrennt gebündelt', () => {
  const entries = groupByHost([
    item(1, KINO),
    item(2, BUFF),
    item(3, KINO),
    item(4, BUFF),
    item(5, KINO),
    item(6, BUFF),
  ]);

  assert.equal(entries.length, 2);
  assert.deepEqual(
    entries.map((entry) => (entry.kind === 'host' ? entry.host.name : '?')),
    ['CinemaxX', 'Nörgelbuff'],
  );
});

test('innerhalb der Gruppe stehen die Termine chronologisch', () => {
  const entries = groupByHost([
    item(1, KINO, '2026-08-03T17:00:00Z'),
    item(2, KINO, '2026-08-01T17:00:00Z'),
    item(3, KINO, '2026-08-02T17:00:00Z'),
  ]);

  assert.equal(entries[0].kind, 'host');
  if (entries[0].kind === 'host') {
    assert.deepEqual(
      entries[0].activities.map((a) => a.id),
      [2, 3, 1],
    );
  }
});

test('Events ohne Veranstalter bleiben einzeln und werfen nicht', () => {
  const entries = groupByHost([item(1, null), item(2, null), item(3, null)]);
  assert.equal(entries.length, 3);
  assert.ok(entries.every((entry) => entry.kind === 'single'));
});

test('gruppiert wird über die ID, nicht über den Namen', () => {
  // Zwei Konten dürfen gleich heißen – sie sind trotzdem zwei Veranstalter.
  const zwilling = { id: 11, name: 'CinemaxX', username: 'cinemaxx-northeim', account_type: 'business' };
  const entries = groupByHost([
    item(1, KINO),
    item(2, KINO),
    item(3, KINO),
    item(4, zwilling),
    item(5, zwilling),
    item(6, zwilling),
  ]);

  assert.equal(entries.length, 2);
  const ids = entries.map((entry) => (entry.kind === 'host' ? entry.host.id : null));
  assert.deepEqual(ids, [10, 11]);
});

test('die Schwelle lässt sich anheben', () => {
  const drei = [item(1, KINO), item(2, KINO), item(3, KINO)];
  assert.equal(groupByHost(drei, { min: 4 }).length, 3, 'bei min 4 bleibt es einzeln');
  assert.equal(groupByHost(drei, { min: 3 }).length, 1);
});

test('leere Eingabe ergibt keine Einträge', () => {
  assert.deepEqual(groupByHost([]), []);
});

test('Schlüssel sind eindeutig – sonst meckert React über doppelte keys', () => {
  const entries = groupByHost([
    item(1, KINO),
    item(2, KINO),
    item(3, KINO),
    item(4, ANNA),
    item(5, BUFF),
  ]);
  const keys = entries.map((entry) => entry.key);
  assert.equal(new Set(keys).size, keys.length);
});
