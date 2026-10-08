import test from 'node:test';
import assert from 'node:assert/strict';

import { expiryInfo, nextExpiring } from './booking-status.ts';

const now = new Date(2026, 9, 5, 22, 30); // 05.10.2026, 22:30 Ortszeit

test('Ablauf in Kalendertagen, nicht in 24-Stunden-Blöcken', () => {
  assert.deepEqual(expiryInfo('2026-10-05T23:59:00', now), { days: 0, tone: 'urgent', label: 'Verfällt heute' });
  assert.deepEqual(expiryInfo('2026-10-06T08:00:00', now), { days: 1, tone: 'urgent', label: 'Verfällt morgen' });
  assert.equal(expiryInfo('2026-10-10T12:00:00', now)?.label, 'Verfällt in 5 Tagen');
});

test('Stufen: dringend bis 7 Tage, bald bis 30, sonst ok', () => {
  assert.equal(expiryInfo('2026-10-12T12:00:00', now)?.tone, 'urgent');
  assert.equal(expiryInfo('2026-10-13T12:00:00', now)?.tone, 'soon');
  assert.equal(expiryInfo('2026-10-13T12:00:00', now)?.label, 'Noch 8 Tage gültig');
  assert.equal(expiryInfo('2026-12-24T12:00:00', now)?.tone, 'ok');
  assert.equal(expiryInfo('2026-10-01T12:00:00', now)?.tone, 'over');
});

test('fehlendes oder kaputtes Datum ergibt null', () => {
  assert.equal(expiryInfo(null, now), null);
  assert.equal(expiryInfo('kein Datum', now), null);
});

test('nextExpiring nimmt nur offene, noch gültige Buchungen', () => {
  const list = [
    { id: 1, status: 'confirmed', valid_until: '2026-11-01T12:00:00', offer_title: 'Kart' },
    { id: 2, status: 'redeemed', valid_until: '2026-10-06T12:00:00', offer_title: 'Bowling' },
    { id: 3, status: 'confirmed', valid_until: '2026-10-09T12:00:00', offer_title: 'Escape' },
    { id: 4, status: 'confirmed', valid_until: '2026-10-01T12:00:00', offer_title: 'Alt' },
  ];
  assert.equal(nextExpiring(list, now)?.booking.id, 3);
  assert.equal(nextExpiring([], now), null);
});
