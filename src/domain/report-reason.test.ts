import test from 'node:test';
import assert from 'node:assert/strict';

import { REPORT_REASONS, isUrgent, reportReasonLabel } from './report-reason.ts';
import { UI_ICON_NAMES } from './ui-icon.ts';

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
