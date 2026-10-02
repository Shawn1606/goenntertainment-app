/**
 * Pruefung einer Meldung – reine Logik, ohne Datenbank.
 *
 * Ob es den gemeldeten Inhalt gibt, weiss nur die DB; das prueft der Router.
 * Hier steht die Frage davor: Ist das ueberhaupt eine Meldung, die man
 * bearbeiten kann? Eine Meldung ohne erkennbaren Grund ist fuer den Admin
 * Arbeit ohne Anhaltspunkt.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  MAX_REPORT_NOTE,
  REPORT_REASONS,
  REPORT_TARGETS,
  parseReportInput,
} from '../src/reports.js';

/**
 * Die Gruende, die die App anbietet – aus der Quelle gelesen, damit kein
 * TS-Import noetig ist (gleiches Vorgehen wie in test/rewards.test.js).
 *
 * Der Pfad kommt aus dem Ort DIESER Datei und nicht aus `process.cwd()`: Sonst
 * haengt der Test daran, aus welchem Ordner man ihn startet – aus dem
 * Projektstamm zeigt `cwd/..` schon neben das Repo.
 */
function appReasonKeys() {
  const file = path.join(import.meta.dirname, '..', '..', 'src', 'domain', 'report-reason.ts');
  const source = fs.readFileSync(file, 'utf8');
  // OHNE Zeilenanfangs-Anker: Ein Eintrag, der in eine Zeile passt, faengt nicht
  // mit `key:` an – der Anker hat genau so schon einen Grund uebersehen.
  return [...source.matchAll(/\bkey: '([^']+)'/g)].map((match) => match[1]);
}

/**
 * The report targets the app knows: REPORT_TARGETS in src/domain/report-reason.ts (the app's one
 * list, read by the report sheet, the API types and the admin screen), read from the source like
 * the reasons above. [] when the app has no such list.
 */
function appTargetKeys() {
  const file = path.join(import.meta.dirname, '..', '..', 'src', 'domain', 'report-reason.ts');
  const block = fs.readFileSync(file, 'utf8').match(/export const REPORT_TARGETS = \[([^\]]*)\]/);
  return block ? [...block[1].matchAll(/'([^']+)'/g)].map((match) => match[1]) : [];
}

test('app and server know the same report targets', () => {
  // A target the app offers but the server does not know ends in a 422 on sending; one the server
  // knows but the app does not shows up in the admin list without a label.
  const app = appTargetKeys();
  assert.ok(app.length > 0, 'the app has no list of report targets (REPORT_TARGETS in src/domain/report-reason.ts)');
  assert.deepEqual([...app].sort(), [...REPORT_TARGETS].sort());
});

test('comments under posts and events can be reported (F-08)', () => {
  for (const targetType of ['post_comment', 'activity_comment']) {
    const result = parseReportInput({ target_type: targetType, target_id: 5, reason: 'harassment' });
    assert.equal(result.error, null, `${targetType} is not a report target`);
    assert.equal(result.targetType, targetType);
    // The key must fit content_reports.target_type (VARCHAR(20) in schema.sql).
    assert.ok(targetType.length <= 20);
  }
});

test('App und Server kennen dieselben Gruende', () => {
  // Der Grund fuer diesen Test: Die Texte stehen in der App, die erlaubten Werte
  // im Server. Kommt in der App ein Grund dazu, ohne dass er hier steht, laeuft
  // die Meldung in ein 422 – und zwar erst beim Absenden.
  assert.deepEqual([...appReasonKeys()].sort(), [...REPORT_REASONS].sort());
});

test('Ziele und Gruende sind nicht leer und eindeutig', () => {
  assert.ok(REPORT_TARGETS.length > 0);
  assert.equal(new Set(REPORT_TARGETS).size, REPORT_TARGETS.length);
  assert.ok(REPORT_REASONS.length > 0);
  assert.equal(new Set(REPORT_REASONS).size, REPORT_REASONS.length);
});

test('es gibt einen Sammelgrund, damit niemand am Formular scheitert', () => {
  // Ohne „sonstiges" muesste man den passenden Grund erraten – und liesse es dann.
  assert.ok(REPORT_REASONS.includes('other'));
});

test('eine vollstaendige Meldung kommt sauber zurueck', () => {
  const result = parseReportInput({
    target_type: 'message',
    target_id: '77',
    reason: 'harassment',
    note: '  Beleidigt mich in der Gruppe.  ',
  });
  assert.equal(result.error, null);
  assert.equal(result.targetType, 'message');
  assert.equal(result.targetId, 77);
  assert.equal(result.reason, 'harassment');
  assert.equal(result.note, 'Beleidigt mich in der Gruppe.');
});

test('die Schilderung ist freiwillig', () => {
  const result = parseReportInput({ target_type: 'user', target_id: 3, reason: 'spam' });
  assert.equal(result.error, null);
  assert.equal(result.note, null);
});

test('eine leere Schilderung wird zu null, nicht zu einem leeren Text', () => {
  const result = parseReportInput({ target_type: 'user', target_id: 3, reason: 'spam', note: '   ' });
  assert.equal(result.error, null);
  assert.equal(result.note, null);
});

test('unbekannte Ziele und Gruende werden abgelehnt', () => {
  assert.ok(parseReportInput({ target_type: 'kommentar', target_id: 1, reason: 'spam' }).error);
  assert.ok(parseReportInput({ target_type: 'user', target_id: 1, reason: 'gefaellt-mir-nicht' }).error);
  assert.ok(parseReportInput({ target_id: 1, reason: 'spam' }).error);
  assert.ok(parseReportInput({ target_type: 'user', target_id: 1 }).error);
});

test('eine unbrauchbare Ziel-ID wird abgelehnt', () => {
  assert.ok(parseReportInput({ target_type: 'user', target_id: 0, reason: 'spam' }).error);
  assert.ok(parseReportInput({ target_type: 'user', target_id: -1, reason: 'spam' }).error);
  assert.ok(parseReportInput({ target_type: 'user', target_id: 'x', reason: 'spam' }).error);
  assert.ok(parseReportInput({ target_type: 'user', reason: 'spam' }).error);
});

test('eine zu lange Schilderung wird abgelehnt, nicht abgeschnitten', () => {
  // Abschneiden hiesse: Der Hinweis, auf den es ankommt, faellt still weg.
  const note = 'a'.repeat(MAX_REPORT_NOTE + 1);
  assert.ok(parseReportInput({ target_type: 'user', target_id: 1, reason: 'spam', note }).error);
  const fits = 'a'.repeat(MAX_REPORT_NOTE);
  assert.equal(
    parseReportInput({ target_type: 'user', target_id: 1, reason: 'spam', note: fits }).error,
    null,
  );
});

test('gar keine Eingabe ist keine Meldung', () => {
  assert.ok(parseReportInput(null).error);
  assert.ok(parseReportInput(undefined).error);
});
