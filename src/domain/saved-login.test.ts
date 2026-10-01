import assert from 'node:assert/strict';
import { test } from 'node:test';

import { LEGACY_CREDENTIALS_KEY, SAVED_EMAIL_KEY, emailFromLegacy, normalizeSavedEmail } from './saved-login.ts';

const FAKE_PASSWORD = 'fake-saved-password-not-a-secret';

test('a legacy entry gives back the e-mail address and nothing else', () => {
  const raw = JSON.stringify({ email: ' someone@example.invalid ', password: FAKE_PASSWORD });
  const email = emailFromLegacy(raw);

  assert.equal(email, 'someone@example.invalid');
  assert.equal(typeof email, 'string', 'only the address, never the object with the password');
  assert.equal(String(email).includes(FAKE_PASSWORD), false);
});

test('missing, malformed or address-less legacy entries give nothing', () => {
  for (const raw of [
    null,
    undefined,
    '',
    'not json',
    '"just a string"',
    '42',
    'null',
    JSON.stringify({ password: FAKE_PASSWORD }),
    JSON.stringify({ email: 42, password: FAKE_PASSWORD }),
    JSON.stringify({ email: '   ', password: FAKE_PASSWORD }),
    JSON.stringify([{ email: 'someone@example.invalid' }]),
  ]) {
    assert.equal(emailFromLegacy(raw), null, String(raw));
  }
});

test('a saved address is trimmed, and empty or over-long values are not saved', () => {
  assert.equal(normalizeSavedEmail('  a@b.de '), 'a@b.de');
  assert.equal(normalizeSavedEmail(''), null);
  assert.equal(normalizeSavedEmail('   '), null);
  assert.equal(normalizeSavedEmail(null), null);
  assert.equal(normalizeSavedEmail({ email: 'a@b.de' }), null);
  assert.equal(normalizeSavedEmail(`${'a'.repeat(250)}@b.de`), null);
});

test('the new entry has its own key, apart from the legacy one', () => {
  assert.equal(LEGACY_CREDENTIALS_KEY, 'goenn_saved_credentials');
  assert.notEqual(SAVED_EMAIL_KEY, LEGACY_CREDENTIALS_KEY);
  // expo-secure-store accepts letters, digits, '.', '-' and '_' in keys.
  assert.match(SAVED_EMAIL_KEY, /^[A-Za-z0-9._-]+$/);
});
