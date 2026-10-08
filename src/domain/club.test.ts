import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  discountFor,
  formatCredits,
  formatEuro,
  creditValidityFor,
  creditValidityLabel,
  firstPurchaseBonus,
  formatPercent,
  groupPercentFor,
  isGoldenCard,
  periodPriceCents,
  yearlySavingsCents,
  happyHourPercent,
  applyHappyHour,
  packBonus,
  packPriceCents,
  packTotalCredits,
  planFor,
  quoteCredits,
  quoteMoney,
  stampProgress,
  stampRewardFor,
  type ClubRules,
} from './club.ts';

/** Regeln und Fälle aus shared/ – dieselben, die Laravel prüft (api/tests/Unit/ClubTest.php). */
const SHARED = join(import.meta.dirname, '..', '..', 'shared');
const RULES = JSON.parse(readFileSync(join(SHARED, 'club.json'), 'utf8')) as ClubRules;
const FIXTURES = JSON.parse(readFileSync(join(SHARED, 'club.fixtures.json'), 'utf8')) as {
  quotes: {
    name: string;
    plan: string;
    people: number;
    unitPriceCents: number;
    maxDiscountPercent?: number;
    expect: { percent: number; subtotalCents: number; discountCents: number; totalCents: number };
  }[];
  creditQuotes: {
    name: string;
    plan: string;
    people: number;
    unitCredits: number;
    expect: { percent: number; subtotalCredits: number; totalCredits: number };
  }[];
  packPrices: { credits: number; priceCents: number; bonus: number; totalCredits: number; firstPurchaseBonus: number }[];
  stampRewards: { plan: string; card: number; expect: number }[];
  stampProgress: { total: number; expect: { filled: number; completedCards: number } }[];
  groupPercents: { plan: string; people: number; expect: number }[];
};

test('Euro-Preise: die gemeinsamen Fälle', () => {
  assert.ok(FIXTURES.quotes.length >= 8);
  for (const c of FIXTURES.quotes) {
    const q = quoteMoney(RULES, c);
    assert.equal(q.percent, c.expect.percent, `${c.name}: Prozent`);
    assert.equal(q.subtotalCents, c.expect.subtotalCents, `${c.name}: Zwischensumme`);
    assert.equal(q.discountCents, c.expect.discountCents, `${c.name}: Rabatt`);
    assert.equal(q.totalCents, c.expect.totalCents, `${c.name}: Summe`);
  }
});

test('Credit-Preise: die gemeinsamen Fälle', () => {
  for (const c of FIXTURES.creditQuotes) {
    const q = quoteCredits(RULES, c);
    assert.equal(q.percent, c.expect.percent, `${c.name}: Prozent`);
    assert.equal(q.subtotalCredits, c.expect.subtotalCredits, `${c.name}: Zwischensumme`);
    assert.equal(q.totalCredits, c.expect.totalCredits, `${c.name}: Summe`);
  }
});

test('Paketpreise: 10 Credits = 75 Cent', () => {
  assert.deepEqual(RULES.credits.packs, FIXTURES.packPrices.map((p) => p.credits));
  for (const p of FIXTURES.packPrices) {
    assert.equal(packPriceCents(RULES, p.credits), p.priceCents);
    assert.equal(packBonus(RULES, p.credits), p.bonus);
    assert.equal(packTotalCredits(RULES, p.credits), p.totalCredits);
    assert.equal(firstPurchaseBonus(RULES, p.credits), p.firstPurchaseBonus);
  }
});

test('Stempelkarte: Belohnung je Stufe, jede 5. Karte golden', () => {
  for (const c of FIXTURES.stampRewards) {
    assert.equal(stampRewardFor(RULES, c.plan, c.card), c.expect, `${c.plan}, Karte ${c.card}`);
  }
  assert.equal(isGoldenCard(RULES, 4), false);
  assert.equal(isGoldenCard(RULES, 5), true);
  assert.equal(isGoldenCard(RULES, 0), false);
});

test('Stempelkarte: volle Karte fängt neu an', () => {
  for (const c of FIXTURES.stampProgress) {
    const p = stampProgress(RULES, c.total);
    assert.equal(p.filled, c.expect.filled, `total ${c.total}`);
    assert.equal(p.completedCards, c.expect.completedCards, `total ${c.total}`);
    assert.equal(p.remaining, RULES.stampCard.fields - p.filled);
  }
  assert.equal(stampProgress(RULES, -3).filled, 0);
});

test('mehr Leute sparen nie weniger', () => {
  for (const plan of ['free', 'gold', 'platinum']) {
    let last = -1;
    for (let people = 1; people <= 20; people++) {
      const { percent } = discountFor(RULES, plan, people);
      assert.ok(percent >= last, `${plan}, ${people} Personen`);
      last = percent;
    }
  }
});

