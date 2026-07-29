import assert from 'node:assert/strict';
import { test } from 'node:test';

import { STORY_HOURS, remainingLabel } from './story.ts';

test('eine Story läuft nach 24 Stunden ab', () => {
  assert.equal(STORY_HOURS, 24);
});

test('unter einer Stunde zählt in Minuten', () => {
  assert.equal(remainingLabel(1), 'noch 1 Min.');
  assert.equal(remainingLabel(45), 'noch 45 Min.');
  assert.equal(remainingLabel(59), 'noch 59 Min.');
});

test('ab einer Stunde in Stunden – Singular korrekt', () => {
  assert.equal(remainingLabel(60), 'noch 1 Stunde');
  assert.equal(remainingLabel(119), 'noch 1 Stunde');
  assert.equal(remainingLabel(120), 'noch 2 Stunden');
  assert.equal(remainingLabel(23 * 60), 'noch 23 Stunden');
});

test('abgelaufen oder unbekannt heißt: gar keine Angabe', () => {
  // „noch 0 Min." wäre die Sorte Angabe, die eine Anzeige unglaubwürdig macht.
  assert.equal(remainingLabel(0), null);
  assert.equal(remainingLabel(-30), null);
  assert.equal(remainingLabel(null), null);
  assert.equal(remainingLabel(undefined), null);
});

test('Unsinn wirft nicht, sondern schweigt', () => {
  // Der Wert kommt vom Server – ein kaputtes Feld darf keinen Absturz auslösen.
  assert.equal(remainingLabel(Number.NaN), null);
  assert.equal(remainingLabel('viel' as unknown as number), null);
  assert.equal(remainingLabel(90.7), 'noch 1 Stunde');
});
