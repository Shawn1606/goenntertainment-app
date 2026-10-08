import test from 'node:test';
import assert from 'node:assert/strict';

import { clusterPlaces, partnerPlaces } from './partner-places.ts';

const partner = (id: number, lat: number | null = 51.5) => ({
  id,
  name: `P${id}`,
  lat,
  lng: lat === null ? null : 9.9,
  logo_url: null,
  address: null,
  city: 'Göttingen',
  interest_id: null,
});

test('ein Ort je Partner, günstigster Preis vorn', () => {
  const places = partnerPlaces([
    { id: 1, price_cents: 2999, price_credits: null, interest_id: null, partner: partner(1) },
    { id: 2, price_cents: 1500, price_credits: null, interest_id: null, partner: partner(1) },
    { id: 3, price_cents: null, price_credits: 80, interest_id: null, partner: partner(2) },
  ]);
  assert.equal(places.length, 2);
  assert.equal(places[0].offers.length, 2);
  assert.equal(places[0].fromCents, 1500);
  assert.equal(places[1].fromCents, null);
});

test('Partner ohne Koordinaten fehlen auf der Karte', () => {
  const places = partnerPlaces([{ id: 1, price_cents: 100, price_credits: null, interest_id: null, partner: partner(1, null) }]);
  assert.equal(places.length, 0);
});

test('nahe Partner werden zu einem Punkt, weit entfernte nicht', () => {
  const places = [
    { partnerId: 1, lat: 51.54, lng: 9.915 },
    { partnerId: 2, lat: 51.5401, lng: 9.9152 },
    { partnerId: 3, lat: 51.56, lng: 9.95 },
  ];
  // Weiter Ausschnitt: 1 und 2 liegen auf dem Bildschirm übereinander.
  const wide = clusterPlaces(places, { latitudeDelta: 0.12, longitudeDelta: 0.12 }, 375);
  assert.equal(wide.length, 2);
  assert.deepEqual(wide.find((c) => c.places.length === 2)?.key, '1-2');
  // Ganz nah herangezoomt: alle einzeln.
  const close = clusterPlaces(places, { latitudeDelta: 0.001, longitudeDelta: 0.001 }, 375);
  assert.equal(close.length, 3);
});

test('der Punkt liegt in der Mitte seiner Gruppe; leere Liste bleibt leer', () => {
  const c = clusterPlaces([{ partnerId: 1, lat: 10, lng: 20 }, { partnerId: 2, lat: 10.0002, lng: 20.0002 }], { latitudeDelta: 1, longitudeDelta: 1 }, 400);
  assert.equal(c.length, 1);
  assert.ok(Math.abs(c[0].lat - 10.0001) < 1e-9 && Math.abs(c[0].lng - 20.0001) < 1e-9);
  assert.deepEqual(clusterPlaces([], { latitudeDelta: 1, longitudeDelta: 1 }, 400), []);
});
