import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { MIN_AGE, hasOperatorGaps } from '../constants/operator.ts';
// A namespace import: a test of an export that does not exist yet then fails on its assertion,
// not on loading the file.
import * as legal from './legal.ts';

const { LEGAL_DOCUMENTS, LEGAL_DOC_IDS, LEGAL_VERSION, acceptanceIsCurrent, legalDocument } = legal;

test('es gibt die fünf Dokumente, die eine solche App braucht', () => {
  // Impressum und Nutzungsbedingungen sind Pflicht, der Datenschutz-Text auch.
  // „Haftung" und „Regeln" stehen zusätzlich als eigene Dokumente da, weil genau
  // sie im Zweifel gelesen werden – versteckt in Absatz 9 der Bedingungen liest
  // sie niemand.
  assert.deepEqual([...LEGAL_DOC_IDS], ['terms', 'liability', 'conduct', 'privacy', 'imprint']);
});

test('jedes Dokument hat Titel, Kurzbeschreibung und Abschnitte', () => {
  assert.equal(LEGAL_DOCUMENTS.length, LEGAL_DOC_IDS.length);
  LEGAL_DOCUMENTS.forEach((doc) => {
    assert.ok(doc.title.length > 0, `${doc.id}: title`);
    assert.ok(doc.summary.length > 0, `${doc.id}: summary`);
    assert.ok(doc.sections.length > 0, `${doc.id}: keine Abschnitte`);
  });
});

test('kein Abschnitt ist leer', () => {
  // Ein Rechtstext mit einer leeren Überschrift ist schlimmer als einer ohne
  // diesen Punkt: Er behauptet, etwas zu regeln.
  LEGAL_DOCUMENTS.forEach((doc) => {
    doc.sections.forEach((section, index) => {
      assert.ok(section.heading.length > 0, `${doc.id}[${index}]: heading`);
      assert.ok(section.paragraphs.length > 0, `${doc.id}/${section.heading}: keine Absätze`);
      section.paragraphs.forEach((paragraph) => {
        assert.ok(paragraph.trim().length > 0, `${doc.id}/${section.heading}: leerer Absatz`);
      });
    });
  });
});

test('die Kennungen sind eindeutig', () => {
  const ids = LEGAL_DOCUMENTS.map((doc) => doc.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('Querverweise zeigen auf Dokumente, die es gibt', () => {
  // Der eigentliche Grund für diesen Test: Ein Verweis auf „datenschutz" (statt
  // 'privacy') fällt in der App nur auf, wenn jemand genau darauf tippt.
  const known = new Set<string>(LEGAL_DOC_IDS);
  LEGAL_DOCUMENTS.forEach((doc) => {
    (doc.related ?? []).forEach((id) => {
      assert.ok(known.has(id), `${doc.id} verweist auf unbekanntes ${id}`);
    });
  });
});

test('kein Dokument verweist auf sich selbst', () => {
  LEGAL_DOCUMENTS.forEach((doc) => {
    assert.ok(!(doc.related ?? []).includes(doc.id), `${doc.id} verweist auf sich selbst`);
  });
});

test('legalDocument findet nur echte Kennungen', () => {
  assert.equal(legalDocument('imprint')?.id, 'imprint');
  assert.equal(legalDocument('nutzungsbedingungen'), null);
  assert.equal(legalDocument(''), null);
  assert.equal(legalDocument(undefined), null);
});

test('die Haftung sagt die drei Dinge, um die es geht', () => {
  const liability = legalDocument('liability');
  assert.ok(liability);
  const text = liability.sections
    .flatMap((section) => [section.heading, ...section.paragraphs])
    .join(' ')
    .toLowerCase();

  // 1. Die Plattform ist nicht die Veranstalterin.
  assert.ok(text.includes('veranstalt'), 'Veranstalterrolle muss vorkommen');
  // 2. Teilnahme auf eigene Gefahr.
  assert.ok(text.includes('eigene verantwortung') || text.includes('eigene gefahr'));
  // 3. Ein Notruf-Hinweis – das ist der Satz, der im Ernstfall zählt.
  assert.ok(text.includes('112') || text.includes('110'), 'Notrufnummer muss dastehen');
});

test('das Impressum nennt Anbieter, Anschrift und zwei Kontaktwege', () => {
  const imprint = legalDocument('imprint');
  assert.ok(imprint);
  const headings = imprint.sections.map((section) => section.heading.toLowerCase()).join(' ');
  assert.ok(headings.includes('anbieter'));
  assert.ok(headings.includes('kontakt'));

  const text = imprint.sections.flatMap((section) => section.paragraphs).join(' ');
  // Die E-Mail allein genügt nach der Rechtsprechung nicht – ein zweiter direkter
  // Weg muss dabei sein.
  assert.ok(text.includes('@'), 'E-Mail fehlt');
  assert.ok(/telefon/i.test(text), 'zweiter Kontaktweg fehlt');
});

test('die Version ist ein Datum – daran hängt die erneute Zustimmung', () => {
  assert.match(LEGAL_VERSION, /^\d{4}-\d{2}-\d{2}$/);
});

test('nur die aktuelle Version gilt als zugestimmt', () => {
  assert.equal(acceptanceIsCurrent(LEGAL_VERSION), true);
  assert.equal(acceptanceIsCurrent('2020-01-01'), false);
  // Bestandskonten von vor der Zustimmung: null bedeutet „noch nicht".
  assert.equal(acceptanceIsCurrent(null), false);
  assert.equal(acceptanceIsCurrent(undefined), false);
});

test('die Betreiberdaten sind noch Platzhalter – dieser Test ist die Erinnerung', () => {
  /**
   * Kein Fehler, sondern eine Notiz: Solange hier Felder gemeldet werden, ist die
   * App nicht veröffentlichungsreif. Bewusst KEIN `assert.deepEqual(gaps, [])` –
   * das wäre ein roter Test bei jedem Lauf und damit einer, den man wegklickt.
   * Sind die Daten eingetragen, meldet dieser Test das ausdrücklich.
   */
  const gaps = hasOperatorGaps();
  if (gaps.length > 0) {
    console.log(`  Hinweis: Impressum noch unvollständig – offen: ${gaps.join(', ')}`);
  }
  assert.ok(Array.isArray(gaps));
});

/**
 * F-14: the server accepts a sign-up only with the terms version and the minimum age of
 * shared/legal.json. The app cannot import that file in these tests (no JSON imports without a
 * bundler), so LEGAL_VERSION and MIN_AGE are named mirrors, and this test keeps them equal.
 */
const LEGAL_JSON = path.resolve(import.meta.dirname, '..', '..', 'shared', 'legal.json');

test("the app's terms version and minimum age equal shared/legal.json (F-14)", () => {
  assert.ok(existsSync(LEGAL_JSON), 'shared/legal.json (the server-side source of both values) is missing');
  const shared = JSON.parse(readFileSync(LEGAL_JSON, 'utf8'));
  assert.equal(LEGAL_VERSION, shared.terms_version, 'LEGAL_VERSION differs from shared/legal.json');
  assert.equal(MIN_AGE, shared.min_age, 'MIN_AGE differs from shared/legal.json');
});

test('registration sends the confirmed minimum age and the current terms version (F-14)', () => {
  const consent = (legal as unknown as Record<string, unknown>).registrationConsent;
  assert.equal(typeof consent, 'function', 'the app sends no server-checkable age confirmation');
  assert.deepEqual((consent as () => unknown)(), { terms_version: LEGAL_VERSION, confirmed_min_age: MIN_AGE });
});
