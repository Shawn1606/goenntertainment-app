/**
 * Integrationstest: Zwei-Faktor-Sperre der Node-Anmeldung, Passwortregel und
 * das Loeschen des eigenen Kontos (DELETE /api/me) – gegen die echte Datenbank.
 *
 * Gleiches Muster wie api.test.js: App auf freiem Port, Wegwerf-Konten, am Ende
 * alles wieder weg. Die Zwei-Faktor-Spalten werden direkt in der DB gesetzt –
 * das Einschalten selbst gehoert Laravel und wird dort geprueft.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { createApp } from '../src/app.js';
import { ensureSchema, pool, first } from '../src/db.js';
import { hashPassword } from '../src/auth.js';
import { MSG_PASSWORD_COMMON, MSG_PASSWORD_PERSONAL } from '../src/password-policy.js';
import { TEST_PASSWORD as PASSWORD, deleteTestUsers, uniqueStamp as stamp } from './support/fixtures.js';

let base;
let server;
const createdUserIds = [];
const createdFiles = [];

/** 1x1-PNG, reicht fuer jeden Upload. */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==',
  'base64',
);

async function tryRegister(prefix, overrides = {}) {
  const s = stamp();
  const payload = {
    name: `${prefix} Test`,
    username: `${prefix}${s}`.slice(0, 28),
    email: `${prefix}${s}@example.invalid`,
    password: PASSWORD,
    account_type: 'standard',
    device_name: 'test',
    ...overrides,
  };
  const res = await fetch(`${base}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null);
  if (body?.user?.id) createdUserIds.push(body.user.id);
  return { status: res.status, body, payload };
}

/** Wegwerf-Konto; die Stufe kommt direkt in die DB (wie in api.test.js). */
async function registerUser(prefix, accountType = 'creator') {
  const { status, body } = await tryRegister(prefix);
  assert.equal(status, 201, 'Registrierung muss klappen');
  if (accountType !== 'standard') {
    await pool.query('UPDATE users SET account_type = ? WHERE id = ?', [accountType, body.user.id]);
  }
  return body;
}

const login = (email, password) =>
  fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, device_name: 'test' }),
  });

const get = (p, token) => fetch(`${base}${p}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

const deleteMe = (token, body = {}, headers = {}) =>
  fetch(`${base}/api/me`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...headers },
    body: JSON.stringify(body),
  });

const setTwoFactor = (userId, method) =>
  pool.query('UPDATE users SET two_factor_method = ? WHERE id = ?', [method, userId]);

/** Freigabe wie von Laravel (TwoFactor::createDeletionGrant): Zeile mit sha256 des Tokens. */
async function insertGrant(userId, { expired = false } = {}) {
  const token = crypto.randomBytes(32).toString('hex');
  await pool.query(
    `INSERT INTO two_factor_challenges (user_id, token_hash, method, purpose, attempts, expires_at, created_at)
     VALUES (?, ?, 'totp', 'delete', 0, NOW() + INTERVAL ? SECOND, NOW())`,
    [userId, crypto.createHash('sha256').update(token).digest('hex'), expired ? -1 : 120],
  );
  return token;
}

const storagePath = (relative) => path.join(process.cwd(), 'storage', relative);

/** Aus einer Bild-Adresse den Pfad unter storage/ machen. */
const relativeFromUrl = (url) => url.slice(url.indexOf('/storage/') + '/storage/'.length);

/** Legt eine Datei unter storage/<ordner>/ an und merkt sie zum Aufraeumen. */
function writeStorageFile(folder) {
  fs.mkdirSync(storagePath(folder), { recursive: true });
  const relative = `${folder}/zfa-test-${crypto.randomBytes(8).toString('hex')}.png`;
  fs.writeFileSync(storagePath(relative), PNG_1X1);
  createdFiles.push(relative);
  return relative;
}

async function uploadAvatar(token) {
  const form = new FormData();
  form.append('image', new Blob([PNG_1X1], { type: 'image/png' }), 'bild.png');
  const res = await fetch(`${base}/api/me/avatar`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  assert.equal(res.status, 200);
  const relative = relativeFromUrl((await res.json()).user.avatar);
  createdFiles.push(relative);
  return relative;
}

/**
 * Google-Anmeldung ohne Google: `fetch` auf googleapis.com liefert das
 * uebergebene Profil. Alles andere (die Aufrufe dieses Tests an die App) geht
 * unveraendert raus.
 */
async function withGoogleStub(profile, fn) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('https://www.googleapis.com/')) {
      return new Response(JSON.stringify(profile), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return realFetch(url, init);
  };
  try {
    return await fn();
  } finally {
    globalThis.fetch = realFetch;
  }
}

