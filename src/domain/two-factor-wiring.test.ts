import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

/**
 * Static checks of the two-factor screen and its API calls (F-19): switching on sends the
 * password; switching off and new recovery codes send the password AND a code. The server
 * enforces both (api/tests/Feature/TwoFactorHardeningTest.php); these checks keep the app in
 * step with it. They read the source and cannot show the rendered screen.
 */
const SRC = path.resolve(import.meta.dirname, '..');
const read = (file: string) => readFileSync(path.join(SRC, file), 'utf8');

test('switching on sends the password', () => {
  const api = read('lib/api.ts');
  assert.match(api, /twoFactorEmailStart: \(token: string, password: string\)/);
  assert.match(api, /twoFactorTotpStart: \(token: string, password: string\)/);
  assert.equal((api.match(/body: \{ password \}/g) ?? []).length, 2);
});

test('switching off and new recovery codes send the password and a code', () => {
  assert.match(read('lib/api.ts'), /export type SecondFactorProof = \{ password: string; code: string \};/);

  const screen = read('app/security/two-factor.tsx');
  assert.doesNotMatch(screen, /Passwort oder aktueller Code/, 'the screen still offers one field for either proof');
  assert.match(screen, /return \{ password, code: proofCode\.trim\(\) \};/);
  assert.match(screen, /api\.twoFactorEmailStart\(token, password\)/);
  assert.match(screen, /api\.twoFactorTotpStart\(token, password\)/);
});

/** The props of the one `<TextField label="Aktueller Code" ... />` in a screen. */
function currentCodeField(file: string): string {
  const screen = read(file);
  const label = screen.indexOf('label="Aktueller Code"');
  assert.ok(label >= 0, `${file} has no "Aktueller Code" field`);
  assert.equal(screen.indexOf('label="Aktueller Code"', label + 1), -1, `${file} has more than one "Aktueller Code" field`);
  const start = screen.lastIndexOf('<TextField', label);
  // The field ends at its own closing `/>` on a line of its own (`leftIcon={<LockIcon />}` is inside).
  const end = screen.slice(label).search(/\n\s*\/>/);
  assert.ok(start >= 0 && end > 0, `${file}: the "Aktueller Code" field cannot be read`);
  return screen.slice(start, label + end);
}

test('the step-up code fields accept a recovery code as typed', () => {
  // The server takes a recovery code (xxxx-xxxx, letters and digits) wherever it takes a current
  // code (api/app/Support/TwoFactor.php, assertCode). A number pad cannot type one, and
  // autocorrect or capitalisation would change it.
  const screens = ['app/security/email.tsx', 'app/security/two-factor.tsx'];
  for (const file of screens) {
    const field = currentCodeField(file);
    assert.doesNotMatch(field, /keyboardType=/, `${file}: the code field limits the keyboard`);
    assert.match(field, /autoCapitalize="none"/, `${file}: the code field capitalises`);
    assert.match(field, /autoCorrect=\{false\}/, `${file}: the code field autocorrects`);
    assert.match(field, /spellCheck=\{false\}/, `${file}: the code field spell-checks`);
    assert.match(field, /maxLength=\{9\}/, `${file}: the code field cannot hold xxxx-xxxx`);
  }
  assert.equal(screens.length, 2);
});
