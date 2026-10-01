/**
 * Gesperrte Begriffe an den Endpunkten – gegen die echte Datenbank.
 *
 * Die Logik selbst prueft test/blocked-terms.test.js. Hier geht es um die Frage
 * davor: Ist die Pruefung an JEDER Stelle eingebaut, an der Nutzer Text
 * hinterlassen, und kommt die Meldung dort an, wo die App sie sucht (422, erste
 * Meldung in `message`, Feld in `errors`)? Eine Stelle ohne Pruefung ist genau
 * die, ueber die der Text dann kommt.
 *
 * Aufbau wie test/chat.test.js: freier Port, Wegwerf-Konten, `after` raeumt auf
 * (alles haengt per ON DELETE CASCADE an den Konten).
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from '../src/app.js';
import { ensureSchema, pool } from '../src/db.js';
import { blockedTermMessageFor } from '../src/blocked-terms.js';
import { deleteTestUsers, uniqueStamp as stamp } from './support/fixtures.js';

process.env.FEATURE_ACCOUNT_TIERS = 'true';

const MSG_USERNAME = blockedTermMessageFor('username');
const MSG_NAME = blockedTermMessageFor('name');
const MSG_TEXT = blockedTermMessageFor('text');

let base;
let server;
const createdUserIds = [];

function registerBody(overrides = {}) {
  const s = stamp();
  return {
    name: 'Blockterm Test',
    username: `blockterm${s}`.slice(0, 28),
    email: `blockterm-test-${s}@example.invalid`,
    password: 'Wortliste2026',
    account_type: 'standard',
    device_name: 'test',
    ...overrides,
  };
}

async function tryRegister(overrides) {
  const res = await fetch(`${base}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(registerBody(overrides)),
  });
  const body = await res.json();
  if (body?.user?.id) createdUserIds.push(body.user.id);
  return { status: res.status, body };
}

async function registerUser(accountType = 'creator') {
  const { status, body } = await tryRegister();
  assert.equal(status, 201, 'Registrierung muss klappen');
  if (accountType !== 'standard') {
    await pool.query('UPDATE users SET account_type = ? WHERE id = ?', [accountType, body.user.id]);
  }
  return body;
}

const send = (method, path, token, body) =>
  fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body ?? {}),
  });

const sendForm = (path, token, form) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });

/** 422, Meldung oben UND am Feld – so liest die App die Antwort. */
async function assertBlocked(res, field, message) {
  assert.equal(res.status, 422);
  const body = await res.json();
  assert.equal(body.message, message);
  assert.deepEqual(body.errors[field], [message]);
}

