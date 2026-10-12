import test from 'node:test';
import assert from 'node:assert/strict';

import { keepIfSame, sameData } from './same-data.ts';

test('gleiche Daten in neuen Objekten zählen als gleich', () => {
  const a = [{ id: 1, name: 'Bowling', partner: { id: 7, lat: 51.5 } }];
  const b = [{ id: 1, name: 'Bowling', partner: { id: 7, lat: 51.5 } }];
  assert.notEqual(a, b);
  assert.ok(sameData(a, b));
});

test('eine geänderte Zahl tief drin zählt als anders', () => {
  assert.ok(!sameData([{ id: 1, unread: 0 }], [{ id: 1, unread: 1 }]));
  assert.ok(!sameData({ credits: 10 }, { credits: 12 }));
  assert.ok(!sameData([], [{ id: 1 }]));
});

test('null, leere Felder und dasselbe Objekt', () => {
  assert.ok(sameData(null, null));
  assert.ok(!sameData(null, { credits: 0 }));
  assert.ok(sameData([], []));
  const same = { id: 3 };
  assert.ok(sameData(same, same));
});

test('keepIfSame behält das alte Objekt nur bei gleichen Daten', () => {
  const prev = [{ id: 1 }];
  assert.equal(keepIfSame(prev, [{ id: 1 }]), prev);
  const next = [{ id: 2 }];
  assert.equal(keepIfSame(prev, next), next);
});

test('nicht in JSON wandelbare Werte gelten als verschieden statt zu werfen', () => {
  const loop: Record<string, unknown> = {};
  loop.self = loop;
  assert.equal(sameData(loop, { self: {} }), false);
});
