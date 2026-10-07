/**
 * Gesperrte Begriffe – reine Logik, ohne Datenbank.
 *
 * Der wichtigste Test ist der erste: die gemeinsamen Faelle aus
 * shared/blocked-terms.fixtures.json, die App (src/domain/blocked-terms.test.ts)
 * und Laravel (api/tests/Unit/BlockedTermsTest.php) genauso durchlaufen. Rechnet
 * eine der drei Umsetzungen anders, lehnt die App etwas ab, was der Server
 * annimmt – oder, schlimmer, der Server nimmt etwas an, was die App nie
 * durchlassen wollte.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  BLOCKED_TERMS,
  BLOCKED_TERM_MODES,
  analyseText,
  blockedTermMessageFor,
  findBlockedTerm,
  rejectBlockedTerms,
} from '../src/blocked-terms.js';
import { Validator } from '../src/validate.js';

const SHARED = path.join(import.meta.dirname, '..', '..', 'shared');
const FIXTURES = JSON.parse(fs.readFileSync(path.join(SHARED, 'blocked-terms.fixtures.json'), 'utf8'));

test('die gemeinsamen Faelle: dasselbe Ergebnis wie App und Laravel', () => {
  assert.ok(FIXTURES.cases.length >= 100);
  for (const c of FIXTURES.cases) {
    const hit = findBlockedTerm(c.input, BLOCKED_TERMS, c.mode);
    const label = `${JSON.stringify(c.input)} (${c.mode})${c.note ? ` – ${c.note}` : ''}`;
    assert.equal(hit !== null, c.blocked, label);
    if (c.blocked) assert.equal(hit.term, c.term, label);
  }
});

test('die Liste wird aus shared/ gelesen, nicht aus einer Kopie', () => {
  // Liegt irgendwann eine zweite Datei in server/, laufen App und Server
  // auseinander, ohne dass ein Test es merkt.
  const shared = JSON.parse(fs.readFileSync(path.join(SHARED, 'blocked-terms.json'), 'utf8'));
  assert.deepEqual(BLOCKED_TERMS, shared);
});

test('jeder Begriff sperrt sich selbst – in jedem Modus seiner Gruppe', () => {
  for (const group of BLOCKED_TERMS.groups) {
    for (const kind of ['substring', 'prefix', 'word']) {
      for (const term of group[kind] ?? []) {
        for (const mode of group.modes) {
          assert.ok(findBlockedTerm(term, BLOCKED_TERMS, mode), `${group.id}/${kind}: "${term}" in ${mode}`);
        }
      }
    }
  }
});

test('Normalisierung: Leet, Umlaute, Trenner und camelCase landen dort, wo gesucht wird', () => {
  const { chunks, tokens } = analyseText('Kümmel_Türke');
  assert.ok(chunks.includes('kuemmeltuerke'));
  assert.ok(chunks.includes('kummelturke'));
  assert.ok(analyseText('FickDich').tokens.includes('fick dich'));
  assert.ok(analyseText('w1chser2008').tokens.includes('wichser'));
  // Reine Zahlen bleiben Zahlen – „455" wird nicht zu „ass".
  assert.ok(analyseText('Bus 455').tokens.every((line) => line.includes('455')));
  assert.ok(tokens.includes('kuemmel tuerke'));
});

test('Meldungen: je Modus der Satz, den auch die App zeigt', () => {
  assert.equal(
    blockedTermMessageFor('username'),
    'Dieser Benutzername ist nicht erlaubt – bitte wähle einen anderen.',
  );
  assert.equal(blockedTermMessageFor('name'), 'Dieser Name ist nicht erlaubt.');
  assert.equal(blockedTermMessageFor('text'), 'Dein Text enthält Wörter, die hier nicht erlaubt sind.');
  for (const mode of BLOCKED_TERM_MODES) assert.ok(BLOCKED_TERMS.messages[mode]);
});

test('rejectBlockedTerms: traegt die Meldung am Feld ein und uebergeht Leeres', () => {
  const v = new Validator({});
  assert.equal(rejectBlockedTerms(v, 'title', 'Nazis raus!', 'text'), false);
  assert.equal(rejectBlockedTerms(v, 'title', '', 'text'), false);
  assert.equal(rejectBlockedTerms(v, 'title', undefined, 'text'), false);
  assert.equal(v.fails(), false);

  assert.equal(rejectBlockedTerms(v, 'description', 'Du Hurensohn', 'text'), true);
  assert.deepEqual(v.errors, { description: [blockedTermMessageFor('text')] });
});

test('ein unbekannter Modus ist ein Programmierfehler, kein „erlaubt"', () => {
  assert.throws(() => findBlockedTerm('x', BLOCKED_TERMS, 'bio'), TypeError);
});

test('eine volle Beschreibung (2000 Zeichen) ist schnell geprueft', () => {
  // Exactly 2000 characters, as the name says: 29 repetitions were 2030, which is now over
  // max_input_length (a 'length' hit; the route refuses such a description first anyway).
  const long = 'Wir treffen uns am Samstag im Park, bringt Decken und gute Laune mit. '.repeat(29).slice(0, 2000);
  assert.equal(long.length, 2000);
  const started = Date.now();
  assert.equal(findBlockedTerm(long, BLOCKED_TERMS, 'text'), null);
  assert.ok(Date.now() - started < 1000, `${Date.now() - started} ms`);
});

/* ------------------------------------------------ Input over the maximum (F-02) */

