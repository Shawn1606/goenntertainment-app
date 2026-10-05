import test from 'node:test';
import assert from 'node:assert/strict';

import { partnerPlaces } from './partner-places.ts';

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
