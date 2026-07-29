import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  COUPONS,
  POINTS_PER_ACTIVITY,
  activitiesUntil,
  canAfford,
  couponFor,
  couponProgress,
  missingFor,
  nextGoal,
  pointsForActivities,
} from './rewards.ts';
import { UI_ICON_NAMES } from './ui-icon.ts';

test('eine erstellte Aktivität ist 10 Punkte wert', () => {
  // Die Zahl steht so in der Anforderung – und in server/src/rewards.js.
  assert.equal(POINTS_PER_ACTIVITY, 10);
  assert.equal(pointsForActivities(0), 0);
  assert.equal(pointsForActivities(1), 10);
  assert.equal(pointsForActivities(7), 70);
});

test('pointsForActivities: Unsinn wird zu 0, nicht zu NaN', () => {
  assert.equal(pointsForActivities(-3), 0);
  assert.equal(pointsForActivities(2.7), 20);
  assert.equal(pointsForActivities(Number.NaN), 0);
  assert.equal(pointsForActivities(Number.POSITIVE_INFINITY), 0);
});

test('der Katalog ist aufsteigend nach Preis sortiert', () => {
  // Die Liste wird genau so angezeigt: „gleich dran" oben, „Ziel" unten.
  const costs = COUPONS.map((coupon) => coupon.cost);
  assert.deepEqual(costs, [...costs].sort((a, b) => a - b));
});

test('jeder Coupon hat einen eindeutigen Schlüssel und einen Preis über 0', () => {
  const slugs = COUPONS.map((coupon) => coupon.slug);
  assert.equal(new Set(slugs).size, slugs.length);
  for (const coupon of COUPONS) {
    assert.ok(coupon.cost > 0, `${coupon.slug} hat keinen Preis`);
  }
});

test('jeder Coupon benennt ein Symbol, das das Set kennt', () => {
  const names: readonly string[] = UI_ICON_NAMES;
  for (const coupon of COUPONS) {
    assert.ok(names.includes(coupon.icon), `${coupon.slug} → ${coupon.icon} fehlt im Namensraum`);
  }
});

test('couponFor findet nur echte Schlüssel', () => {
  assert.equal(couponFor('kaffee')?.cost, 50);
  assert.equal(couponFor('gibtsnicht'), null);
});

test('canAfford: genau der Preis reicht', () => {
  const coupon = { slug: 'x', title: 'X', description: '', cost: 100, icon: 'ticket' } as const;
  assert.equal(canAfford(coupon, 99), false);
  assert.equal(canAfford(coupon, 100), true);
  assert.equal(canAfford(coupon, 101), true);
});

test('couponProgress bleibt zwischen 0 und 1', () => {
  const coupon = { slug: 'x', title: 'X', description: '', cost: 100, icon: 'ticket' } as const;
  assert.equal(couponProgress(coupon, 0), 0);
  assert.equal(couponProgress(coupon, 50), 0.5);
  assert.equal(couponProgress(coupon, 250), 1);
  assert.equal(couponProgress(coupon, -20), 0);
});

test('missingFor zählt nie ins Negative', () => {
  const coupon = { slug: 'x', title: 'X', description: '', cost: 100, icon: 'ticket' } as const;
  assert.equal(missingFor(coupon, 40), 60);
  assert.equal(missingFor(coupon, 100), 0);
  assert.equal(missingFor(coupon, 400), 0);
});

test('activitiesUntil rundet auf – halbe Events gibt es nicht', () => {
  const coupon = { slug: 'x', title: 'X', description: '', cost: 55, icon: 'ticket' } as const;
  assert.equal(activitiesUntil(coupon, 0), 6);
  assert.equal(activitiesUntil(coupon, 50), 1);
  assert.equal(activitiesUntil(coupon, 55), 0);
});

test('nextGoal zeigt den günstigsten, den man noch NICHT hat', () => {
  // Das ist der Kern: Mit 70 Punkten sind Kaffee (50) und Eis (60) längst drin –
  // die Startseite darf dann nicht weiter auf den Kaffee zeigen.
  assert.equal(nextGoal(0)?.slug, 'kaffee');
  assert.equal(nextGoal(50)?.slug, 'eiskugel');
  assert.equal(nextGoal(70)?.slug, 'kino-2fuer1');
});

test('nextGoal: wer alles erreichen kann, hat kein Ziel mehr', () => {
  const highest = Math.max(...COUPONS.map((coupon) => coupon.cost));
  assert.equal(nextGoal(highest), null);
});
