import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ERROR_REACTION } from './mascot-mood.ts';

test('der Fehlerfall sagt „Oh oh" und erklärt es in einem Satz', () => {
  assert.equal(ERROR_REACTION.headline, 'Oh oh');
  assert.equal(ERROR_REACTION.line, 'Es ist ein Fehler aufgetreten.');
  assert.equal(ERROR_REACTION.mood, 'oops');
});
