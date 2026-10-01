import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  BLOCKED_TERM_MODES,
  analyseText,
  blockedTermMessageFor,
  findBlockedTerm,
  type BlockedTermLists,
  type BlockedTermMode,
} from './blocked-terms.ts';

/**
 * Liste und Faelle kommen aus shared/ – per readFileSync, weil Node-ESM einen
 * JSON-Import ohne Import-Attribut ablehnt (und Metro keins braucht).
 */
const SHARED = join(import.meta.dirname, '..', '..', 'shared');
const LISTS = JSON.parse(readFileSync(join(SHARED, 'blocked-terms.json'), 'utf8')) as BlockedTermLists;
const FIXTURES = JSON.parse(readFileSync(join(SHARED, 'blocked-terms.fixtures.json'), 'utf8')) as {
  cases: { input: string; mode: BlockedTermMode; blocked: boolean; term?: string; note?: string }[];
};

test('die gemeinsamen Faelle: dasselbe Ergebnis wie Node und Laravel', () => {
  // Nicht nur „gesperrt ja/nein", sondern auch WELCHER Begriff: Nur so faellt
  // auf, wenn eine Umsetzung in anderer Reihenfolge prueft oder anders
  // normalisiert – auch dann, wenn das Ergebnis zufaellig noch stimmt.
  assert.ok(FIXTURES.cases.length >= 100);
  for (const c of FIXTURES.cases) {
    const hit = findBlockedTerm(c.input, LISTS, c.mode);
    const label = `${JSON.stringify(c.input)} (${c.mode})${c.note ? ` – ${c.note}` : ''}`;
    assert.equal(hit !== null, c.blocked, label);
    if (c.blocked) assert.equal(hit?.term, c.term, label);
  }
});

test('es gibt Faelle in jedem Modus, gesperrte wie harmlose', () => {
  for (const mode of BLOCKED_TERM_MODES) {
    const inMode = FIXTURES.cases.filter((c) => c.mode === mode);
    assert.ok(inMode.some((c) => c.blocked), `${mode}: gesperrter Fall fehlt`);
    assert.ok(inMode.some((c) => !c.blocked), `${mode}: harmloser Fall fehlt`);
  }
});

test('jeder Begriff ergibt nach der Normalisierung etwas Pruefbares', () => {
  // Ein Begriff, der zu nichts zerfaellt (etwa in einer Schrift, die die
  // Zeichentabelle nicht kennt), sperrte stillschweigend gar nichts.
  for (const group of LISTS.groups) {
    for (const kind of ['substring', 'prefix', 'word'] as const) {
      for (const term of group[kind] ?? []) {
        const { tokens } = analyseText(term, LISTS);
        const squashed = tokens[0].replace(/ /g, '');
        assert.ok(squashed.length >= 3, `${group.id}/${kind}: "${term}" ist nach der Normalisierung zu kurz`);
      }
    }
  }
});

test('ein Begriff sperrt sich selbst – in jedem Modus seiner Gruppe', () => {
  // Faengt Tippfehler in der Liste ab, die den Begriff unerreichbar machen,
  // und eine allow-Ausnahme, die versehentlich einen ganzen Begriff schluckt.
  for (const group of LISTS.groups) {
    for (const kind of ['substring', 'prefix', 'word'] as const) {
      for (const term of group[kind] ?? []) {
        for (const mode of group.modes as BlockedTermMode[]) {
          assert.ok(findBlockedTerm(term, LISTS, mode), `${group.id}/${kind}: "${term}" in ${mode}`);
        }
      }
    }
  }
});

test('Gruppen kennen nur die drei Modi, allow-Woerter sind einzelne Woerter', () => {
  for (const group of LISTS.groups) {
    assert.ok(group.modes.length > 0, group.id);
    for (const mode of group.modes) {
      assert.ok((BLOCKED_TERM_MODES as readonly string[]).includes(mode), `${group.id}: ${mode}`);
    }
  }
  for (const word of LISTS.allow) {
    assert.equal(analyseText(word, LISTS).tokens[0].split(' ').length, 1, word);
  }
});

