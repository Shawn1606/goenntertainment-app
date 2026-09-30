import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  discountFor,
  formatCredits,
  formatEuro,
  formatPercent,
  groupBasePercent,
  packPriceCents,
  planFor,
  quoteCredits,
  quoteMoney,
  stampProgress,
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
  packPrices: { credits: number; priceCents: number }[];
  stampProgress: { total: number; expect: { filled: number; completedCards: number } }[];
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
  for (const p of FIXTURES.packPrices) assert.equal(packPriceCents(RULES, p.credits), p.priceCents);
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
  assert.equal(discountFor(RULES, 'platinum', 10).capped, true);
  assert.equal(discountFor(RULES, 'free', 1).capped, false);
});

test('Gruppenrabatt ohne Club-Faktor', () => {
  assert.equal(groupBasePercent(RULES, 1), 0);
  assert.equal(groupBasePercent(RULES, 3), 5);
  assert.equal(groupBasePercent(RULES, 5), 10);
  assert.equal(groupBasePercent(RULES, 50), 20);
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
