/**
 * Pruefung einer Meldung – reine Logik, ohne Datenbank.
 *
 * Ob es den gemeldeten Inhalt gibt, weiss nur die DB; das prueft der Router.
 * Hier steht die Frage davor: Ist das ueberhaupt eine Meldung, die man
 * bearbeiten kann? Eine Meldung ohne erkennbaren Grund ist fuer den Admin
 * Arbeit ohne Anhaltspunkt.
 *
 * Die App spricht nur noch mit der Laravel-API: Ob ihre Gruende und Ziele zu denen
 * der API passen, prueft api/tests/Feature/ReportListsTest.php – nicht mehr dieser
 * Server.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_REPORT_NOTE,
  REPORT_REASONS,
  REPORT_TARGETS,
  parseReportInput,
} from '../src/reports.js';

test('comments under posts and events can be reported (F-08)', () => {
  for (const targetType of ['post_comment', 'activity_comment']) {
    const result = parseReportInput({ target_type: targetType, target_id: 5, reason: 'harassment' });
    assert.equal(result.error, null, `${targetType} is not a report target`);
    assert.equal(result.targetType, targetType);
    // The key must fit content_reports.target_type (VARCHAR(20) in schema.sql).
    assert.ok(targetType.length <= 20);
  }
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