/** Kleinstes gueltiges PNG (1×1) – fuer Storys, die ohne Bild gar nicht gehen. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

before(async () => {
  await ensureSchema();
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  // Closed even when the cleanup throws; open handles would keep `npm test` from exiting.
  try {
    await deleteTestUsers(pool, createdUserIds);
  } finally {
    await pool.end();
    server?.close();
  }
});

test('POST /api/register (Node): gesperrter Benutzername und Name werden abgelehnt', async () => {
  const username = await tryRegister({ username: 'xXhurensohnXx' });
  assert.equal(username.status, 422);
  assert.deepEqual(username.body.errors.username, [MSG_USERNAME]);

  const name = await tryRegister({ name: 'Adolf Hitler' });
  assert.equal(name.status, 422);
  assert.equal(name.body.message, MSG_NAME);

  // Echter Nachname im Namen-Feld: geht durch.
  const fick = await tryRegister({ name: 'Adolf Fick' });
  assert.equal(fick.status, 201);
});

test('PATCH /api/user (Node): neuer gesperrter Wert nein, alter Wert blockiert nichts', async () => {
  const { token, user } = await registerUser('standard');
  await assertBlocked(await send('PATCH', '/api/user', token, { username: 'sieg_heil' }), 'username', MSG_USERNAME);
  await assertBlocked(await send('PATCH', '/api/user', token, { name: 'Du Fotze' }), 'name', MSG_NAME);

  // Ein Altname, den die Liste heute traefe, bleibt beim Speichern anderer Felder
  // stehen – sonst liesse sich nicht einmal mehr das Interesse aendern.
  await pool.query('UPDATE users SET name = ? WHERE id = ?', ['Schlampe', user.id]);
  const res = await send('PATCH', '/api/user', token, { name: 'Schlampe', interests: [] });
  assert.equal(res.status, 200);
});

test('PATCH /api/admin/users/:id: auch Admins vergeben keinen gesperrten Benutzernamen', async () => {
  const admin = await registerUser('standard');
  await pool.query('UPDATE users SET is_admin = 1 WHERE id = ?', [admin.user.id]);
  const target = await registerUser('standard');

  await assertBlocked(
    await send('PATCH', `/api/admin/users/${target.user.id}`, admin.token, { username: 'NaziKing' }),
    'username',
    MSG_USERNAME,
  );
  const ok = await send('PATCH', `/api/admin/users/${target.user.id}`, admin.token, {
    username: `neu${stamp()}`.slice(0, 20),
  });
  assert.equal(ok.status, 200);
});

test('POST /api/activities: Titel, Beschreibung und Ort werden geprueft', async () => {
  const { token } = await registerUser('creator');
  for (const [field, value] of [
    ['title', 'Kanaken raus'],
    ['description', 'Kommt alle, ihr Wichser'],
    ['location', 'Bei der Hure um die Ecke'],
  ]) {
    const form = new FormData();
    form.append('title', 'Kickerabend');
    form.append('description', 'Wir spielen Kicker.');
    form.append('location', 'Teststrasse 1, 50667 Koeln');
    form.append('starts_at', new Date(Date.now() + 86400000).toISOString());
    form.set(field, value);
    await assertBlocked(await sendForm('/api/activities', token, form), field, MSG_TEXT);
  }
});

test('Gruppen: Name im Namen-Modus, Beschreibung als Text – beim Anlegen und Umbenennen', async () => {
  const { token } = await registerUser('standard');
  await assertBlocked(await send('POST', '/api/groups', token, { name: 'Hitler Fanclub' }), 'name', MSG_NAME);
  await assertBlocked(
    await send('POST', '/api/groups', token, { name: 'Kickerrunde', description: 'nur für Hurensöhne' }),
    'description',
    MSG_TEXT,
  );

  const created = await send('POST', '/api/groups', token, { name: 'Kickerrunde', description: 'Donnerstags' });
  assert.equal(created.status, 201);
  const group = (await created.json()).data;

  await assertBlocked(await send('PATCH', `/api/groups/${group.id}`, token, { name: 'Sieg Heil' }), 'name', MSG_NAME);
  const renamed = await send('PATCH', `/api/groups/${group.id}`, token, { name: 'Donnerstagsrunde' });
  assert.equal(renamed.status, 200);
});

test('Chat: eine Nachricht mit gesperrtem Begriff wird abgelehnt, nicht maskiert', async () => {
  const { token } = await registerUser('standard');
  const group = (await (await send('POST', '/api/groups', token, { name: 'Chatrunde' })).json()).data;

  await assertBlocked(
    await send('POST', `/api/chats/group/${group.id}/messages`, token, { body: 'fick dich' }),
    'body',
    MSG_TEXT,
  );
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS c FROM chat_messages m JOIN chat_rooms r ON r.id = m.room_id WHERE r.group_id = ?`,
    [group.id],
  );
  assert.equal(Number(rows[0].c), 0, 'nichts gespeichert');

  // Geschichte und Haltung bleiben sagbar.
  const ok = await send('POST', `/api/chats/group/${group.id}/messages`, token, { body: 'Nazis raus!' });
  assert.equal(ok.status, 201);
});

test('Beitraege und Kommentare: Anlegen, Bearbeiten, Kommentieren', async () => {
  const { token } = await registerUser('creator');
  const blockedPost = new FormData();
  blockedPost.append('body', 'Alle Kanaken sind ...');
  await assertBlocked(await sendForm('/api/posts', token, blockedPost), 'body', MSG_TEXT);

  const okPost = new FormData();
  okPost.append('body', 'Heute war ein guter Tag im Park.');
  const created = await sendForm('/api/posts', token, okPost);
  assert.equal(created.status, 201);
  const post = (await created.json()).data;

  await assertBlocked(await send('PATCH', `/api/posts/${post.id}`, token, { body: 'du Missgeburt' }), 'body', MSG_TEXT);
  await assertBlocked(
    await send('POST', `/api/posts/${post.id}/comments`, token, { body: 'cyka blyat' }),
    'body',
    MSG_TEXT,
  );
});

test('Storys: die Bildunterschrift wird geprueft, bevor das Bild gespeichert wird', async () => {
  const { token } = await registerUser('creator');
  const form = new FormData();
  form.append('image', new Blob([PNG], { type: 'image/png' }), 'story.png');
  form.append('caption', 'H E I L  H I T L E R');
  await assertBlocked(await sendForm('/api/stories', token, form), 'caption', MSG_TEXT);
});
