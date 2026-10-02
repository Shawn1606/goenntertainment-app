/**
 * Deleting an account, Node's side, against the real database.
 *
 * Laravel checks (DELETE /api/me: password or confirmation word, last admin, 2FA code;
 * api/tests/Feature/AccountDeletionTest.php) and calls Node's internal route
 * DELETE /internal/accounts/:id with the shared secret and a one-time grant; Node deletes the data
 * and the files (src/routes/internal.js, src/account-deletion.js). The admin panel's deletion uses
 * the same code.
 *
 * Gleiches Muster wie api.test.js: App auf freiem Port, Wegwerf-Konten, am Ende
 * alles wieder weg. Die Zwei-Faktor-Spalten werden direkt in der DB gesetzt –
 * das Einschalten selbst gehoert Laravel und wird dort geprueft.
 *
 * (Until this file was renamed from account.test.js it also tested Node's copies of sign-in,
 * sign-up, GET /api/user and the password reset; those copies are deleted and their tests moved
 * to api/tests/Feature: LoginTest, RegisterTest, UserProfileTest, PasswordResetTest.)
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { createApp } from '../src/app.js';
import { FUNCTIONAL_WRITE_LIMITS } from './support/app.js';
import { ensureSchema, pool, first } from '../src/db.js';
import { createUser, deleteTestUsers } from './support/fixtures.js';
import { TEST_INTERNAL_SECRET } from './support/startup-env.js';
// A valid 1x1 PNG (the one written here before was malformed; see test/support/images.js).
import { PNG_1X1 } from './support/images.js';

let base;
let server;
const createdUserIds = [];
const createdFiles = [];

/** Throw-away account with a token, written straight to the database (test/support/fixtures.js). */
const registerUser = (prefix, accountType = 'creator') =>
  createUser(prefix, { accountType, created: createdUserIds });

const get = (p, token) => fetch(`${base}${p}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

/**
 * DELETE /internal/accounts/:id the way Laravel calls it (api/app/Support/NodeInternal.php):
 * shared secret and grant in headers, no user token. `on` = another app's base address.
 */
const deleteInternal = (userId, { secret = TEST_INTERNAL_SECRET, grant, on = base } = {}) =>
  fetch(`${on}/internal/accounts/${userId}`, {
    method: 'DELETE',
    headers: {
      Accept: 'application/json',
      ...(secret === null ? {} : { 'X-Internal-Secret': secret }),
      ...(grant === undefined ? {} : { 'X-Account-Deletion-Grant': grant }),
    },
  });

/** Starts another app on a free port for one test; returns its base address and a stop function. */
async function otherApp(options) {
  const other = createApp({ writeLimits: FUNCTIONAL_WRITE_LIMITS, ...options }).listen(0);
  await new Promise((resolve) => other.once('listening', resolve));
  return { url: `http://127.0.0.1:${other.address().port}`, stop: () => new Promise((r) => other.close(r)) };
}

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

before(async () => {
  await ensureSchema();
  server = createApp({ internalSecret: TEST_INTERNAL_SECRET, writeLimits: FUNCTIONAL_WRITE_LIMITS }).listen(0);
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

/* ------------------------------------------ DELETE /internal/accounts/:id */

// DELETE /api/me itself (password or confirmation word, last admin, 2FA code) is Laravel's:
// api/tests/Feature/AccountDeletionTest.php. The two Node tests of the deleted Node copy of that
// route (wrong password, confirmation word) moved there.

test('GET /internal/health answers without a secret', async () => {
  const res = await fetch(`${base}/internal/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

test('DELETE /internal/accounts/:id: a missing or wrong secret is a 404, the account stays', async () => {
  const { user } = await registerUser('zfaintsecret', 'standard');

  for (const secret of [null, '', 'wrong-test-only-secret-not-a-secret-0000', TEST_INTERNAL_SECRET.toUpperCase()]) {
    const res = await deleteInternal(user.id, { secret, grant: await insertGrant(user.id) });
    assert.equal(res.status, 404, `secret ${secret === null ? 'missing' : 'wrong'}`);
  }
  assert.ok(await first('SELECT id FROM users WHERE id = ?', [user.id]));
});

test('DELETE /internal/accounts/:id: without a configured secret every call is refused (503)', async () => {
  const { user } = await registerUser('zfaintnone', 'standard');
  const other = await otherApp({ internalSecret: '' });
  try {
    for (const secret of [null, '', TEST_INTERNAL_SECRET]) {
      const res = await deleteInternal(user.id, { secret, grant: await insertGrant(user.id), on: other.url });
      assert.equal(res.status, 503);
    }
  } finally {
    await other.stop();
  }
  assert.ok(await first('SELECT id FROM users WHERE id = ?', [user.id]));
});

test('DELETE /internal/accounts/:id: only with a fresh grant from Laravel for this account', async () => {
  const { user } = await registerUser('zfaint2fa', 'standard');
  const other = await registerUser('zfaint2faother', 'standard');
  await setTwoFactor(user.id, 'totp');

  // Missing, invented, expired and another account's grants: no.
  for (const grant of [undefined, 'erfunden', await insertGrant(user.id, { expired: true }), await insertGrant(other.user.id)]) {
    const res = await deleteInternal(user.id, { grant });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).message, 'Die Bestätigung ist abgelaufen – bitte versuch es noch einmal.');
  }
  assert.ok(await first('SELECT id FROM users WHERE id = ?', [user.id]));

  // A real grant: deleted, and the grant is used up.
  const grant = await insertGrant(user.id);
  const ok = await deleteInternal(user.id, { grant });
  assert.equal(ok.status, 200);
  assert.equal(await first('SELECT id FROM users WHERE id = ?', [user.id]), null);
  assert.equal(
    await first('SELECT id FROM two_factor_challenges WHERE token_hash = ?', [
      crypto.createHash('sha256').update(grant).digest('hex'),
    ]),
    null,
  );
});

test('DELETE /internal/accounts/:id: removes the account, its tokens and every own file', async () => {
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

  const res = await deleteInternal(host.user.id, { grant: await insertGrant(host.user.id) });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).message, 'Dein Konto wurde gelöscht.');

  assert.equal(await first('SELECT id FROM users WHERE id = ?', [host.user.id]), null);
  assert.equal(await first('SELECT id FROM personal_access_tokens WHERE tokenable_id = ?', [host.user.id]), null);
  // The old token no longer opens any route (a Node route; GET /api/user is Laravel's).
  assert.equal((await get('/api/notifications', host.token)).status, 401);

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
  assert.equal((await get('/api/notifications', guest.token)).status, 200);
});

test('DELETE /internal/accounts/:id: an admin who is not the last one may go', async () => {
  const { user } = await registerUser('zfadeladmin', 'standard');
  // The second admin this test relies on is created here, so the result no longer depends on
  // what other test files (or earlier runs) left in the database. (Refusing the last admin
  // depends on every admin in the shared test database; Laravel's test covers that answer.)
  const other = await registerUser('zfadeladmintwo', 'standard');
  await pool.query('UPDATE users SET is_admin = 1 WHERE id IN (?, ?)', [user.id, other.user.id]);
  const [[{ c }]] = await pool.query('SELECT COUNT(*) AS c FROM users WHERE is_admin = 1 AND id <> ?', [user.id]);
  assert.ok(Number(c) > 0, 'Test setzt einen weiteren Admin voraus');

  const res = await deleteInternal(user.id, { grant: await insertGrant(user.id) });
  assert.equal(res.status, 200);
  assert.equal(await first('SELECT id FROM users WHERE id = ?', [user.id]), null);
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
