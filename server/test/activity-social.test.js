/**
 * Gefaellt-mir und Kommentare an Events – gegen die echte Datenbank.
 *
 * Aufbau wie test/chat.test.js: Die App laeuft auf einem freien Port, es
 * entstehen Wegwerf-Konten, und am Ende raeumt `after` alles wieder weg (Likes
 * und Kommentare haengen per ON DELETE CASCADE an Konten und Events).
 *
 * Geprueft wird, was die App an diesen Endpunkten erwartet: die Zahlen in jeder
 * Event-Antwort, wer welchen Kommentar loeschen darf, und dass eine Blockierung
 * auch unter einem Event greift. Dazu das Loeschen fremder Events durch Admins,
 * das bisher nur im Code stand und in keinem Test.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from '../src/app.js';
import { ensureSchema, pool } from '../src/db.js';

let base;
let server;
const createdUserIds = [];
const createdActivityIds = [];

/**
 * Wegwerf-Konto. Registriert wird immer als 'standard', die Stufe kommt danach
 * direkt in die DB – 'creator', damit das Konto Events anlegen darf, egal ob die
 * Kontostufen gerade eingeschaltet sind (server/src/features.js).
 */
async function registerUser(prefix, accountType = 'creator') {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const res = await fetch(`${base}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `${prefix} Test`,
      username: `${prefix}${stamp}`.slice(0, 28),
      email: `${prefix}${stamp}@example.com`,
      password: 'geheim1234',
      account_type: 'standard',
      device_name: 'test',
    }),
  });
  assert.equal(res.status, 201, 'Registrierung muss klappen');
  const body = await res.json();
  createdUserIds.push(body.user.id);
  if (accountType !== 'standard') {
    await pool.query('UPDATE users SET account_type = ? WHERE id = ?', [accountType, body.user.id]);
    body.user.account_type = accountType;
  }
  return body;
}

const makeAdmin = (userId) => pool.query('UPDATE users SET is_admin = 1 WHERE id = ?', [userId]);

const get = (path, token) =>
  fetch(`${base}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

const send = (method, path, token, body) =>
  fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const like = (token, id) => send('POST', `/api/activities/${id}/like`, token);
const unlike = (token, id) => send('DELETE', `/api/activities/${id}/like`, token);
const comment = (token, id, body) => send('POST', `/api/activities/${id}/comments`, token, { body });
const deleteComment = (token, id, commentId) =>
  send('DELETE', `/api/activities/${id}/comments/${commentId}`, token);

async function createActivity(token, title = 'Social-Test') {
  const form = new FormData();
  form.append('title', title);
  form.append('description', 'Testbeschreibung');
  form.append('location', 'Teststrasse 1, 50667 Koeln');
  form.append('starts_at', new Date(Date.now() + 86400000).toISOString());
  const res = await fetch(`${base}/api/activities`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  assert.equal(res.status, 201, 'Activity anlegen muss klappen');
  const body = await res.json();
  createdActivityIds.push(body.data.id);
  return body.data;
}

/** Das Event, wie `token` es sieht. */
async function show(token, id) {
  const res = await get(`/api/activities/${id}`, token);
  assert.equal(res.status, 200);
  return (await res.json()).data;
}

/** Legt einen Kommentar an und liefert ihn (201 wird erwartet). */
async function addComment(token, id, body) {
  const res = await comment(token, id, body);
  assert.equal(res.status, 201, 'Kommentar anlegen muss klappen');
  return (await res.json()).data;
}

before(async () => {
  await ensureSchema();
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  // Closed even when the cleanup throws; open handles would keep `npm test` from exiting.
  try {
    if (createdActivityIds.length) {
      await pool.query(
        `DELETE FROM activities WHERE id IN (${createdActivityIds.map(() => '?').join(',')})`,
        createdActivityIds,
      );
    }
    if (createdUserIds.length) {
      await pool.query(
        `DELETE FROM users WHERE id IN (${createdUserIds.map(() => '?').join(',')})`,
        createdUserIds,
      );
    }
  } finally {
    await pool.end();
    server?.close();
  }
});

/* ------------------------------------------------------------ Gefaellt mir */

test('ein neues Event bringt Zahlen mit – 0 statt undefined', async () => {
  const host = await registerUser('aslhost');
  const activity = await createActivity(host.token);
  assert.equal(activity.likes_count, 0);
  assert.equal(activity.comments_count, 0);
  assert.equal(activity.liked_by_me, false);
});

test('POST/DELETE /like: idempotent, mit Zahl und liked_by_me aus Sicht der:des Fragenden', async () => {
  const host = await registerUser('aslhost');
  const fan = await registerUser('aslfan');
  const activity = await createActivity(host.token);

  const first = await like(fan.token, activity.id);
  assert.equal(first.status, 200);
  const liked = (await first.json()).data;
  assert.equal(liked.id, activity.id);
  assert.equal(liked.likes_count, 1);
  assert.equal(liked.liked_by_me, true);

  // Zweimal moegen ist einmal moegen.
  const again = (await (await like(fan.token, activity.id)).json()).data;
  assert.equal(again.likes_count, 1);
  assert.equal(again.liked_by_me, true);

  // Der Host sieht die Zahl, aber nicht „gefaellt mir".
  const hostView = await show(host.token, activity.id);
  assert.equal(hostView.likes_count, 1);
  assert.equal(hostView.liked_by_me, false);

  // Der Host darf sein eigenes Event moegen.
  const own = (await (await like(host.token, activity.id)).json()).data;
  assert.equal(own.likes_count, 2);
  assert.equal(own.liked_by_me, true);

  const off = await unlike(fan.token, activity.id);
  assert.equal(off.status, 200);
  const unliked = (await off.json()).data;
  assert.equal(unliked.likes_count, 1);
  assert.equal(unliked.liked_by_me, false);

  // Zuruecknehmen ist ebenfalls idempotent.
  const offAgain = await unlike(fan.token, activity.id);
  assert.equal(offAgain.status, 200);
  assert.equal((await offAgain.json()).data.likes_count, 1);
});

test('die Zahlen stehen auch in Liste, Merkliste und Beitritts-Antwort', async () => {
  const host = await registerUser('aslhost');
  const fan = await registerUser('aslfan');
  const activity = await createActivity(host.token);
  await like(fan.token, activity.id);
  await addComment(host.token, activity.id, 'Wer bringt Getraenke mit?');

  const list = (await (await get('/api/activities', fan.token)).json()).data;
  const inList = list.find((a) => a.id === activity.id);
  assert.ok(inList, 'Event steht in der Liste');
  assert.equal(inList.likes_count, 1);
  assert.equal(inList.comments_count, 1);
  assert.equal(inList.liked_by_me, true);

  const saved = (await (await send('POST', `/api/activities/${activity.id}/save`, fan.token)).json()).data;
  assert.equal(saved.likes_count, 1);
  assert.equal(saved.liked_by_me, true);
  const savedList = (await (await get('/api/activities/saved', fan.token)).json()).data;
  const inSaved = savedList.find((a) => a.id === activity.id);
  assert.equal(inSaved.comments_count, 1);
  assert.equal(inSaved.liked_by_me, true);
  assert.equal(inSaved.is_saved, true);

  const joined = (await (await send('POST', `/api/activities/${activity.id}/join`, fan.token)).json()).data;
  assert.equal(joined.likes_count, 1);
  assert.equal(joined.comments_count, 1);
  const left = (await (await send('DELETE', `/api/activities/${activity.id}/join`, fan.token)).json()).data;
  assert.equal(left.liked_by_me, true);
});

test('Gefaellt mir: unbekanntes Event ergibt 404', async () => {
  const { token } = await registerUser('aslfan');
  assert.equal((await like(token, 999999999)).status, 404);
  assert.equal((await unlike(token, 999999999)).status, 404);
  assert.equal((await get('/api/activities/999999999/comments', token)).status, 404);
  assert.equal((await comment(token, 999999999, 'Hallo')).status, 404);
});

/* ------------------------------------------------------------- Kommentare */

test('POST /comments: legt an, liefert Kommentar und Event, Liste aelteste zuerst', async () => {
  const host = await registerUser('aslhost');
  const fan = await registerUser('aslfan');
  const activity = await createActivity(host.token);

  const res = await comment(fan.token, activity.id, '  Bin dabei!  ');
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.data.body, 'Bin dabei!', 'Leerraum aussen herum wird abgeschnitten');
  assert.equal(body.data.can_delete, true);
  assert.match(body.data.created_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.deepEqual(Object.keys(body.data.user).sort(), ['account_type', 'avatar', 'id', 'name', 'username']);
  assert.equal(body.data.user.id, fan.user.id);
  assert.equal(body.activity.id, activity.id);
  assert.equal(body.activity.comments_count, 1);

  await addComment(host.token, activity.id, 'Super, bis dann.');

  const listRes = await get(`/api/activities/${activity.id}/comments`, fan.token);
  assert.equal(listRes.status, 200);
  const list = (await listRes.json()).data;
  assert.deepEqual(
    list.map((c) => c.body),
    ['Bin dabei!', 'Super, bis dann.'],
  );
  // Aus Sicht von `fan`: den eigenen darf er loeschen, den des Hosts nicht.
  assert.deepEqual(
    list.map((c) => c.can_delete),
    [true, false],
  );

  // Der Host darf unter seinem Event alles loeschen.
  const hostList = (await (await get(`/api/activities/${activity.id}/comments`, host.token)).json()).data;
  assert.deepEqual(
    hostList.map((c) => c.can_delete),
    [true, true],
  );

  // Ein Admin ebenso – auch ohne eigenes Event.
  const admin = await registerUser('asladmin');
  await makeAdmin(admin.user.id);
  const adminList = (await (await get(`/api/activities/${activity.id}/comments`, admin.token)).json()).data;
  assert.deepEqual(
    adminList.map((c) => c.can_delete),
    [true, true],
  );

  assert.equal((await show(fan.token, activity.id)).comments_count, 2);
});

test('POST /comments: leer, nur Leerraum und zu lang wird mit 422 am Feld abgelehnt', async () => {
  const host = await registerUser('aslhost');
  const activity = await createActivity(host.token);

  for (const text of ['', '   ', undefined]) {
    const res = await comment(host.token, activity.id, text);
    assert.equal(res.status, 422, `„${text}" muss abgelehnt werden`);
    const body = await res.json();
    assert.ok(body.errors.body?.length, 'Fehler steht am Feld body');
  }

  const tooLong = await comment(host.token, activity.id, 'a'.repeat(501));
  assert.equal(tooLong.status, 422);
  assert.ok((await tooLong.json()).errors.body?.length);

  // Genau 500 Zeichen passen noch.
  assert.equal((await comment(host.token, activity.id, 'a'.repeat(500))).status, 201);
  assert.equal((await show(host.token, activity.id)).comments_count, 1);
});

test('DELETE /comments/:commentId: Verfasser:in, Host und Admin duerfen, Fremde nicht', async () => {
  const host = await registerUser('aslhost');
  const author = await registerUser('aslauthor');
  const stranger = await registerUser('aslstranger');
  const admin = await registerUser('asladmin');
  await makeAdmin(admin.user.id);
  const activity = await createActivity(host.token);

  const forAuthor = await addComment(author.token, activity.id, 'Erster');
  const forHost = await addComment(author.token, activity.id, 'Zweiter');
  const forAdmin = await addComment(author.token, activity.id, 'Dritter');

  // Fremde: 403, der Kommentar bleibt.
  assert.equal((await deleteComment(stranger.token, activity.id, forAuthor.id)).status, 403);
  assert.equal((await show(host.token, activity.id)).comments_count, 3);

  const own = await deleteComment(author.token, activity.id, forAuthor.id);
  assert.equal(own.status, 200);
  const ownBody = await own.json();
  assert.ok(ownBody.message);
  assert.equal(ownBody.activity.id, activity.id);
  assert.equal(ownBody.activity.comments_count, 2);

  const hostDel = await deleteComment(host.token, activity.id, forHost.id);
  assert.equal(hostDel.status, 200);
  assert.equal((await hostDel.json()).activity.comments_count, 1);

  const adminDel = await deleteComment(admin.token, activity.id, forAdmin.id);
  assert.equal(adminDel.status, 200);
  assert.equal((await adminDel.json()).activity.comments_count, 0);

  // Schon weg: 404.
  assert.equal((await deleteComment(author.token, activity.id, forAuthor.id)).status, 404);
});

test('DELETE /comments/:commentId: ein Kommentar eines ANDEREN Events ergibt 404', async () => {
  // Sonst koennte ein Host ueber die eigene Event-ID Kommentare unter fremden
  // Events loeschen.
  const host = await registerUser('aslhost');
  const other = await registerUser('aslother');
  const mine = await createActivity(host.token);
  const theirs = await createActivity(other.token);
  const foreign = await addComment(other.token, theirs.id, 'Unter meinem Event');

  assert.equal((await deleteComment(host.token, mine.id, foreign.id)).status, 404);
  assert.equal((await show(other.token, theirs.id)).comments_count, 1);
});

/* ------------------------------------------------------------ Blockierung */

test('Blockierung: kein Gefaellt-mir und kein Kommentar beim Host, fremde Kommentare verschwinden', async () => {
  const host = await registerUser('aslhost');
  const pest = await registerUser('aslpest');
  const bystander = await registerUser('aslbystander');
  const activity = await createActivity(host.token);

  await addComment(pest.token, activity.id, 'Vorher geschrieben');
  await addComment(bystander.token, activity.id, 'Ich auch');

  const block = await send('POST', '/api/blocks', host.token, { user_id: pest.user.id });
  assert.equal(block.status, 201);

  // Wer mit dem Host blockiert ist, kommt nicht mehr ran – in beiden Richtungen.
  assert.equal((await like(pest.token, activity.id)).status, 403);
  assert.equal((await comment(pest.token, activity.id, 'Nachher')).status, 403);

  // Der Host sieht den Kommentar der blockierten Person nicht mehr – auch nicht
  // in der Zahl.
  const hostList = (await (await get(`/api/activities/${activity.id}/comments`, host.token)).json()).data;
  assert.deepEqual(
    hostList.map((c) => c.body),
    ['Ich auch'],
  );
  assert.equal((await show(host.token, activity.id)).comments_count, 1);

  // Unbeteiligte sehen beide.
  const otherList = (await (await get(`/api/activities/${activity.id}/comments`, bystander.token)).json()).data;
  assert.equal(otherList.length, 2);
  assert.equal((await show(bystander.token, activity.id)).comments_count, 2);
});

/* ------------------------------------------------------------- Teilnehmende */

test('participants tragen avatar_url – volle Adresse oder null', async () => {
  const host = await registerUser('aslhost');
  const guest = await registerUser('aslguest');
  await pool.query('UPDATE users SET avatar = ? WHERE id = ?', ['avatars/asl-test.jpg', guest.user.id]);
  const activity = await createActivity(host.token);
  const joined = (await (await send('POST', `/api/activities/${activity.id}/join`, guest.token)).json()).data;

  const hostEntry = joined.participants.find((p) => p.id === host.user.id);
  const guestEntry = joined.participants.find((p) => p.id === guest.user.id);
  assert.ok('avatar_url' in hostEntry, 'der Schluessel ist immer da');
  assert.equal(hostEntry.avatar_url, null);
  assert.match(guestEntry.avatar_url, /^https?:\/\/.+\/storage\/avatars\/asl-test\.jpg$/);
  // Die bisherigen Felder bleiben.
  assert.equal(guestEntry.name, guest.user.name);
  assert.equal(guestEntry.username, guest.user.username);
});

/* ---------------------------------------------------------- Event loeschen */

test('DELETE /api/activities/:id: Fremde bekommen 403, ein Admin darf jedes Event loeschen', async () => {
  const host = await registerUser('aslhost');
  const stranger = await registerUser('aslstranger');
  const admin = await registerUser('asladmin', 'standard');
  await makeAdmin(admin.user.id);
  const activity = await createActivity(host.token);
  await like(stranger.token, activity.id);
  await addComment(stranger.token, activity.id, 'Bleibt das?');

  assert.equal((await send('DELETE', `/api/activities/${activity.id}`, stranger.token)).status, 403);
  assert.equal((await show(host.token, activity.id)).id, activity.id, 'Event steht noch');

  const res = await send('DELETE', `/api/activities/${activity.id}`, admin.token);
  assert.equal(res.status, 200);
  assert.equal((await get(`/api/activities/${activity.id}`, host.token)).status, 404);

  // Likes und Kommentare gehen per ON DELETE CASCADE mit.
  const [[likes]] = await pool.query('SELECT COUNT(*) AS c FROM activity_likes WHERE activity_id = ?', [
    activity.id,
  ]);
  const [[comments]] = await pool.query(
    'SELECT COUNT(*) AS c FROM activity_comments WHERE activity_id = ?',
    [activity.id],
  );
  assert.equal(Number(likes.c), 0);
  assert.equal(Number(comments.c), 0);
});