/** The shared maximum, written out: the routes' longest text (an event description). */
const MAX_INPUT = 2000;

test('the shared list carries max_input_length = 2000', () => {
  assert.equal(BLOCKED_TERMS.max_input_length, MAX_INPUT);
});

test('the shared length cases: the same answer as the app and Laravel', () => {
  assert.ok(Array.isArray(FIXTURES.length_cases) && FIXTURES.length_cases.length >= 5, 'length_cases missing');
  for (const c of FIXTURES.length_cases) {
    const hit = findBlockedTerm(c.unit.repeat(c.count), BLOCKED_TERMS, c.mode);
    const label = `${JSON.stringify(c.unit)} x ${c.count} (${c.mode})${c.note ? ` – ${c.note}` : ''}`;
    assert.equal(hit !== null, c.blocked, label);
    if (c.blocked) assert.deepEqual({ term: hit.term, kind: hit.kind }, { term: '', kind: 'length' }, label);
  }
});

test('the word filter fails closed on 100,000 characters in under 500 ms, in every mode', () => {
  for (const mode of BLOCKED_TERM_MODES) {
    for (const text of ['a'.repeat(100_000), 'n1gg3r '.repeat(15_000), `${'x'.repeat(99_999)}!`]) {
      const started = performance.now();
      const hit = findBlockedTerm(text, BLOCKED_TERMS, mode);
      const ms = performance.now() - started;
      assert.equal(hit?.kind, 'length', mode);
      assert.ok(ms < 500, `${mode}: ${ms.toFixed(1)} ms`);
    }
  }
});

test('adversarial input at the maximum (2000 characters) is checked in under 500 ms', () => {
  // The residual cost the cap leaves: the unanchored patterns are quadratic in the input length.
  const shapes = [...'abcdefghijklmnopqrstuvwxyz'].map((ch) => ch.repeat(MAX_INPUT));
  shapes.push('a '.repeat(MAX_INPUT / 2), 'aA'.repeat(MAX_INPUT / 2), 'n1'.repeat(MAX_INPUT / 2), 'ä'.repeat(MAX_INPUT));
  let worst = 0;
  for (const text of shapes) {
    for (const mode of BLOCKED_TERM_MODES) {
      const started = performance.now();
      const hit = findBlockedTerm(text, BLOCKED_TERMS, mode);
      worst = Math.max(worst, performance.now() - started);
      assert.notEqual(hit?.kind, 'length', 'at the maximum the patterns run');
    }
  }
  assert.ok(worst < 500, `worst ${worst.toFixed(1)} ms over ${shapes.length * BLOCKED_TERM_MODES.length} checks`);
});

test('a list without a valid max_input_length is refused, never used without a bound', () => {
  // Operator-facing, so in English; the same text in all three copies of the filter.
  const refused = { name: 'TypeError', message: 'Blocked-terms list: max_input_length is missing or not a positive whole number' };
  for (const max of [undefined, 0, -1, 2.5, '2000']) {
    assert.throws(() => findBlockedTerm('Hallo', { ...BLOCKED_TERMS, max_input_length: max }, 'text'), refused, String(max));
  }
});