test('der Modus entscheidet: Nachname im Namen ja, im Benutzernamen nein', () => {
  assert.equal(findBlockedTerm('Anna Fick', LISTS, 'name'), null);
  assert.equal(findBlockedTerm('anna_fick', LISTS, 'username')?.group, 'nicht-im-namen');
  // Geschichte im Text, Selbstbezeichnung im Namen.
  assert.equal(findBlockedTerm('Ausstellung über Hitler', LISTS, 'text'), null);
  assert.equal(findBlockedTerm('Hitler', LISTS, 'name')?.group, 'selbstbezeichnung');
});

test('Wortfolgen verbinden keine Woerter aus verschiedenen Lesarten', () => {
  // Die Lesarten stehen intern in EINER Zeile. Endete eine auf „sieg" und
  // begaenne die naechste mit „heil", entstuende sonst eine Parole, die nie
  // geschrieben wurde.
  assert.equal(findBlockedTerm('Heil und Segen zum Sieg', LISTS, 'text'), null);
  assert.equal(findBlockedTerm('heilig ist der sieg', LISTS, 'text'), null);
});

test('Meldungen: je Modus der Satz aus der Datei, bei harmlosen Werten null', () => {
  assert.equal(
    blockedTermMessageFor('hurensohn99', LISTS, 'username'),
    'Dieser Benutzername ist nicht erlaubt – bitte wähle einen anderen.',
  );
  assert.equal(blockedTermMessageFor('Hure', LISTS, 'name'), 'Dieser Name ist nicht erlaubt.');
  assert.equal(
    blockedTermMessageFor('du Wichser', LISTS, 'text'),
    'Dein Text enthält Wörter, die hier nicht erlaubt sind.',
  );
  assert.equal(blockedTermMessageFor('Lena', LISTS, 'name'), null);
  assert.equal(blockedTermMessageFor('', LISTS, 'text'), null);
  assert.equal(blockedTermMessageFor(undefined, LISTS, 'text'), null);
});

test('ein unbekannter Modus ist ein Programmierfehler, kein „erlaubt"', () => {
  assert.throws(() => findBlockedTerm('x', LISTS, 'bio' as BlockedTermMode), TypeError);
});

test('lange Texte bleiben schnell genug fuer die Eingabe', () => {
  // 2000 Zeichen = die laengste Beschreibung, die der Server annimmt. Exactly 2000 now: 29
  // repetitions were 2030, which is over max_input_length (a 'length' hit).
  const long = 'Wir treffen uns am Samstag im Park, bringt Decken und gute Laune mit. '.repeat(29).slice(0, 2000);
  assert.equal(long.length, 2000);
  const started = Date.now();
  assert.equal(findBlockedTerm(long, LISTS, 'text'), null);
  assert.ok(Date.now() - started < 1000, `${Date.now() - started} ms`);
});

/* ------------------------------------------------ Input over the maximum (F-02) */

type LengthCase = { unit: string; count: number; mode: BlockedTermMode; blocked: boolean; note?: string };

test('the shared list carries max_input_length = 2000', () => {
  assert.equal((LISTS as { max_input_length?: unknown }).max_input_length, 2000);
});

test('the shared length cases: the same answer as Node and Laravel', () => {
  const cases = (FIXTURES as unknown as { length_cases?: LengthCase[] }).length_cases;
  assert.ok(Array.isArray(cases) && cases.length >= 5, 'length_cases missing');
  for (const c of cases) {
    const hit = findBlockedTerm(c.unit.repeat(c.count), LISTS, c.mode);
    const label = `${JSON.stringify(c.unit)} x ${c.count} (${c.mode})${c.note ? ` – ${c.note}` : ''}`;
    assert.equal(hit !== null, c.blocked, label);
    if (c.blocked) assert.deepEqual({ term: hit?.term, kind: hit?.kind }, { term: '', kind: 'length' }, label);
  }
});

test('the word filter fails closed on 100,000 characters in under 500 ms, in every mode', () => {
  for (const mode of BLOCKED_TERM_MODES) {
    const started = performance.now();
    const hit = findBlockedTerm('a'.repeat(100_000), LISTS, mode);
    const ms = performance.now() - started;
    assert.equal(hit?.kind, 'length', mode);
    assert.ok(ms < 500, `${mode}: ${ms.toFixed(1)} ms`);
  }
});

test('a list without a valid max_input_length is refused, never used without a bound', () => {
  for (const max of [undefined, 0, 2.5]) {
    const lists = { ...LISTS, max_input_length: max } as unknown as BlockedTermLists;
    assert.throws(() => findBlockedTerm('Hallo', lists, 'text'), TypeError, String(max));
  }
});
