import test from 'node:test';
import assert from 'node:assert/strict';

import { XP_WEIGHTS, emptyStats, xpFromStats, xpSqlExpression } from '../src/gamification.js';

test('leere Kennzahlen ergeben 0 XP', () => {
  assert.equal(xpFromStats(emptyStats()), 0);
});

test('Erstellen zaehlt mehr als Beitreten', () => {
  assert.ok(xpFromStats({ hosted: 1, joined: 0, distinctInterests: 0 }) > xpFromStats({ hosted: 0, joined: 1, distinctInterests: 0 }));
});

test('XP entsprechen exakt den Gewichten', () => {
  const xp = xpFromStats({ hosted: 2, joined: 3, distinctInterests: 4 });
  assert.equal(xp, 2 * XP_WEIGHTS.perHosted + 3 * XP_WEIGHTS.perJoined + 4 * XP_WEIGHTS.perDistinctInterest);
});

test('fehlende oder unsinnige Werte werden als 0 behandelt', () => {
  assert.equal(xpFromStats({}), 0);
  assert.equal(xpFromStats({ hosted: -3, joined: null, distinctInterests: undefined }), 0);
  assert.equal(xpFromStats({ hosted: '2', joined: '1', distinctInterests: '0' }), 2 * XP_WEIGHTS.perHosted + XP_WEIGHTS.perJoined);
});

test('die SQL-Formel benutzt dieselben Gewichte wie die JS-Formel', () => {
  const sql = xpSqlExpression({ hosted: 'h', joined: 'j', distinctInterests: 'd' });
  assert.match(sql, new RegExp(`h\\s*\\*\\s*${XP_WEIGHTS.perHosted}`));
  assert.match(sql, new RegExp(`j\\s*\\*\\s*${XP_WEIGHTS.perJoined}`));
  assert.match(sql, new RegExp(`d\\s*\\*\\s*${XP_WEIGHTS.perDistinctInterest}`));
});

test('die SQL-Formel liefert fuer dieselben Zahlen dasselbe Ergebnis wie die JS-Formel', () => {
  // Formel als JS auswerten, damit Server-Sortierung und Anzeige nicht auseinanderlaufen.
  const sql = xpSqlExpression({ hosted: 'hosted', joined: 'joined', distinctInterests: 'variety' });
  const evaluate = new Function('hosted', 'joined', 'variety', `return ${sql};`);
  for (const row of [
    { hosted: 0, joined: 0, variety: 0 },
    { hosted: 1, joined: 0, variety: 0 },
    { hosted: 3, joined: 7, variety: 5 },
  ]) {
    assert.equal(
      evaluate(row.hosted, row.joined, row.variety),
      xpFromStats({ hosted: row.hosted, joined: row.joined, distinctInterests: row.variety }),
    );
  }
});
