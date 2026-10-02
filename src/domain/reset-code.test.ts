import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
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

/**
 * Named mirrors of the server (api/): the countdown and the code message are written in the app
 * and in Laravel. Read from the PHP source, so a change on one side fails here.
 */
const API = path.resolve(import.meta.dirname, '..', '..', 'api');
const php = (file: string) => readFileSync(path.join(API, file), 'utf8');

function phpConstant(file: string, name: string): string {
  const match = new RegExp(`\\bconst ${name} = ([^;]+);`).exec(php(file));
  assert.ok(match, `${name} not found in api/${file}`);
  return match[1].trim();
}

test('the resend countdown mirrors the server spacing of one mail a minute', () => {
  // PasswordReset::RESEND_AFTER is TwoFactor's spacing, like every other code mail.
  assert.equal(phpConstant('app/Support/PasswordReset.php', 'RESEND_AFTER'), 'TwoFactor::RESEND_AFTER');
  assert.equal(String(RESET_RESEND_SECONDS), phpConstant('app/Support/TwoFactor.php', 'RESEND_AFTER'));
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
  // PasswordController answers a malformed code with the same words (MSG_CODE_SHAPE).
  assert.equal(`'${MSG_RESET_CODE}'`, phpConstant('app/Http/Controllers/PasswordController.php', 'MSG_CODE_SHAPE'));
  assert.equal(MSG_RESET_CODE, 'Bitte gib den 6-stelligen Code aus der E-Mail ein.');
});
