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
  // Through parseResponse, or (the text download) reported directly; minus the report inside
  // parseResponse itself.
  const reported =
    (api.match(/return parseResponse<[^>]+>\(response, token\);/g) ?? []).length +
    (api.match(/sessionWatch\.report\(response\.status, token\);/g) ?? []).length -
    1;

  // Denominator: the fetch sites that send a token (request, upload, fetchText).
  assert.ok(fetchSites >= 3, `only ${fetchSites} authenticated fetch sites found`);
  assert.equal(reported, fetchSites, `${fetchSites} authenticated fetch sites, ${reported} report their answer`);
  // Every request to the API (the other fetch reads a picked image on the web, never the API).
  assert.equal((api.match(/await fetch\(`\$\{API_URL\}/g) ?? []).length, fetchSites, 'a fetch to the API that sends no token was added: check it');
  assert.match(api, /async function parseResponse<T>\(response: Response, token: string \| null \| undefined\): Promise<T> \{\s*sessionWatch\.report\(response\.status, token\);/);
});

test('the auth state signs out through one path when a session is rejected', () => {
  const context = code('lib/auth-context.tsx');
  assert.match(context, /sessionWatch\.subscribe\(/);
  assert.match(context, /endsSession\(401, rejected, tokenRef\.current\)/);
  assert.match(context, /const endLocalSession = useCallback\(/);
  // logout ends in the same place.
  assert.match(context, /logout: async \(\) => \{[\s\S]*?await endLocalSession\(false\);/);
});

test('signing out clears the session in memory before the stored token', () => {
  const context = code('lib/auth-context.tsx');
  const start = context.indexOf('const endLocalSession = useCallback(');
  const end = context.indexOf('sessionWatch.subscribe(', start);
  assert.ok(start >= 0 && end > start, 'endLocalSession not found before the 401 listener');
  const body = context.slice(start, end);

  const forget = body.indexOf('setToken(null)');
  const storage = body.indexOf('clearToken');
  assert.ok(forget >= 0 && storage > forget, 'the stored token is cleared before the session is forgotten in memory');
  // The steps run in the order signOutLocally gives them (tested in session.test.ts).
  assert.match(body, /signOutLocally\(/, 'endLocalSession does not use signOutLocally');
  assert.match(body, /forget: \(\) => \{\s*tokenRef\.current = null;\s*setToken\(null\);\s*setUser\(null\);\s*\}/);
  assert.match(body, /clearStorage: clearToken,/);

  // The 401 path never leaves a rejected promise behind.
  assert.match(context, /if \(endsSession\(401, rejected, tokenRef\.current\)\) void endLocalSession\(true\)\.catch\(/);
});

/*
 * F-44: what the session left on the device goes with it. The marketplace keeps no search history;
 * the personal data it keeps is the offline copy of the bookings and the pass (src/lib/offline-cache.ts).
 * The tested logic is the history step of signOutLocally (session.test.ts); these checks prove
 * that the app hands it the real storage on every path.
 */

test('every way the session ends removes the offline copy of bookings and pass (F-44)', () => {
  const context = code('lib/auth-context.tsx');

  // Denominator: the places in the auth state that remove the stored token (the imports aside).
  // Each one must remove the offline copy as well.
  const withoutImports = context.replace(/^import[\s\S]*?;$/gm, '');
  const tokenSites = (withoutImports.match(/\bclearToken\b/g) ?? []).length;
  assert.equal(tokenSites, 2, 'expected two token removals: the one local sign-out and the token rejected at app start');

  // 1. The one local sign-out (logout, the 401 during a session, the logout after deleting the
  //    account).
  const start = context.indexOf('const endLocalSession = useCallback(');
  const end = context.indexOf('sessionWatch.subscribe(', start);
  assert.ok(start >= 0 && end > start, 'endLocalSession not found before the 401 listener');
  const body = context.slice(start, end);
  assert.match(body, /clearHistory: \(\) => clearOfflineCache\(\),/, 'endLocalSession does not remove the offline copy');
  assert.equal((context.match(/endLocalSession\((?:true|false)\)/g) ?? []).length, 2, 'logout and the 401 listener both end in endLocalSession');
  // No other sign-out path that could skip it.
  assert.equal((withoutImports.match(/\bclearOfflineCache\(/g) ?? []).length, 2, 'expected the offline copy removed in endLocalSession and at app start only');

  // 2. A stored token rejected at app start (the account deleted or banned, or the token revoked,
  //    while the app was closed).
  assert.match(
    context,
    /if \(error instanceof ApiError && \(error\.status === 401 \|\| error\.status === 403\)\) \{\s*await clearToken\(\);\s*await clearOfflineCache\(\)/,
    'a token rejected at app start leaves the offline copy behind',
  );
});

test('the account id is stored beside the token and leaves with it (F-44)', () => {
  const context = code('lib/auth-context.tsx');
  // Every sign-in (login, two-factor, register) goes through applyAuth.
  const apply = context.slice(context.indexOf('async function applyAuth('));
  assert.match(
    apply.slice(0, apply.indexOf('\n  }')),
    /await saveToken\(result\.token\);\s*await saveSessionUserId\(result\.user\.id\);/,
    'a sign-in does not store the account id beside the token',
  );
  assert.equal((context.match(/await applyAuth\(result\)/g) ?? []).length, 3, 'login, two-factor and register sign in through applyAuth');
  // A session from before this version has no stored id: the app start stores it once the token is accepted.
  assert.match(
    context,
    /const \{ user: me \} = await api\.me\(stored\);\s*await saveSessionUserId\(me\.id\);/,
    'the app start does not store the account id of an accepted session',
  );

  const store = code('lib/token-store.ts');
  assert.match(store, /const USER_KEY = 'goenn_session_user_id';/);
  // Removing the token removes the id as well (also when removing the token fails).
  const clear = store.slice(store.indexOf('export async function clearToken('));
  assert.match(clear.slice(0, clear.indexOf('\n}')), /\} finally \{\s*await forgetSessionUserId\(\);\s*\}/, 'clearToken leaves the account id behind');
  const forget = store.slice(store.indexOf('async function forgetSessionUserId('));
  const body = forget.slice(0, forget.indexOf('\n}'));
  assert.match(body, /globalThis\.localStorage\?\.removeItem\(USER_KEY\)/);
  assert.match(body, /await SecureStore\.deleteItemAsync\(USER_KEY\)/);
  // Written and read through the tested rules (session.test.ts).
  assert.match(store, /serializeSessionUserId\(userId\)/);
  assert.match(store, /return parseSessionUserId\(raw\);/);
});

test('deleting the account removes the offline copy before the closing dialog (F-44)', () => {
  // The dialog waits for a tap; an app closed there never reached the sign-out after it.
  const screen = code('app/security/delete-account.tsx');
  const deletion = screen.indexOf('await api.deleteAccount(');
  assert.ok(deletion >= 0, 'delete-account.tsx no longer deletes through api.deleteAccount');
  const offline = screen.indexOf('await clearOfflineCache()', deletion);
  const dialog = screen.indexOf('await notifyUser(', deletion);
  assert.ok(offline > deletion, 'deleting the account does not remove the offline copy right away');
  assert.ok(dialog > offline, 'the offline copy is removed only after the dialog');
  assert.match(screen, /import \{ clearOfflineCache \} from '@\/lib\/offline-cache';/);
  // Both stored parts go, on the phone and on the web (src/lib/offline-cache.ts).
  const cache = code('lib/offline-cache.ts');
  assert.match(cache, /export async function clearOfflineCache\(\): Promise<void> \{\s*await Promise\.all\(\[setRaw\(BOOKINGS_KEY, null\), setRaw\(PASS_KEY, null\)\]\);/);
});

test('deleting the account ends in the same sign-out (F-44)', () => {
  const screen = code('app/security/delete-account.tsx');
  const deletion = screen.indexOf('await api.deleteAccount(');
  assert.ok(deletion >= 0, 'delete-account.tsx no longer deletes through api.deleteAccount');
  assert.ok(screen.indexOf('await logout();', deletion) > deletion, 'deleting the account does not sign out through logout()');
  const context = code('lib/auth-context.tsx');
  assert.match(context, /logout: async \(\) => \{[\s\S]*?await endLocalSession\(false\);/);
});
