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
