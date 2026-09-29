import assert from 'node:assert/strict';
import test from 'node:test';

import { unreadBadge } from './unread-badge.ts';

test('die Plakette zeigt die Zahl – und ab 100 nur noch „99+"', () => {
  assert.equal(unreadBadge(1), '1');
  assert.equal(unreadBadge(99), '99');
  assert.equal(unreadBadge(100), '99+');
  assert.equal(unreadBadge(4000), '99+');
});

test('bei null gibt es gar keine Plakette', () => {
  // Ein Kreis mit einer Null darin ist die verwirrendste Form von „nichts Neues".
  assert.equal(unreadBadge(0), null);
});

test('unsinnige Zahlen ergeben keine Plakette', () => {
  assert.equal(unreadBadge(-3), null);
  assert.equal(unreadBadge(Number.NaN), null);
});

test('Nachkommastellen werden abgeschnitten, nicht gerundet', () => {
  // Der Wert kommt als Summe aus dem Server – eine „2,7" wäre eine Zahl, die
  // niemand als Anzahl ungelesener Nachrichten lesen kann.
  assert.equal(unreadBadge(2.7), '2');
});
