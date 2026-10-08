import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PLAN_KEYS, type ClubRules } from './club.ts';
import { bookingExample, planComparison, planFaq } from './plan-overview.ts';

const RULES = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'shared', 'club.json'), 'utf8')) as ClubRules;

const EMOJI = /\p{Extended_Pictographic}/u;

function row(key: string) {
  const found = planComparison(RULES).find((r) => r.key === key);
  assert.ok(found, `Zeile ${key} fehlt`);
  return found;
}

test('Vergleich: jede Zeile hat eine Zelle je Stufe', () => {
  for (const r of planComparison(RULES)) {
    assert.deepEqual(Object.keys(r.cells).sort(), [...PLAN_KEYS].sort(), r.key);
    for (const plan of PLAN_KEYS) assert.ok(r.cells[plan].text.length > 0, `${r.key}/${plan} leer`);
  }
});

test('Vergleich: Preise und Rabatte aus shared/club.json', () => {
  assert.equal(row('price').cells.free.text, 'Kostenlos');
  assert.equal(row('price').cells.gold.text, '24,99 €');
  assert.equal(row('price').cells.platinum.text, '49,99 €');
  assert.equal(row('yearly').cells.free.text, '–');
  assert.equal(row('yearly').cells.gold.text, '249,90 €');
  assert.equal(row('discount').cells.free.text, '–');
  assert.equal(row('discount').cells.platinum.text, '10 %');
  assert.equal(row('credits').cells.gold.text, '42');
  assert.equal(row('credits').cells.platinum.text, '83');
});

test('Vergleich: Gruppenrabatt für alle gleich, zu zehnt mit Club-Rabatt gedeckelt', () => {
  for (const plan of PLAN_KEYS) assert.equal(row('group').cells[plan].text, '3–10 %');
  assert.equal(row('max').hint, 'ab 10 Personen');
  assert.deepEqual(PLAN_KEYS.map((p) => row('max').cells[p].text), ['10 %', '15 %', '20 %']);
});

test('Vergleich: Stempelkarte, goldene Karte und Gültigkeit je Stufe', () => {
  assert.deepEqual(PLAN_KEYS.map((p) => row('stamp').cells[p].text), ['100 Credits', '125 Credits', '150 Credits']);
  assert.equal(row('golden').label, 'Jede 5. Karte golden');
  assert.deepEqual(PLAN_KEYS.map((p) => row('golden').cells[p].text), ['150 Credits', '188 Credits', '225 Credits']);
  assert.deepEqual(PLAN_KEYS.map((p) => row('validity').cells[p].text), ['365 Tage', '18 Monate', '30 Monate']);
});

test('Vergleich: „bester Wert" nur, wo sich die Stufen unterscheiden', () => {
  assert.equal(row('discount').cells.platinum.best, true);
  assert.equal(row('discount').cells.gold.best, false);
  for (const plan of PLAN_KEYS) {
    assert.equal(row('price').cells[plan].best, false, 'beim Preis gibt es kein „besser"');
    assert.equal(row('yearly').cells[plan].best, false);
  }
  assert.equal(row('validity').cells.platinum.best, true);
  for (const plan of PLAN_KEYS) assert.equal(row('group').cells[plan].best, false);
});

test('Beispiel-Ausflug: zu sechst à 20 € spart jede Stufe mehr', () => {
  const [free, gold, platinum] = bookingExample(RULES, 6, 2000);
  assert.deepEqual([free.plan, gold.plan, platinum.plan], ['free', 'gold', 'platinum']);
  assert.equal(free.percent, 7);
  assert.equal(gold.percent, 12);
  assert.equal(platinum.percent, 17);
  assert.equal(free.totalCents, 11160);
  assert.equal(free.savedCents, 840);
  assert.equal(platinum.savedCents, 2040);
  assert.equal(platinum.perPersonCents, 1660);
  for (const q of [free, gold, platinum]) assert.equal(q.totalCents + q.savedCents, 12000);
});

test('Beispiel-Ausflug: allein nur der Club-Rabatt, unsinnige Werte werden abgefangen', () => {
  const alone = bookingExample(RULES, 1, 1000);
  assert.deepEqual(alone.map((q) => q.percent), [0, 5, 10]);
  const odd = bookingExample(RULES, Number.NaN, -500);
  assert.ok(odd.every((q) => q.totalCents === 0 && q.savedCents === 0));
});

test('Häufige Fragen: Zahlen aus den Regeln, keine Emojis', () => {
  const faq = planFaq(RULES);
  assert.ok(faq.length >= 5);
  const all = faq.map((f) => `${f.q} ${f.a}`).join(' ');
  assert.match(all, /Gold 49,98 €, Platinum 99,98 €/);
  assert.match(all, /Free 365 Tage, Gold 18 Monate, Platinum 30 Monate/);
  assert.match(all, /jede 5\. Karte ist golden und bringt 50 % mehr/);
  assert.ok(!EMOJI.test(all));
  for (const f of faq) assert.ok(f.q.endsWith('?'), f.q);
});
