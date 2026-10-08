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

test('jedes Meldeziel hat Wort und bekanntes Symbol – und jedes nur einmal', () => {
  const { REPORT_TARGETS, REPORT_TARGET_LABELS } = report;
  assert.ok(REPORT_TARGETS.length > 0);
  assert.equal(new Set(REPORT_TARGETS).size, REPORT_TARGETS.length, 'ein Ziel steht doppelt da');
  for (const target of REPORT_TARGETS) {
    assert.ok(REPORT_TARGET_LABELS[target].label, `${target}: kein Wort für die Admin-Liste`);
    assert.ok((UI_ICON_NAMES as readonly string[]).includes(REPORT_TARGET_LABELS[target].icon), `${target}: unbekanntes Symbol`);
  }
});

test('ein unbekanntes Ziel zeigt die Admin-Liste mit seinem Schlüssel und einer Fahne', () => {
  assert.deepEqual(report.reportTargetLabel('group'), { icon: 'users', label: 'Gruppe' });
  assert.deepEqual(report.reportTargetLabel('brandneu'), { icon: 'flag', label: 'brandneu' });
});
