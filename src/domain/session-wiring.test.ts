import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

/**
 * Static checks of the session wiring (F-20). The pure logic is tested in session.test.ts and
 * saved-login.test.ts; these checks prove that the app uses it: no password is stored, the app
 * start removes a stored one, every authenticated request reports its status, and the auth state
 * signs out on a rejected session. They read the source, so they cannot show the rendered
 * behaviour; that part is a manual check (sign in on the web build, expire the token in the
 * database, tap anything: the sign-in screen with the notice, the address still filled in).
 */
const SRC = path.resolve(import.meta.dirname, '..');
const read = (file: string) => readFileSync(path.join(SRC, file), 'utf8');

/** The code without comments, so a comment that explains the old behaviour cannot match. */
function code(file: string): string {
  return read(file)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

test('the credential store keeps no password', () => {
  const store = code('lib/credential-store.ts');
  assert.doesNotMatch(store, /password/i, 'src/lib/credential-store.ts mentions a password in code');
  assert.match(store, /export async function saveEmail\(/);
  assert.match(store, /export async function migrateSavedLogin\(/);
});

test('the app start deletes the legacy entry on both platforms', () => {
  const store = code('lib/credential-store.ts');
  // The tested logic (saved-login.test.ts) gets the real storage, deleteKey included.
  const wrapper = store.slice(store.indexOf('export async function migrateSavedLogin('));
  assert.match(
    wrapper.slice(0, wrapper.indexOf('\n}')),
    /await migrateLegacyEntry\(\{ get: readKey, set: writeKey, remove: deleteKey \}\);/,
    'migrateSavedLogin() does not hand the device storage to migrateLegacyEntry',
  );
  // deleteKey removes the entry on the web (localStorage) and on phones (SecureStore).
  const deleteKey = store.slice(store.indexOf('async function deleteKey('));
  const body = deleteKey.slice(0, deleteKey.indexOf('\n}'));
  assert.match(body, /if \(Platform\.OS === 'web'\) \{\s*globalThis\.localStorage\?\.removeItem\(key\);\s*return;\s*\}/);
  assert.match(body, /await SecureStore\.deleteItemAsync\(key\);/);
});

test('no screen saves a password on the device', () => {
  for (const file of ['components/login-panel.tsx', 'app/security/password.tsx', 'app/settings.tsx']) {
    const text = code(file);
    assert.doesNotMatch(text, /saveCredentials|loadCredentials/, `${file} still uses the old credential store`);
    assert.doesNotMatch(text, /save\w*\(\s*\{[^}]*password/, `${file} saves an object with a password`);
  }
});

test('the app start removes a stored password before anything else', () => {
  const context = code('lib/auth-context.tsx');
  const migrate = context.indexOf('await migrateSavedLogin()');
  const loadToken = context.indexOf('await loadToken()');
  assert.ok(migrate >= 0, 'auth-context.tsx does not call migrateSavedLogin()');
  assert.ok(migrate < loadToken, 'migrateSavedLogin() must run before the stored token is read');
});

test('every authenticated request reports its answer', () => {
  const api = code('lib/api.ts');
  const fetchSites = (api.match(/Authorization: `Bearer \$\{token\}`/g) ?? []).length;
  const reported = (api.match(/return parseResponse<[^>]+>\(response, token\);/g) ?? []).length;

  // Denominator: the fetch sites that send a token (request, upload, moderationUpload, createActivity).
  assert.ok(fetchSites >= 4, `only ${fetchSites} authenticated fetch sites found`);
  assert.equal(reported, fetchSites, `${fetchSites} authenticated fetch sites, ${reported} report their answer`);
  assert.equal((api.match(/await fetch\(/g) ?? []).length, fetchSites, 'a fetch site that sends no token was added: check it');
  assert.match(api, /sessionWatch\.report\(response\.status, token\)/);
});

test('the auth state signs out through one path when a session is rejected', () => {
  const context = code('lib/auth-context.tsx');
  assert.match(context, /sessionWatch\.subscribe\(/);
  assert.match(context, /endsSession\(401, rejected, tokenRef\.current\)/);
  assert.match(context, /const endLocalSession = useCallback\(/);
  // logout ends in the same place.
  assert.match(context, /logout: async \(\) => \{[\s\S]*?await endLocalSession\(false\);/);
});
