import test from 'node:test';
import assert from 'node:assert/strict';

import { homeSections } from './home-sections.ts';

const offer = (id: number, extra: Partial<Parameters<typeof homeSections>[0][number]> = {}) => ({
  id,
  kind: 'activity' as const,
  interest_id: null,
  price_credits: null,
  is_featured: false,
  partner: { id: id * 10, interest_id: null },
  ...extra,
});

test('hervorgehobene zuerst, sonst Reihenfolge des Servers', () => {
  const s = homeSections([offer(1), offer(2, { is_featured: true }), offer(3)], { category: null, distanceById: new Map() });
  assert.deepEqual(s.featured.map((o) => o.id), [2, 1, 3]);
});

test('Kategorie filtert alle Leisten, auch über den Partner', () => {
  const offers = [offer(1, { interest_id: 5 }), offer(2, { partner: { id: 9, interest_id: 5 } }), offer(3, { interest_id: 6 })];
  const s = homeSections(offers, { category: 5, distanceById: new Map() });
  assert.deepEqual(s.featured.map((o) => o.id), [1, 2]);
  assert.deepEqual([...s.categoryIds].sort(), [5, 6]);
});

test('Nähe nach Entfernung, nur mit bekanntem Standort', () => {
  const s = homeSections([offer(1), offer(2), offer(3)], { category: null, distanceById: new Map([[1, 9], [3, 2]]) });
  assert.deepEqual(s.nearby.map((o) => o.id), [3, 1]);
});

test('mit Credits: Vorteile zuerst, dann günstig', () => {
  const s = homeSections(
    [offer(1, { price_credits: 300 }), offer(2, { price_credits: 80, kind: 'perk' }), offer(3, { price_credits: 100 }), offer(4)],
    { category: null, distanceById: new Map() },
  );
  assert.deepEqual(s.withCredits.map((o) => o.id), [2, 3, 1]);
});

test('Prämien stehen nicht unter Top-Angebote, Partner nur einmal', () => {
  const s = homeSections([offer(1, { kind: 'perk' }), offer(2, { partner: { id: 10, interest_id: null } })], { category: null, distanceById: new Map() });
  assert.deepEqual(s.featured.map((o) => o.id), [2]);
  assert.equal(s.partners.length, 1);
});
