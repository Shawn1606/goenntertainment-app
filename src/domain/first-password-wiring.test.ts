import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

/**
 * Static checks of the password screen for an account without a password (F-04): it sets its first
 * password with a one-time code mailed to the account's own address, not with the session alone.
 * The server side is api/tests/Feature/FirstPasswordTest.php. These checks read the source; they
 * cannot show the rendered screen.
 */
const SRC = path.resolve(import.meta.dirname, '..');
const read = (file: string) => readFileSync(path.join(SRC, file), 'utf8');

test('the API asks for the code and sends it with the first password', () => {
  const api = read('lib/api.ts');
  assert.match(
    api,
    /requestFirstPasswordCode: \(token: string\) =>\s*request<\{ message: string; destination: string; expires_in: number \}>\('\/user\/password\/code', \{\s*method: 'POST',/,
  );
  assert.match(
    api,
    /setFirstPassword: \(token: string, code: string, password: string\) =>\s*request<\{ message: string \}>\('\/user\/password', \{\s*method: 'PUT',\s*body: \{ code, password \},/,
  );
});

test('the password screen offers the code way and sends the code, not a password it does not have', () => {
  const screen = read('app/security/password.tsx');
  assert.match(screen, /api\.requestFirstPasswordCode\(token\)/);
  assert.match(screen, /api\.setFirstPassword\(token, normalizeResetCode\(code\) \?\? '', next\)/);
  assert.match(screen, /label="Code aus der E-Mail"/);
  assert.match(screen, /Noch kein Passwort\? \(Anmeldung mit Google\)/);
  // The code way needs a well-formed code; the usual way the current password.
  assert.match(screen, /const proven = firstPassword \? normalizeResetCode\(code\) !== null : current\.length > 0;/);
  assert.match(screen, /const canSave = proven && /);
});

test('the screen takes the code way when the server asks for a code', () => {
  // The app does not know whether an account has a password; the server's answer tells it.
  const screen = read('app/security/password.tsx');
  assert.match(screen, /if \(!firstPassword && e\.errors\.code\) setFirstPassword\(true\);/);
});
