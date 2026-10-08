import test from 'node:test';
import assert from 'node:assert/strict';

// A namespace import: a test of an export that does not exist yet then fails on its assertion,
// not on loading the file.
import * as report from './report-reason.ts';
import { UI_ICON_NAMES } from './ui-icon.ts';

const { REPORT_REASONS, isUrgent, reportReasonLabel } = report;

test('jeder Grund hat Schluessel, Beschriftung, Hinweis und Symbol', () => {
  assert.ok(REPORT_REASONS.length > 0);
  REPORT_REASONS.forEach((reason) => {
    assert.ok(reason.key.length > 0, 'key');
    assert.ok(reason.label.length > 0, `${reason.key}: label`);
    assert.ok(reason.hint.length > 0, `${reason.key}: hint`);
    assert.ok(
      (UI_ICON_NAMES as readonly string[]).includes(reason.icon),
      `${reason.key}: ${reason.icon} ist kein bekanntes Symbol`,
    );
  });
});

test('die Schluessel sind eindeutig', () => {
  const keys = REPORT_REASONS.map((reason) => reason.key);
  assert.equal(new Set(keys).size, keys.length);
});

test('der Sammelgrund steht zuletzt', () => {
  // Eine Liste, die mit „Sonstiges" anfaengt, macht alle anderen Gruende
  // unsichtbar – man nimmt den ersten Eintrag, der irgendwie passt.
  assert.equal(REPORT_REASONS[REPORT_REASONS.length - 1].key, 'other');
});

test('unbekannte Schluessel zeigt die Anzeige unveraendert, statt leer zu bleiben', () => {
  // Kann passieren, wenn ein neuerer Server einen Grund kennt, den diese
  // App-Version noch nicht hat.
  assert.equal(reportReasonLabel('spam'), 'Spam oder Werbung');
  assert.equal(reportReasonLabel('brandneu'), 'brandneu');
});

test('genau ein Grund gilt als dringend', () => {
  const urgent = REPORT_REASONS.filter((reason) => isUrgent(reason.key));
  assert.deepEqual(urgent.map((reason) => reason.key), ['danger']);
});

test('every report target has a label and a known icon, and comments are reportable (F-08)', () => {
  const exports = report as unknown as Record<string, unknown>;
  const targets = exports.REPORT_TARGETS;
  assert.ok(Array.isArray(targets), 'the app has no list of report targets');
  assert.ok(targets.includes('post_comment'), 'comments under posts cannot be reported');
  assert.ok(targets.includes('activity_comment'), 'comments under events cannot be reported');
  assert.equal(new Set(targets).size, targets.length, 'a target is listed twice');

  const labels = exports.REPORT_TARGET_LABELS as Record<string, { icon: string; label: string }>;
  for (const target of targets as string[]) {
    assert.ok(labels?.[target]?.label, `${target}: no label for the admin list`);
    assert.ok((UI_ICON_NAMES as readonly string[]).includes(labels[target].icon), `${target}: unknown icon`);
  }
  assert.equal(report.isCommentTarget('activity_comment'), true);
  assert.equal(report.isCommentTarget('post'), false);
});
