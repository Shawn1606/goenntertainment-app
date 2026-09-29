import test from 'node:test';
import assert from 'node:assert/strict';

import {
  explainMatch,
  isBoosted,
  rankActivities,
  scoreActivity,
  type RecommendableActivity,
} from './recommendations.ts';

const NOW = new Date('2026-07-27T10:00:00Z');

function activity(over: Partial<RecommendableActivity> & { id: number }): RecommendableActivity {
  return {
    title: 'Event',
    starts_at: '2026-07-28T18:00:00Z',
    interests: [{ id: 1, name: 'Sport' }],
    participants_count: 2,
    max_participants: null,
    ...over,
  };
}

const profile = { interestIds: [1, 2], attendedInterestIds: [3] };

test('Treffer bei den eigenen Interessen schlaegt alles ohne Treffer', () => {
  const match = scoreActivity(activity({ id: 1, interests: [{ id: 1, name: 'Sport' }] }), profile, { now: NOW });
  const miss = scoreActivity(activity({ id: 2, interests: [{ id: 9, name: 'Angeln' }] }), profile, { now: NOW });
  assert.ok(match > miss, `Treffer (${match}) muss ueber Nicht-Treffer (${miss}) liegen`);
});

test('mehrere passende Interessen zaehlen mehr als eines', () => {
  const one = scoreActivity(activity({ id: 1, interests: [{ id: 1, name: 'Sport' }] }), profile, { now: NOW });
  const two = scoreActivity(
    activity({ id: 2, interests: [{ id: 1, name: 'Sport' }, { id: 2, name: 'Musik' }] }),
    profile,
    { now: NOW },
  );
  assert.ok(two > one);
});

test('Kategorien aus dem eigenen Verlauf zaehlen mit, aber schwaecher als gewaehlte Interessen', () => {
  const chosen = scoreActivity(activity({ id: 1, interests: [{ id: 1, name: 'Sport' }] }), profile, { now: NOW });
  const fromHistory = scoreActivity(activity({ id: 2, interests: [{ id: 3, name: 'Kochen' }] }), profile, { now: NOW });
  const unrelated = scoreActivity(activity({ id: 3, interests: [{ id: 9, name: 'Angeln' }] }), profile, { now: NOW });
  assert.ok(fromHistory > unrelated, 'Verlauf muss besser sein als gar nichts');
  assert.ok(chosen > fromHistory, 'gewaehltes Interesse muss staerker wiegen als der Verlauf');
});

test('naeher dran ist besser', () => {
  const near = scoreActivity(activity({ id: 1 }), profile, { now: NOW, distanceKm: 1 });
  const far = scoreActivity(activity({ id: 2 }), profile, { now: NOW, distanceKm: 40 });
  assert.ok(near > far);
});

test('bald ist besser als in vier Wochen', () => {
  const soon = scoreActivity(activity({ id: 1, starts_at: '2026-07-27T20:00:00Z' }), profile, { now: NOW });
  const later = scoreActivity(activity({ id: 2, starts_at: '2026-08-27T20:00:00Z' }), profile, { now: NOW });
  assert.ok(soon > later);
});

test('vergangene Events bekommen die Wertung 0', () => {
  const past = scoreActivity(activity({ id: 1, starts_at: '2026-07-01T20:00:00Z' }), profile, { now: NOW });
  assert.equal(past, 0);
});

test('volle Events werden abgewertet', () => {
  const open = scoreActivity(activity({ id: 1, participants_count: 2, max_participants: 10 }), profile, { now: NOW });
  const full = scoreActivity(activity({ id: 2, participants_count: 10, max_participants: 10 }), profile, { now: NOW });
  assert.ok(open > full);
});

test('rankActivities sortiert absteigend und laesst die Ausgangsliste in Ruhe', () => {
  const items = [
    activity({ id: 1, interests: [{ id: 9, name: 'Angeln' }] }),
    activity({ id: 2, interests: [{ id: 1, name: 'Sport' }] }),
  ];
  const copy = [...items];
  const ranked = rankActivities(items, profile, { now: NOW });
  assert.deepEqual(ranked.map((a) => a.id), [2, 1]);
  assert.deepEqual(items, copy);
});

test('rankActivities wirft vergangene Events raus', () => {
  const items = [activity({ id: 1, starts_at: '2026-07-01T20:00:00Z' }), activity({ id: 2 })];
  assert.deepEqual(rankActivities(items, profile, { now: NOW }).map((a) => a.id), [2]);
});

test('rankActivities ist stabil bei gleicher Wertung (Reihenfolge bleibt)', () => {
  const items = [activity({ id: 7 }), activity({ id: 3 }), activity({ id: 5 })];
  assert.deepEqual(rankActivities(items, profile, { now: NOW }).map((a) => a.id), [7, 3, 5]);
});

test('explainMatch nennt das passende Interesse', () => {
  const text = explainMatch(activity({ id: 1, interests: [{ id: 2, name: 'Musik' }] }), profile);
  assert.match(text ?? '', /Musik/);
});

test('explainMatch liefert null, wenn nichts passt', () => {
  assert.equal(explainMatch(activity({ id: 1, interests: [{ id: 9, name: 'Angeln' }] }), profile), null);
});

test('ein hervorgehobenes Event kommt vor dem gleichwertigen ohne Hervorhebung', () => {
  const plain = activity({ id: 1 });
  const boosted = activity({ id: 2, boosted_until: '2026-08-01T10:00:00Z' });
  assert.ok(scoreActivity(boosted, profile, { now: NOW }) > scoreActivity(plain, profile, { now: NOW }));
  assert.deepEqual(rankActivities([plain, boosted], profile, { now: NOW }).map((a) => a.id), [2, 1]);
});

test('eine abgelaufene Hervorhebung bringt nichts mehr', () => {
  const expired = activity({ id: 1, boosted_until: '2026-07-20T10:00:00Z' });
  assert.equal(isBoosted(expired, NOW), false);
  assert.equal(
    scoreActivity(expired, profile, { now: NOW }),
    scoreActivity(activity({ id: 2 }), profile, { now: NOW }),
  );
});

test('Hervorheben schlaegt keinen Interessen-Treffer', () => {
  // Reichweite kaufen heisst "weiter vorne", nicht "vor allem anderen".
  const boostedMiss = activity({
    id: 1,
    interests: [{ id: 9, name: 'Angeln' }],
    boosted_until: '2026-08-01T10:00:00Z',
  });
  const plainMatch = activity({ id: 2, interests: [{ id: 1, name: 'Sport' }] });
  assert.ok(scoreActivity(plainMatch, profile, { now: NOW }) > scoreActivity(boostedMiss, profile, { now: NOW }));
});

test('Hervorheben holt kein vergangenes Event zurueck', () => {
  const past = activity({ id: 1, starts_at: '2026-07-01T20:00:00Z', boosted_until: '2026-08-01T10:00:00Z' });
  assert.equal(scoreActivity(past, profile, { now: NOW }), 0);
  assert.deepEqual(rankActivities([past], profile, { now: NOW }), []);
});

test('isBoosted kommt mit fehlenden und unsinnigen Werten klar', () => {
  assert.equal(isBoosted({}, NOW), false);
  assert.equal(isBoosted({ boosted_until: null }, NOW), false);
  assert.equal(isBoosted({ boosted_until: 'irgendwas' }, NOW), false);
});
