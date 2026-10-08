import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { discountFor, type ClubRules } from './club.ts';
import { discountStep } from './group-discount.ts';

const RULES = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'shared', 'club.json'), 'utf8')) as ClubRules;

test('allein: nächste Stufe sind zwei Personen', () => {
  const step = discountStep(RULES, 'free', 1);
  assert.equal(step.next?.people, 2);
  assert.ok((step.next?.percent ?? 0) > step.percent);
  assert.equal(step.progress, 0);
});

test('die nächste Stufe hat wirklich mehr Rabatt, und davor gibt es keine', () => {
  for (const plan of ['free', 'gold', 'platinum']) {
    for (let people = 1; people <= 12; people++) {
      const step = discountStep(RULES, plan, people);
      assert.equal(step.percent, discountFor(RULES, plan, people).percent);
      if (step.next) {
        assert.ok(step.next.percent > step.percent);
        for (let n = people + 1; n < step.next.people; n++) assert.equal(discountFor(RULES, plan, n).percent, step.percent);
      }
      assert.ok(step.progress >= 0 && step.progress <= 1);
    }
  }
});

test('ganz oben gibt es keine nächste Stufe', () => {
  const step = discountStep(RULES, 'platinum', 30);
  assert.equal(step.next, null);
  assert.equal(step.progress, 1);
});

test('kaputte Zahlen werden zu einer Person', () => {
  assert.equal(discountStep(RULES, 'free', Number.NaN).percent, discountFor(RULES, 'free', 1).percent);
});
