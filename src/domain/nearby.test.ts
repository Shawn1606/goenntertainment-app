import test from 'node:test';
import assert from 'node:assert/strict';

import { RADIUS_STEPS_KM, chooseRadius } from './nearby.ts';

test('gibt es Treffer im Grundumkreis, bleibt es beim Grundumkreis', () => {
  const result = chooseRadius(new Map([[1, 5], [2, 12]]));
  assert.equal(result.radiusKm, RADIUS_STEPS_KM[0]);
  assert.equal(result.expanded, false);
  assert.deepEqual([...result.ids].sort(), [1, 2]);
});

test('ohne Treffer wird der Umkreis verdoppelt, bis etwas gefunden wird', () => {
  const result = chooseRadius(new Map([[1, 45]]));
  assert.equal(result.radiusKm, RADIUS_STEPS_KM[1]);
  assert.equal(result.expanded, true);
  assert.deepEqual([...result.ids], [1]);
});

test('mehrere Verdopplungen sind moeglich', () => {
  const result = chooseRadius(new Map([[1, 200]]));
  assert.ok(result.radiusKm >= 240);
  assert.equal(result.expanded, true);
  assert.deepEqual([...result.ids], [1]);
});

test('ist wirklich nichts in Reichweite, bleibt die Trefferliste leer', () => {
  const result = chooseRadius(new Map([[1, 9000]]));
  assert.equal(result.ids.size, 0);
  assert.equal(result.radiusKm, RADIUS_STEPS_KM[RADIUS_STEPS_KM.length - 1]);
});

test('ohne bekannte Entfernungen gibt es keine Treffer und keine Erweiterung', () => {
  const result = chooseRadius(new Map());
  assert.equal(result.ids.size, 0);
  assert.equal(result.expanded, false);
  assert.equal(result.radiusKm, RADIUS_STEPS_KM[0]);
});

test('die Grenze zaehlt als Treffer (<=, nicht <)', () => {
  const result = chooseRadius(new Map([[1, RADIUS_STEPS_KM[0]]]));
  assert.deepEqual([...result.ids], [1]);
  assert.equal(result.expanded, false);
});