test('höhere Stufe spart nie weniger', () => {
  for (let people = 1; people <= 12; people++) {
    const free = discountFor(RULES, 'free', people).percent;
    const gold = discountFor(RULES, 'gold', people).percent;
    const platinum = discountFor(RULES, 'platinum', people).percent;
    assert.ok(free <= gold && gold <= platinum, `${people} Personen`);
  }
});

test('Deckel wird gemeldet', () => {
  assert.equal(discountFor(RULES, 'platinum', 10, 15).capped, true);
  assert.equal(discountFor(RULES, 'platinum', 10).capped, false);
  assert.equal(discountFor(RULES, 'free', 1).capped, false);
});

test('Gruppenrabatt je Stufe: die gemeinsamen Fälle', () => {
  for (const c of FIXTURES.groupPercents) {
    assert.equal(groupPercentFor(RULES, c.plan, c.people), c.expect, `${c.plan}, ${c.people} Personen`);
  }
});

test('Gruppenrabatt 3–10 % für alle Stufen, insgesamt höchstens 20 %', () => {
  const top = (plan: string) => groupPercentFor(RULES, plan, 1000);
  assert.equal(groupPercentFor(RULES, 'free', 2), 3);
  assert.equal(top('free'), 10);
  assert.equal(top('gold'), 10);
  assert.equal(top('platinum'), 10);
  assert.equal(discountFor(RULES, 'platinum', 1000).percent, 20);
  assert.equal(discountFor(RULES, 'gold', 1000).percent, 15);
  assert.equal(RULES.discountCap.defaultPercent, 20);
  assert.equal(planFor(RULES, 'gold').discountPercent, 5);
  assert.equal(planFor(RULES, 'platinum').discountPercent, 10);
});

test('Monats-Credits = 12,5 % des Abopreises als Credit-Wert, auf ganze Credits gerundet', () => {
  for (const plan of RULES.plans) {
    const exact = (plan.priceCents * 0.125) / (RULES.credits.centsPerTenCredits / 10);
    assert.equal(plan.monthlyCredits, Math.round(exact), plan.key);
  }
  assert.equal(planFor(RULES, 'gold').monthlyCredits, 42);
  assert.equal(planFor(RULES, 'platinum').monthlyCredits, 83);
});

test('Gültigkeit je Stufe: 365 Tage, 18 Monate, 30 Monate', () => {
  assert.deepEqual(creditValidityFor(RULES, 'free'), { days: 365 });
  assert.deepEqual(creditValidityFor(RULES, 'gold'), { months: 18 });
  assert.deepEqual(creditValidityFor(RULES, 'platinum'), { months: 30 });
  assert.equal(creditValidityLabel(RULES, 'free'), '365 Tage');
  assert.equal(creditValidityLabel(RULES, 'platinum'), '30 Monate');
  assert.equal(creditValidityLabel(RULES, 'diamond'), '365 Tage');
});

test('Jahresabo: zehn Monatspreise, zwei Monate gespart', () => {
  assert.equal(periodPriceCents(RULES, 'gold', 'year'), 24990);
  assert.equal(periodPriceCents(RULES, 'gold', 'month'), 2499);
  assert.equal(yearlySavingsCents(RULES, 'gold'), 2 * 2499);
  assert.equal(yearlySavingsCents(RULES, 'platinum'), 2 * 4999);
});

test('Happy Hour (Testphase): Di–Do, Gold 15 %, Platinum 20 %', () => {
  assert.equal(happyHourPercent(RULES, 'gold', '2026-10-06'), 15); // Dienstag
  assert.equal(happyHourPercent(RULES, 'platinum', '2026-10-08'), 20); // Donnerstag
  assert.equal(happyHourPercent(RULES, 'gold', '2026-10-10'), 0); // Samstag
  assert.equal(happyHourPercent(RULES, 'free', '2026-10-06'), 0);
  assert.equal(happyHourPercent(RULES, 'gold', null), 0);
  assert.equal(applyHappyHour(95, 15), 81);
  assert.equal(applyHappyHour(90, 20), 72);
});

test('unbekannte oder fehlende Stufe = Free', () => {
  assert.equal(planFor(RULES, null).key, 'free');
  assert.equal(planFor(RULES, 'gold').name, 'Gold Plan');
});

test('Formatierung', () => {
  assert.equal(formatEuro(2999), '29,99 €');
  assert.equal(formatEuro(7500), '75,00 €');
  assert.equal(formatEuro(123456), '1.234,56 €');
  assert.equal(formatEuro(-375), '−3,75 €');
  assert.equal(formatPercent(17.5), '17,5 %');
  assert.equal(formatPercent(20), '20 %');
  assert.equal(formatCredits(1000), '1.000');
  assert.equal(formatCredits(50), '50');
});
