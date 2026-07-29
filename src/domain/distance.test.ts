import test from 'node:test';
import assert from 'node:assert/strict';

import { distanceKm, formatDistance } from './distance.ts';

const KOELN_DOM = { latitude: 50.9413, longitude: 6.9583 };
const KOELN_HBF = { latitude: 50.9430, longitude: 6.9587 };
const DUESSELDORF = { latitude: 51.2277, longitude: 6.7735 };

test('distanceKm: gleicher Punkt = 0', () => {
  assert.equal(distanceKm(KOELN_DOM, KOELN_DOM), 0);
});

test('distanceKm: Dom -> Hauptbahnhof sind ein paar hundert Meter', () => {
  const km = distanceKm(KOELN_DOM, KOELN_HBF);
  assert.ok(km > 0.1 && km < 0.4, `erwartet 0,1-0,4 km, war ${km}`);
});

test('distanceKm: Koeln -> Duesseldorf sind rund 35 km', () => {
  const km = distanceKm(KOELN_DOM, DUESSELDORF);
  assert.ok(km > 33 && km < 40, `erwartet ~35 km, war ${km}`);
});

test('distanceKm: Richtung spielt keine Rolle', () => {
  assert.equal(
    Math.round(distanceKm(KOELN_DOM, DUESSELDORF) * 1000),
    Math.round(distanceKm(DUESSELDORF, KOELN_DOM) * 1000),
  );
});

test('formatDistance: unter 1 km in Metern, auf 50 m gerundet', () => {
  assert.equal(formatDistance(0.32), '300 m');
  assert.equal(formatDistance(0.06), '50 m');
});

test('formatDistance: unter 10 km mit einer Nachkommastelle (deutsches Komma)', () => {
  assert.equal(formatDistance(1.24), '1,2 km');
});

test('formatDistance: ab 10 km ohne Nachkommastelle', () => {
  assert.equal(formatDistance(34.7), '35 km');
});

test('formatDistance: unbekannte Entfernung ergibt null', () => {
  assert.equal(formatDistance(null), null);
  assert.equal(formatDistance(Number.NaN), null);
});
