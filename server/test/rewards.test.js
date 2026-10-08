/**
 * Der Praemien-Katalog des Servers.
 *
 * Frueher hielt dieser Test ihn auch gegen den Katalog der App (src/domain/rewards.ts). Den gibt
 * es mit dem Marktplatz-Umbau nicht mehr - die App zeigt keine Praemien mehr -, also bleiben die
 * Regeln des Servers selbst: Preise, Schluessel, Zuordnung.
 *
 * Bewusst OHNE Datenbank: Getestet wird der Katalog und die Zuordnung, nicht das
 * Buchen. Fuers Buchen braucht es MySQL, und ein Test, der nur auf einem
 * eingerichteten Rechner laeuft, wird als Erster uebersprungen.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { COUPONS, POINTS_PER_ACTIVITY, couponFor } from '../src/rewards.js';

test('eine erstellte Aktivitaet ist 10 Punkte wert', () => {
  assert.equal(POINTS_PER_ACTIVITY, 10);
});

test('Katalog: aufsteigend nach Preis, eindeutige Schluessel, Preis ueber 0', () => {
  const costs = COUPONS.map((coupon) => coupon.cost);
  assert.deepEqual(costs, [...costs].sort((a, b) => a - b));

  const slugs = COUPONS.map((coupon) => coupon.slug);
  assert.equal(new Set(slugs).size, slugs.length);

  for (const coupon of COUPONS) {
    assert.ok(coupon.cost > 0, `${coupon.slug} hat keinen Preis`);
    assert.ok(coupon.title.length > 0, `${coupon.slug} hat keinen Titel`);
  }
});

test('couponFor findet nur echte Schluessel', () => {
  assert.equal(couponFor('kaffee')?.cost, 50);
  assert.equal(couponFor('gibtsnicht'), null);
});
