import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

/**
 * Static checks of the password reset screens (F-09): "Passwort vergessen" mails a one-time code
 * and leads to a screen that takes the code and the new password. No reset link, no deep link,
 * and the e-mail address never travels in a route parameter (on the web it would be in the URL).
 * The server side is api/tests/Feature/PasswordResetCodeTest.php. These checks read the source;
 * they cannot show the rendered screens.
 */
const SRC = path.resolve(import.meta.dirname, '..');
const FORGOT = 'app/(auth)/forgot-password.tsx';
const RESET = 'app/(auth)/reset-password.tsx';
const read = (file: string) => readFileSync(path.join(SRC, file), 'utf8');

function readReset(): string {
  assert.ok(existsSync(path.join(SRC, RESET)), `${RESET} does not exist`);
  return read(RESET);
}

test('the forgot-password screen promises a code, not a link', () => {
  const screen = read(FORGOT);
  assert.doesNotMatch(screen, /\bLink\b/, `${FORGOT} still talks of a link`);
  assert.match(screen, /einen Code zum Zurücksetzen/);
  assert.match(screen, /title="Code senden"/);
});

test('the forgot-password screen opens the reset screen, the address in memory only', () => {
  const screen = read(FORGOT);
  assert.match(screen, /await api\.forgotPassword\(email\.trim\(\)\);\s*rememberResetEmail\(email, true\);\s*router\.push\('\/reset-password'\);/);
  assert.doesNotMatch(screen, /params|\?email=|reset-password\?/, `${FORGOT} passes something in the route`);
});

test('the reset screen is a signed-out screen of the auth stack', () => {
  readReset();
  const layout = read('app/_layout.tsx');
  const start = layout.indexOf('<Stack.Protected guard={!token}>');
  assert.ok(start >= 0, 'the signed-out guard is not in _layout.tsx');
  const block = layout.slice(start, layout.indexOf('</Stack.Protected>', start));
  assert.match(block, /<Stack\.Screen name="\(auth\)" \/>/);
  // The auth stack registers its screens by file (app/(auth)/_layout.tsx lists none by name).
  assert.doesNotMatch(read('app/(auth)/_layout.tsx'), /Stack\.Screen/);
});

test('the reset screen sends address, code and new password, and reads no route parameter', () => {
  const screen = readReset();
  assert.match(screen, /api\.resetPassword\(\{\s*email: email\.trim\(\),\s*code: normalizeResetCode\(code\) \?\? '',\s*password,\s*password_confirmation: repeat,\s*\}\)/);
  assert.match(screen, /useState\(\(\) => peekResetEmail\(\)\)/);
  assert.match(screen, /resetFormProblem\(/);
  assert.match(screen, /from '@\/domain\/email'/);
  assert.match(screen, /isEmailAddress\(/);
  assert.doesNotMatch(screen, /useLocalSearchParams|useGlobalSearchParams|Linking/, `${RESET} reads a route parameter or a link`);
  // A new code is a new "forgot password" request (the server spaces them a minute apart).
  assert.match(screen, /api\.forgotPassword\(email\.trim\(\)\)/);
});

test('the API call posts the code flow to /reset-password, signed out', () => {
  const api = read('lib/api.ts');
  const start = api.indexOf('resetPassword:');
  assert.ok(start >= 0, 'api.resetPassword is missing');
  const call = api.slice(start, api.indexOf('}),', start));
  assert.match(call, /input: \{ email: string; code: string; password: string; password_confirmation: string \}/);
  assert.match(call, /'\/reset-password', \{\s*method: 'POST',\s*body: input,/);
  assert.doesNotMatch(call, /token/, 'the reset call carries a token');
});

test('no screen reads a reset token from a link', () => {
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return files(full);
      return /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.test.ts') ? [full] : [];
    });
  const scanned = files(path.join(SRC, 'app'));
  const offenders = scanned
    .filter((file) => /reset/i.test(readFileSync(file, 'utf8')) && /SearchParams[\s\S]{0,200}\btoken\b/.test(readFileSync(file, 'utf8')))
    .map((file) => path.relative(SRC, file));
  assert.ok(scanned.length > 30, `only ${scanned.length} screens scanned`);
  assert.deepEqual(offenders, [], `${scanned.length} screens scanned`);
});
