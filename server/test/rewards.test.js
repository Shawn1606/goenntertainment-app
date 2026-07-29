/**
 * Haelt den Praemien-Katalog des Servers gegen den der App.
 *
 * Beide Seiten fuehren denselben Katalog (siehe die Notiz in src/rewards.js):
 * Die App braucht Preise und Texte auch ohne Netz, der Server entscheidet als
 * Einziger, ob das Guthaben reicht. Laufen die beiden auseinander, zeigt die App
 * einen Preis an, den der Server nicht nimmt – dieser Test ist die Bremse dagegen.
 *
 * Bewusst OHNE Datenbank: Getestet wird der Katalog und die Zuordnung, nicht das
 * Buchen. Fuers Buchen braucht es MySQL, und ein Test, der nur auf einem
 * eingerichteten Rechner laeuft, wird als Erster uebersprungen.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

import { COUPONS, POINTS_PER_ACTIVITY, couponFor } from '../src/rewards.js';

/**
 * Der Katalog der App – aus der Quelle gelesen, damit kein TS-Import noetig ist.
 *
 * Der Pfad kommt aus dem Ort DIESER Datei und nicht aus `process.cwd()`: Sonst
 * haengt der Test daran, aus welchem Ordner man ihn startet.
 */
function appCatalog() {
  const file = path.join(import.meta.dirname, '..', '..', 'src', 'domain', 'rewards.ts');
  const source = fs.readFileSync(file, 'utf8');
  const slugs = [...source.matchAll(/slug: '([^']+)'/g)].map((m) => m[1]);
  const costs = [...source.matchAll(/cost: (\d+)/g)].map((m) => Number(m[1]));
  const perActivity = Number(/POINTS_PER_ACTIVITY = (\d+)/.exec(source)?.[1]);
  return { slugs, costs, perActivity };
}

test('eine erstellte Aktivitaet ist 10 Punkte wert', () => {
  assert.equal(POINTS_PER_ACTIVITY, 10);
});

test('Katalog: Schluessel und Preise stimmen mit der App ueberein', () => {
  const app = appCatalog();
  assert.deepEqual(
    COUPONS.map((coupon) => coupon.slug),
    app.slugs,
  );
  assert.deepEqual(
    COUPONS.map((coupon) => coupon.cost),
    app.costs,
  );
  assert.equal(POINTS_PER_ACTIVITY, app.perActivity);
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