before(async () => {
  await ensureSchema();
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  // The pool and the server are closed even when the cleanup throws; otherwise their open
  // handles keep this test process alive and `npm test` never exits.
  try {
    await deleteTestUsers(pool, createdUserIds);
    for (const file of createdFiles) {
      try {
        fs.unlinkSync(storagePath(file));
      } catch {
        /* schon weg – genau das pruefen die Tests */
      }
    }
  } finally {
    await pool.end();
    server?.close();
  }
});

/* ------------------------------------------------ Zwei-Faktor-Sperre (Node) */

test('POST /api/login: bei aktiver 2FA gibt Node keinen Token heraus', async () => {
  const { user } = await registerUser('zfalogin', 'standard');
  await setTwoFactor(user.id, 'totp');

  const res = await login(user.email, PASSWORD);
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.message, 'Bitte melde dich über die App an.');
  assert.equal(body.token, undefined);
  assert.equal(body.user, undefined);
});

test('POST /api/login: ein falsches Passwort verraet nicht, ob 2FA an ist', async () => {
  const { user } = await registerUser('zfaloginwrong', 'standard');
  await setTwoFactor(user.id, 'email');

  const res = await login(user.email, 'falsch12345');
  assert.equal(res.status, 422);
});

test('POST /api/login: ohne 2FA wie bisher mit Token', async () => {
  const { user } = await registerUser('zfaloginplain', 'standard');
  const res = await login(user.email, PASSWORD);
  assert.equal(res.status, 200);
  assert.ok((await res.json()).token);
});

test('POST /api/auth/google: bei aktiver 2FA gibt Node keinen Token heraus', async () => {
  const { user } = await registerUser('zfagoogle', 'standard');
  await setTwoFactor(user.id, 'email');

  const res = await withGoogleStub({ sub: `zfa-sub-${stamp()}`, email: user.email, name: 'G' }, () =>
    fetch(`${base}/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_token: 'egal' }),
    }),
  );
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.message, 'Bitte melde dich über die App an.');
  assert.equal(body.token, undefined);
});

test('POST /api/auth/google: ohne 2FA weiterhin mit Token', async () => {
  const { user } = await registerUser('zfagoogleok', 'standard');
  const res = await withGoogleStub({ sub: `zfa-sub-${stamp()}`, email: user.email, name: 'G' }, () =>
    fetch(`${base}/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_token: 'egal' }),
    }),
  );
  assert.equal(res.status, 200);
  assert.ok((await res.json()).token);
});

test('GET /api/user: von der 2FA geht nur die Methode raus, nie Secret oder Codes', async () => {
  const { token, user } = await registerUser('zfaleak', 'standard');
  await pool.query(
    `UPDATE users SET two_factor_method = 'totp', two_factor_secret = 'verschluesselt',
            two_factor_recovery_codes = 'codes', two_factor_confirmed_at = NOW(), two_factor_last_step = 1
      WHERE id = ?`,
    [user.id],
  );

  const body = await (await get('/api/user', token)).json();
  assert.equal(body.user.two_factor_method, 'totp');
  for (const key of [
    'two_factor_secret',
    'two_factor_recovery_codes',
    'two_factor_confirmed_at',
    'two_factor_last_step',
    'password',
  ]) {
    assert.equal(key in body.user, false, `${key} darf nicht in der Antwort stehen`);
  }
});

/* ------------------------------------------------------------ Passwortregel */

test('POST /api/register: haeufige Passwoerter werden abgelehnt – ohne Ruecksicht auf Gross/klein', async () => {
  for (const password of ['Passwort1', 'schalke04', 'QWERTZ123']) {
    const { status, body } = await tryRegister('zfapwcommon', { password });
    assert.equal(status, 422, password);
    assert.equal(body.message, MSG_PASSWORD_COMMON);
    assert.deepEqual(body.errors.password, [MSG_PASSWORD_COMMON]);
  }
});

test('POST /api/register: Benutzername oder E-Mail-Teil im Passwort wird abgelehnt', async () => {
  const s = stamp();
  const username = `zfaname${s}`.slice(0, 20);

  const byName = await tryRegister('zfapwname', { username, password: `${username.toUpperCase()}9` });
  assert.equal(byName.status, 422);
  assert.equal(byName.body.message, MSG_PASSWORD_PERSONAL);

  const byMail = await tryRegister('zfapwmail', { email: `mailteil${s}@example.invalid`, password: `x${'mailteil'}${s}` });
  assert.equal(byMail.status, 422);
  assert.equal(byMail.body.message, MSG_PASSWORD_PERSONAL);
});

test('POST /api/register: die alte Grundregel und ihre Meldung gelten unveraendert', async () => {
  const { status, body } = await tryRegister('zfapwbasic', { password: 'nurbuchstaben' });
  assert.equal(status, 422);
  assert.equal(body.message, 'Das Passwort muss mindestens 8 Zeichen mit Buchstaben und Zahlen haben.');
});

