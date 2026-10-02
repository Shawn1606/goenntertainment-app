import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  MSG_RESET_CODE,
  MSG_RESET_EMAIL,
  MSG_RESET_MISMATCH,
  MSG_RESET_PASSWORD,
  normalizeResetCode,
  RESET_CODE_LENGTH,
  RESET_RESEND_SECONDS,
  resetFormProblem,
} from './reset-code.ts';

test('a reset code is six digits; spaces are dropped', () => {
  assert.equal(RESET_CODE_LENGTH, 6);
  assert.equal(normalizeResetCode('123456'), '123456');
  assert.equal(normalizeResetCode(' 123 456 '), '123456');
  assert.equal(normalizeResetCode('012345'), '012345');
});

test('anything but six digits is not a reset code', () => {
  for (const input of ['', '12345', '1234567', '12345a', 'abcdef', '12-345', '１２３４５６', '123456\u0000']) {
    assert.equal(normalizeResetCode(input), null, JSON.stringify(input));
  }
});

test('the resend countdown mirrors the server spacing of one mail a minute', () => {
  // PasswordReset::RESEND_AFTER in api/app/Support/PasswordReset.php.
  assert.equal(RESET_RESEND_SECONDS, 60);
});

const valid = { email: 'person@example.invalid', code: '123 456', password: 'Fixture-New-Pass-8642', repeat: 'Fixture-New-Pass-8642' };

test('a complete form has no problem', () => {
  assert.equal(resetFormProblem(valid), null);
  assert.equal(resetFormProblem({ ...valid, email: '  person@example.invalid ' }), null);
});

test('the first problem is named in the order of the fields', () => {
  assert.deepEqual(resetFormProblem({ ...valid, email: 'kein-at-zeichen', code: '' }), { field: 'email', message: MSG_RESET_EMAIL });
  assert.deepEqual(resetFormProblem({ ...valid, code: '12345' }), { field: 'code', message: MSG_RESET_CODE });
  assert.deepEqual(resetFormProblem({ ...valid, password: '', repeat: '' }), { field: 'password', message: MSG_RESET_PASSWORD });
  assert.deepEqual(resetFormProblem({ ...valid, repeat: 'Fixture-New-Pass-8643' }), { field: 'repeat', message: MSG_RESET_MISMATCH });
});

test('the code message is the server text', () => {
  // The same words as PasswordController (api/app/Http/Controllers/PasswordController.php).
  assert.equal(MSG_RESET_CODE, 'Bitte gib den 6-stelligen Code aus der E-Mail ein.');
});
