import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ClubRules } from './club.ts';
import { DEFAULT_CRITERIA, formatAgeRange, matchOffer, normalizeAges, rankOffers, type MatchableOffer } from './offer-match.ts';

const RULES = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', '..', 'shared', 'club.json'), 'utf8'),
) as ClubRules;

function offer(overrides: Partial<MatchableOffer> & { id: number }): MatchableOffer {
  return {
    kind: 'activity',
    price_cents: 2000,
    price_credits: null,
    min_people: 1,
    max_people: null,
    min_age: null,
    max_age: null,
    interest_id: null,
    indoor: null,
    max_discount_percent: null,
    ...overrides,
  };
}

const ctx = { plan: 'free', distanceKm: null };

test('Personenzahl außerhalb der Spanne fliegt raus', () => {
  const o = offer({ id: 1, min_people: 2, max_people: 6 });
  assert.equal(matchOffer(RULES, o, { ...DEFAULT_CRITERIA, people: 1 }, ctx), null);
  assert.equal(matchOffer(RULES, o, { ...DEFAULT_CRITERIA, people: 7 }, ctx), null);
  assert.ok(matchOffer(RULES, o, { ...DEFAULT_CRITERIA, people: 6 }, ctx));
});

test('zu jung ist hart, zu alt nur ein Hinweis', () => {
  const o = offer({ id: 1, min_age: 6, max_age: 12 });
  assert.equal(matchOffer(RULES, o, { ...DEFAULT_CRITERIA, youngest: 4, oldest: 10 }, ctx), null);
  const older = matchOffer(RULES, o, { ...DEFAULT_CRITERIA, youngest: 8, oldest: 40 }, ctx);
  assert.ok(older);
  assert.equal(older.caveats.length, 1);
  const fits = matchOffer(RULES, o, { ...DEFAULT_CRITERIA, youngest: 8, oldest: 11 }, ctx);
  assert.ok(fits);
  assert.ok(fits.reasons.some((r) => r.includes('passt für alle')));
  assert.ok(fits.score > older.score);
});

test('Prämien (Freigetränk) gehören nicht in den Gruppen-Finder', () => {
  assert.equal(matchOffer(RULES, offer({ id: 1, kind: 'perk' }), DEFAULT_CRITERIA, ctx), null);
});

test('Budget: knapp drüber bleibt, weit drüber fliegt raus', () => {
  const criteria = { ...DEFAULT_CRITERIA, people: 1, budgetPerPersonCents: 1900 };
  const near = matchOffer(RULES, offer({ id: 1, price_cents: 2000 }), criteria, ctx);
  assert.ok(near);
  assert.ok(near.caveats[0].startsWith('Knapp über dem Budget'));
  assert.equal(matchOffer(RULES, offer({ id: 2, price_cents: 3000 }), criteria, ctx), null);
});

test('Preis pro Person enthält den Gruppenrabatt', () => {
  const m = matchOffer(RULES, offer({ id: 1, price_cents: 2000 }), { ...DEFAULT_CRITERIA, people: 4 }, { plan: 'gold', distanceKm: null });
  assert.ok(m);
  // Gold, 4 Personen: 5 % Club + 5 % Gruppe = 10 %
  assert.equal(m.percent, 10);
  assert.equal(m.totalCents, 7200);
  assert.equal(m.perPersonCents, 1800);
});

test('Barrierefreie Filter: nur ausdrücklich angegebene Partner', () => {
  const access = { wheelchair: true, quiet: false, kids: false };
  const yes = offer({ id: 1, partner: { wheelchair_accessible: true } });
  const no = offer({ id: 2, partner: { wheelchair_accessible: false } });
  const unknown = offer({ id: 3, partner: null });
  assert.ok(matchOffer(RULES, yes, { ...DEFAULT_CRITERIA, access }, ctx));
  assert.equal(matchOffer(RULES, no, { ...DEFAULT_CRITERIA, access }, ctx), null);
  assert.equal(matchOffer(RULES, unknown, { ...DEFAULT_CRITERIA, access }, ctx), null);
  // Ohne Filter bleibt alles drin.
  assert.ok(matchOffer(RULES, unknown, DEFAULT_CRITERIA, ctx));

  const quiet = { wheelchair: false, quiet: true, kids: true };
  assert.ok(matchOffer(RULES, offer({ id: 4, partner: { kid_friendly: true, quiet_times: 'Di vormittags' } }), { ...DEFAULT_CRITERIA, access: quiet }, ctx));
  assert.equal(matchOffer(RULES, offer({ id: 5, partner: { kid_friendly: true, quiet_times: ' ' } }), { ...DEFAULT_CRITERIA, access: quiet }, ctx), null);
});

test('Kategorie und drinnen/draußen filtern', () => {
  const indoor = offer({ id: 1, indoor: true, interest_id: 3 });
  assert.equal(matchOffer(RULES, indoor, { ...DEFAULT_CRITERIA, setting: 'outdoor' }, ctx), null);
  assert.equal(matchOffer(RULES, indoor, { ...DEFAULT_CRITERIA, interestIds: [4] }, ctx), null);
  assert.ok(matchOffer(RULES, indoor, { ...DEFAULT_CRITERIA, setting: 'indoor', interestIds: [3] }, ctx));
});

test('Rangliste: näher und passender zuerst', () => {
  const far = offer({ id: 1 });
  const near = offer({ id: 2 });
  const ranked = rankOffers(RULES, [far, near], DEFAULT_CRITERIA, {
    plan: 'free',
    distanceById: new Map([
      [1, 25],
      [2, 1],
    ]),
  });
  assert.deepEqual(
    ranked.map((m) => m.offer.id),
    [2, 1],
  );
});

test('Entfernung über dem Maximum fliegt raus', () => {
  const ranked = rankOffers(RULES, [offer({ id: 1 })], { ...DEFAULT_CRITERIA, maxDistanceKm: 10 }, {
    plan: 'free',
    distanceById: new Map([[1, 30]]),
  });
  assert.equal(ranked.length, 0);
});

test('Alter: vertauschte Eingaben werden getauscht', () => {
  assert.deepEqual(normalizeAges(40, 8), { youngest: 8, oldest: 40 });
  assert.deepEqual(normalizeAges(-2, 140), { youngest: 0, oldest: 99 });
  assert.deepEqual(normalizeAges(null, 12), { youngest: null, oldest: 12 });
});

test('Alter: Chip-Text zeigt nur, was eingestellt ist', () => {
  assert.equal(formatAgeRange(18, 30), '18–30 J.');
  assert.equal(formatAgeRange(25, 25), '25 J.');
  assert.equal(formatAgeRange(18, null), 'ab 18 J.');
  assert.equal(formatAgeRange(null, 30), 'bis 30 J.');
  assert.equal(formatAgeRange(0, null), 'ab 0 J.');
  assert.equal(formatAgeRange(null, null), null);
});