test('POST /api/reset-password: dieselbe Regel – der Benutzername erst mit gueltigem Token', async () => {
  const common = await fetch(`${base}/api/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: 'x', email: 'niemand@example.invalid', password: 'hallo123' }),
  });
  assert.equal(common.status, 422);
  assert.equal((await common.json()).message, MSG_PASSWORD_COMMON);

  const { user } = await registerUser('zfareset', 'standard');
  // Die Wegwerf-Adresse traegt sonst den Benutzernamen als lokalen Teil – dann
  // schluege schon die (oeffentliche) E-Mail-Pruefung an, und der Test pruefte
  // nicht mehr, dass der Name erst NACH dem Token kommt.
  user.email = `zfaresetpost${stamp()}@example.invalid`;
  await pool.query('UPDATE users SET email = ? WHERE id = ?', [user.email, user.id]);
  const password = `${user.username}77`;

  // Falscher Token: neutrale Meldung – kein Hinweis auf den Benutzernamen.
  const wrongToken = await fetch(`${base}/api/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: 'falsch', email: user.email, password }),
  });
  assert.equal(wrongToken.status, 422);
  assert.equal((await wrongToken.json()).message, 'Dieser Link zum Zuruecksetzen ist ungueltig.');

  await pool.query(
    'INSERT INTO password_reset_tokens (email, token, created_at) VALUES (?, ?, NOW())',
    [user.email, await hashPassword('richtig')],
  );
  const rightToken = await fetch(`${base}/api/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: 'richtig', email: user.email, password }),
  });
  assert.equal(rightToken.status, 422);
  assert.equal((await rightToken.json()).message, MSG_PASSWORD_PERSONAL);
  await pool.query('DELETE FROM password_reset_tokens WHERE email = ?', [user.email]);
});

/* ------------------------------------------------------- DELETE /api/me */

test('DELETE /api/me: ohne oder mit falschem Passwort bleibt das Konto', async () => {
  const { token, user } = await registerUser('zfadelpw', 'standard');

  const none = await deleteMe(token, {});
  assert.equal(none.status, 422);
  assert.equal((await none.json()).message, 'Bitte gib dein Passwort ein.');

  const wrong = await deleteMe(token, { password: 'falsch12345' });
  assert.equal(wrong.status, 422);
  assert.deepEqual((await wrong.json()).errors.password, ['Das Passwort stimmt nicht.']);

  assert.ok(await first('SELECT id FROM users WHERE id = ?', [user.id]));
});

test('DELETE /api/me: loescht Konto, Tokens und alle eigenen Dateien', async () => {
  const host = await registerUser('zfadelall', 'creator');
  const guest = await registerUser('zfadelguest', 'creator');

  const avatar = await uploadAvatar(host.token);

  // Event mit Banner ueber die API; der Gast tritt bei und hat es im Verlauf.
  const form = new FormData();
  form.append('title', 'Loeschtest');
  form.append('description', 'Testbeschreibung');
  form.append('location', 'Teststrasse 1, 50667 Koeln');
  form.append('starts_at', new Date(Date.now() + 86400000).toISOString());
  form.append('banner', new Blob([PNG_1X1], { type: 'image/png' }), 'banner.png');
  const created = await fetch(`${base}/api/activities`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${host.token}` },
    body: form,
  });
  assert.equal(created.status, 201);
  const activity = (await created.json()).data;
  const banner = relativeFromUrl(activity.banner_url);
  createdFiles.push(banner);
  await fetch(`${base}/api/activities/${activity.id}/join`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${guest.token}` },
  });

  // Beitrag und Story direkt (der API-Weg braucht die KI-Pruefung).
  const postImage = writeStorageFile('posts');
  await pool.query('INSERT INTO posts (user_id, body, image_path, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())', [
    host.user.id,
    'mit Bild',
    postImage,
  ]);
  const storyImage = writeStorageFile('stories');
  await pool.query(
    'INSERT INTO stories (user_id, caption, image_path, created_at, expires_at) VALUES (?, ?, ?, NOW(), NOW() + INTERVAL 1 DAY)',
    [host.user.id, 'weg damit', storyImage],
  );

  for (const file of [avatar, banner, postImage, storyImage]) {
    assert.ok(fs.existsSync(storagePath(file)), `${file} muss vorher da sein`);
  }

  const res = await deleteMe(host.token, { password: PASSWORD });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).message, 'Dein Konto wurde gelöscht.');

  assert.equal(await first('SELECT id FROM users WHERE id = ?', [host.user.id]), null);
  assert.equal(await first('SELECT id FROM personal_access_tokens WHERE tokenable_id = ?', [host.user.id]), null);
  assert.equal((await get('/api/user', host.token)).status, 401);

  for (const file of [avatar, banner, postImage, storyImage]) {
    assert.equal(fs.existsSync(storagePath(file)), false, `${file} muss weg sein`);
  }

  // Der Verlauf des Gastes behaelt den Eintrag (Frist laeuft), aber ohne Bild.
  const history = await first('SELECT banner_path, removed_at FROM activity_history WHERE user_id = ? AND title = ?', [
    guest.user.id,
    'Loeschtest',
  ]);
  assert.ok(history, 'der Gast behaelt seinen Verlaufs-Eintrag');
  assert.equal(history.banner_path, null);
  assert.notEqual(history.removed_at, null);
  assert.equal((await get('/api/user', guest.token)).status, 200);
});

test('DELETE /api/me: Konto ohne Passwort bestaetigt mit LÖSCHEN', async () => {
  const { token, user } = await registerUser('zfadelgoogle', 'standard');
  await pool.query('UPDATE users SET password = NULL WHERE id = ?', [user.id]);

  const missing = await deleteMe(token, {});
  assert.equal(missing.status, 422);
  assert.ok((await missing.json()).errors.confirm);

  const wrong = await deleteMe(token, { confirm: 'ja' });
  assert.equal(wrong.status, 422);

  const ok = await deleteMe(token, { confirm: ' löschen ' });
  assert.equal(ok.status, 200);
  assert.equal(await first('SELECT id FROM users WHERE id = ?', [user.id]), null);
});

test('DELETE /api/me: bei aktiver 2FA nur mit Freigabe von Laravel', async () => {
  const { token, user } = await registerUser('zfadel2fa', 'standard');
  const other = await registerUser('zfadel2faother', 'standard');
  await setTwoFactor(user.id, 'totp');

  // Direkt an Node, auch mit richtigem Passwort: nein.
  const direct = await deleteMe(token, { password: PASSWORD });
  assert.equal(direct.status, 403);
  assert.equal((await direct.json()).message, 'Bitte lösche dein Konto über die App.');

  // Erfundene, abgelaufene und fremde Freigaben: nein.
  const forged = await deleteMe(token, {}, { 'X-Account-Deletion-Grant': 'erfunden' });
  assert.equal(forged.status, 403);
  const expired = await deleteMe(token, {}, { 'X-Account-Deletion-Grant': await insertGrant(user.id, { expired: true }) });
  assert.equal(expired.status, 403);
  const foreign = await deleteMe(token, {}, { 'X-Account-Deletion-Grant': await insertGrant(other.user.id) });
  assert.equal(foreign.status, 403);
  assert.ok(await first('SELECT id FROM users WHERE id = ?', [user.id]));

  // Echte Freigabe: geloescht – und die Freigabe ist verbraucht.
  const grant = await insertGrant(user.id);
  const ok = await deleteMe(token, {}, { 'X-Account-Deletion-Grant': grant });
  assert.equal(ok.status, 200);
  assert.equal(await first('SELECT id FROM users WHERE id = ?', [user.id]), null);
  assert.equal(
    await first('SELECT id FROM two_factor_challenges WHERE token_hash = ?', [
      crypto.createHash('sha256').update(grant).digest('hex'),
    ]),
    null,
  );
});

test('DELETE /api/me: ein Admin, der nicht der letzte ist, darf gehen', async () => {
  const { token, user } = await registerUser('zfadeladmin', 'standard');
  // The second admin this test relies on is created here, so the result no longer depends on
  // what other test files (or earlier runs) left in the database.
  const other = await registerUser('zfadeladmintwo', 'standard');
  await pool.query('UPDATE users SET is_admin = 1 WHERE id IN (?, ?)', [user.id, other.user.id]);
  // Es gibt ausser diesem Wegwerf-Admin mindestens einen echten – sonst waere das hier 409.
  const [[{ c }]] = await pool.query('SELECT COUNT(*) AS c FROM users WHERE is_admin = 1 AND id <> ?', [user.id]);
  assert.ok(Number(c) > 0, 'Test setzt einen weiteren Admin voraus');

  const res = await deleteMe(token, { password: PASSWORD });
  assert.equal(res.status, 200);
});

test('DELETE /api/admin/users/:id raeumt jetzt auch die Dateien weg', async () => {
  const admin = await registerUser('zfaadmdel', 'standard');
  await pool.query('UPDATE users SET is_admin = 1 WHERE id = ?', [admin.user.id]);
  const victim = await registerUser('zfaadmvictim', 'standard');
  const avatar = await uploadAvatar(victim.token);

  const res = await fetch(`${base}/api/admin/users/${victim.user.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${admin.token}` },
  });
  assert.equal(res.status, 200);
  assert.equal(await first('SELECT id FROM users WHERE id = ?', [victim.user.id]), null);
  assert.equal(fs.existsSync(storagePath(avatar)), false, 'das Profilbild muss mit weg sein');
});
