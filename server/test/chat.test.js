/**
 * Integrationstest der Chats, Blockierungen, Meldungen und der Merkliste –
 * gegen die echte Datenbank.
 *
 * Aufbau wie test/api.test.js: Die App laeuft auf einem freien Port, es entstehen
 * Wegwerf-Konten, und am Ende raeumt `after` alles wieder weg. Was hier geprueft
 * wird, ist genau das, was reine Logik NICHT beantworten kann (das steht in
 * test/messaging.test.js): Wer darf in welchen Raum, was passiert beim Blockieren,
 * bleibt ein Schnappschuss stehen, wenn das geteilte Event geloescht wird.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from '../src/app.js';
import { ensureSchema, pool } from '../src/db.js';

// Diese Tests pruefen die Kontostufen-Regeln. In der App sind die Stufen gerade
// ausgeblendet (server/src/features.js) – hier werden sie ausdruecklich wieder
// eingeschaltet, sonst gaebe es nichts zu pruefen. Wird pro Anfrage gelesen.
process.env.FEATURE_ACCOUNT_TIERS = 'true';

let base;
let server;
const createdUserIds = [];
const createdActivityIds = [];

/** Wegwerf-Konto. Registriert wird immer als 'standard', die Stufe kommt danach. */
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

const get = (path, token) =>
  fetch(`${base}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

const post = (path, token, body) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body ?? {}),
  });

const patch = (path, token, body) =>
  fetch(`${base}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body ?? {}),
  });

const del = (path, token) =>
  fetch(`${base}${path}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });

async function createActivity(token, title) {
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

/** Beide Richtungen anfragen = bestaetigte Freundschaft (siehe routes/friends.js). */
async function befriend(a, b) {
  await post('/api/friends', a.token, { user_id: b.user.id });
  await post('/api/friends', b.token, { user_id: a.user.id });
}

/** Gruppe mit einem Mitglied – die Ausgangslage der meisten Tests hier. */
async function makeGroup(owner, member) {
  await befriend(owner, member);
  const res = await post('/api/groups', owner.token, {
    name: 'Testrunde',
    members: [member.user.id],
  });
  assert.equal(res.status, 201);
  return (await res.json()).data;
}

const makeAdmin = (userId) => pool.query('UPDATE users SET is_admin = 1 WHERE id = ?', [userId]);

before(async () => {
  await ensureSchema();
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
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
  await pool.end();
  server.close();
});

/* ------------------------------------------------------------ Gruppen-Chat */

test('Gruppen-Chat: Mitglieder schreiben und lesen, Fremde bekommen 404', async () => {
  const owner = await registerUser('chatowner');
  const member = await registerUser('chatmember');
  const stranger = await registerUser('chatstranger');
  const group = await makeGroup(owner, member);

  const sent = await post(`/api/chats/group/${group.id}/messages`, owner.token, {
    body: 'Sind wir um 18 Uhr am Kiosk?',
  });
  assert.equal(sent.status, 201);
  const message = (await sent.json()).data;
  assert.equal(message.body, 'Sind wir um 18 Uhr am Kiosk?');
  assert.equal(message.is_mine, true);
  assert.equal(message.user.id, owner.user.id);

  // Das Mitglied liest dieselbe Nachricht – aber nicht als eigene.
  const seen = await (await get(`/api/chats/group/${group.id}/messages`, member.token)).json();
  assert.equal(seen.data.length, 1);
  assert.equal(seen.data[0].is_mine, false);
  assert.equal(seen.room.title, 'Testrunde');
  // Moderieren darf hier nur, wer die Gruppe angelegt hat.
  assert.equal(seen.room.can_moderate, false);

  // Wer nicht drin ist, soll nicht einmal erfahren, dass es den Chat gibt.
  assert.equal((await get(`/api/chats/group/${group.id}/messages`, stranger.token)).status, 404);
  assert.equal(
    (await post(`/api/chats/group/${group.id}/messages`, stranger.token, { body: 'hallo' })).status,
    404,
  );
});

test('der Raum entsteht erst beim ersten Wort – vorher ist der Verlauf leer', async () => {
  const owner = await registerUser('chatlazy');
  const member = await registerUser('chatlazy2');
  const group = await makeGroup(owner, member);

  const empty = await (await get(`/api/chats/group/${group.id}/messages`, owner.token)).json();
  assert.deepEqual(empty.data, []);

  const rooms = await pool.query('SELECT id FROM chat_rooms WHERE group_id = ?', [group.id]);
  assert.equal(rooms[0].length, 0, 'ohne Nachricht darf es keinen Raum geben');

  await post(`/api/chats/group/${group.id}/messages`, owner.token, { body: 'erste' });
  const after1 = await pool.query('SELECT id FROM chat_rooms WHERE group_id = ?', [group.id]);
  assert.equal(after1[0].length, 1, 'nach der ersten Nachricht genau ein Raum');
});

test('leere Nachrichten werden abgelehnt', async () => {
  const owner = await registerUser('chatempty');
  const member = await registerUser('chatempty2');
  const group = await makeGroup(owner, member);

  assert.equal((await post(`/api/chats/group/${group.id}/messages`, owner.token, { body: '   ' })).status, 422);
  assert.equal((await post(`/api/chats/group/${group.id}/messages`, owner.token, {})).status, 422);
  assert.equal(
    (await post(`/api/chats/group/${group.id}/messages`, owner.token, { body: 'a'.repeat(1001) })).status,
    422,
  );
});

/* -------------------------------------------------------------- Event-Chat */

test('Event-Chat: Host und Teilnehmer:in duerfen, Unbeteiligte nicht', async () => {
  const host = await registerUser('evhost');
  const guest = await registerUser('evguest');
  const outsider = await registerUser('evout');
  const activity = await createActivity(host.token, 'Grillen im Park');

  // Der Host ist beim Anlegen automatisch dabei.
  assert.equal(
    (await post(`/api/chats/activity/${activity.id}/messages`, host.token, { body: 'Wer bringt Kohle?' })).status,
    201,
  );

  // Wer nicht beigetreten ist, sieht den Chat nicht.
  assert.equal((await get(`/api/chats/activity/${activity.id}/messages`, outsider.token)).status, 404);

  await post(`/api/activities/${activity.id}/join`, guest.token);
  const seen = await (await get(`/api/chats/activity/${activity.id}/messages`, guest.token)).json();
  assert.equal(seen.data.length, 1);
  assert.equal(seen.room.title, 'Grillen im Park');
});

/* ------------------------------------------------------------ Event teilen */

test('ein geteiltes Event kommt als Karte an – und bleibt als Titel stehen, wenn es weg ist', async () => {
  const owner = await registerUser('shareowner');
  const member = await registerUser('sharemember');
  const group = await makeGroup(owner, member);
  const activity = await createActivity(owner.token, 'Kino am Freitag');

  // Teilen ohne Kommentar: Die Karte IST die Nachricht.
  const sent = await post(`/api/chats/group/${group.id}/messages`, owner.token, {
    activity_id: activity.id,
  });
  assert.equal(sent.status, 201);
  const shared = (await sent.json()).data;
  assert.equal(shared.body, '');
  assert.equal(shared.shared.activity_id, activity.id);
  assert.equal(shared.shared.title, 'Kino am Freitag');
  assert.equal(shared.shared.location, 'Teststrasse 1, 50667 Koeln');

  // Ein Event, das es nicht gibt, ist ein Fehler und keine leere Karte.
  assert.equal(
    (await post(`/api/chats/group/${group.id}/messages`, owner.token, { activity_id: 999999999 })).status,
    422,
  );

  // Nach dem Loeschen des Events bleibt der Schnappschuss: kein Verweis mehr,
  // aber der Titel steht noch da.
  await del(`/api/activities/${activity.id}`, owner.token);
  const later = await (await get(`/api/chats/group/${group.id}/messages`, member.token)).json();
  const card = later.data.find((row) => row.shared);
  assert.ok(card, 'die Nachricht muss es noch geben');
  assert.equal(card.shared.activity_id, null);
  assert.equal(card.shared.title, 'Kino am Freitag');
});

/* ------------------------------------------------- Ungelesen und Uebersicht */

test('Ungelesene zaehlen nur fremde Nachrichten und verschwinden beim Lesen', async () => {
  const owner = await registerUser('unreadowner');
  const member = await registerUser('unreadmember');
  const group = await makeGroup(owner, member);

  await post(`/api/chats/group/${group.id}/messages`, owner.token, { body: 'eins' });
  await post(`/api/chats/group/${group.id}/messages`, owner.token, { body: 'zwei' });

  // Aus Sicht des Mitglieds: zwei ungelesen.
  const forMember = await (await get('/api/chats', member.token)).json();
  const chatForMember = forMember.data.find((c) => c.kind === 'group' && c.ref_id === group.id);
  assert.equal(chatForMember.unread, 2);
  assert.equal(chatForMember.last_message.preview, 'zwei');

  // Aus Sicht des Absenders: nichts ungelesen, was man selbst geschrieben hat.
  const forOwner = await (await get('/api/chats', owner.token)).json();
  assert.equal(forOwner.data.find((c) => c.ref_id === group.id && c.kind === 'group').unread, 0);

  // Lesen setzt den Stand.
  assert.equal((await post(`/api/chats/group/${group.id}/read`, member.token, {})).status, 200);
  const afterRead = await (await get('/api/chats', member.token)).json();
  assert.equal(afterRead.data.find((c) => c.ref_id === group.id && c.kind === 'group').unread, 0);

  // Die Gruppenliste kennt die Zahl ebenfalls – dafuer ist sie dort.
  await post(`/api/chats/group/${group.id}/messages`, owner.token, { body: 'drei' });
  const groups = await (await get('/api/groups', member.token)).json();
  assert.equal(groups.data.find((g) => g.id === group.id).unread, 1);
});

test('die Uebersicht listet Gruppen auch ohne eine einzige Nachricht', async () => {
  const owner = await registerUser('overviewowner');
  const member = await registerUser('overviewmember');
  const group = await makeGroup(owner, member);

  const chats = await (await get('/api/chats', owner.token)).json();
  const entry = chats.data.find((c) => c.kind === 'group' && c.ref_id === group.id);
  assert.ok(entry, 'die Gruppe muss in der Uebersicht stehen');
  assert.equal(entry.last_message, null);
  assert.equal(entry.unread, 0);
  assert.equal(entry.members, 2);
});

/* ------------------------------------------------------ Nachricht loeschen */

test('loeschen darf die:der Absender:in – und wer die Gruppe angelegt hat', async () => {
  const owner = await registerUser('delowner');
  const member = await registerUser('delmember');
  const group = await makeGroup(owner, member);

  const mine = (await (await post(`/api/chats/group/${group.id}/messages`, member.token, { body: 'meins' })).json()).data;
  const theirs = (await (await post(`/api/chats/group/${group.id}/messages`, owner.token, { body: 'ihres' })).json()).data;

  // Das Mitglied darf die eigene Nachricht loeschen, die fremde nicht.
  assert.equal((await del(`/api/chats/messages/${theirs.id}`, member.token)).status, 403);
  assert.equal((await del(`/api/chats/messages/${mine.id}`, member.token)).status, 200);

  // Wer die Gruppe angelegt hat, darf auch fremde Nachrichten entfernen.
  const second = (await (await post(`/api/chats/group/${group.id}/messages`, member.token, { body: 'nochmal' })).json()).data;
  assert.equal((await del(`/api/chats/messages/${second.id}`, owner.token)).status, 200);

  const left = await (await get(`/api/chats/group/${group.id}/messages`, owner.token)).json();
  assert.deepEqual(left.data.map((row) => row.body), ['ihres']);
});

/* ------------------------------------------------------------- Blockieren */

test('Blockieren beendet die Freundschaft, raeumt die Gruppe und verhindert Anfragen', async () => {
  const me = await registerUser('blockme');
  const pest = await registerUser('blockpest');
  const group = await makeGroup(me, pest);

  // Vorher: befreundet und gemeinsam in der Gruppe.
  const before = await (await get('/api/groups', me.token)).json();
  assert.equal(before.data.find((g) => g.id === group.id).members.length, 2);

  assert.equal((await post('/api/blocks', me.token, { user_id: pest.user.id })).status, 201);

  const friends = await (await get('/api/friends', me.token)).json();
  assert.equal(friends.friends.length, 0, 'die Freundschaft ist beendet');

  const groups = await (await get('/api/groups', me.token)).json();
  assert.equal(groups.data.find((g) => g.id === group.id).members.length, 1, 'nur noch ich');

  // Der Gruppen-Chat ist damit weg – nicht bloss unsichtbar.
  assert.equal((await get(`/api/chats/group/${group.id}/messages`, pest.token)).status, 404);

  // Neue Anfragen gehen in BEIDE Richtungen nicht mehr, und die Meldung verraet
  // nicht, wer blockiert hat.
  assert.equal((await post('/api/friends', pest.token, { user_id: me.user.id })).status, 422);
  assert.equal((await post('/api/friends', me.token, { user_id: pest.user.id })).status, 422);

  // Die Liste macht das Aufheben ueberhaupt moeglich.
  const blocks = await (await get('/api/blocks', me.token)).json();
  assert.equal(blocks.data.length, 1);
  assert.equal(blocks.data[0].id, pest.user.id);

  assert.equal((await del(`/api/blocks/${pest.user.id}`, me.token)).status, 200);
  // Die Freundschaft kommt NICHT zurueck – ihr hat niemand neu zugestimmt.
  const afterUnblock = await (await get('/api/friends', me.token)).json();
  assert.equal(afterUnblock.friends.length, 0);
  assert.equal((await post('/api/friends', me.token, { user_id: pest.user.id })).status, 201);
});

test('Nachrichten blockierter Konten verschwinden nur fuer mich', async () => {
  const owner = await registerUser('hideowner');
  const loud = await registerUser('hideloud');
  const quiet = await registerUser('hidequiet');

  await befriend(owner, loud);
  await befriend(owner, quiet);
  const res = await post('/api/groups', owner.token, {
    name: 'Dreierrunde',
    members: [loud.user.id, quiet.user.id],
  });
  const group = (await res.json()).data;

  await post(`/api/chats/group/${group.id}/messages`, loud.token, { body: 'laut' });
  await post(`/api/chats/group/${group.id}/messages`, quiet.token, { body: 'leise' });

  // `quiet` blockiert `loud` – und sieht dessen Nachricht nicht mehr.
  await post('/api/blocks', quiet.token, { user_id: loud.user.id });
  const forQuiet = await (await get(`/api/chats/group/${group.id}/messages`, quiet.token)).json();
  assert.deepEqual(forQuiet.data.map((row) => row.body), ['leise']);

  // Fuer die anderen bleibt sie stehen: Blockieren ist meine Sicht, keine Loeschung.
  const forOwner = await (await get(`/api/chats/group/${group.id}/messages`, owner.token)).json();
  assert.deepEqual(forOwner.data.map((row) => row.body), ['laut', 'leise']);
});

/* --------------------------------------------------------------- Meldungen */

test('melden legt eine Meldung an, zweimal melden erzeugt keine zweite', async () => {
  const owner = await registerUser('reportowner');
  const member = await registerUser('reportmember');
  const group = await makeGroup(owner, member);
  const message = (await (await post(`/api/chats/group/${group.id}/messages`, owner.token, { body: 'unschoen' })).json()).data;

  const first = await post('/api/reports', member.token, {
    target_type: 'message',
    target_id: message.id,
    reason: 'harassment',
    note: 'Das geht so nicht.',
  });
  assert.equal(first.status, 201);

  // Wer zweimal tippt, hat nichts falsch gemacht – aber es entsteht keine zweite Zeile.
  const again = await post('/api/reports', member.token, {
    target_type: 'message',
    target_id: message.id,
    reason: 'spam',
  });
  assert.equal(again.status, 201);

  const [rows] = await pool.query(
    `SELECT reason, status FROM content_reports WHERE reporter_id = ? AND target_type = 'message' AND target_id = ?`,
    [member.user.id, message.id],
  );
  assert.equal(rows.length, 1, 'genau eine Meldung');
  assert.equal(rows[0].reason, 'spam', 'die neue Angabe gewinnt');
});

test('Meldungen ohne Grund, mit unbekanntem Ziel oder auf sich selbst gehen nicht', async () => {
  const me = await registerUser('reportbad');
  assert.equal((await post('/api/reports', me.token, { target_type: 'user', target_id: me.user.id, reason: 'spam' })).status, 422);
  assert.equal((await post('/api/reports', me.token, { target_type: 'user', target_id: 1, reason: 'weil' })).status, 422);
  assert.equal((await post('/api/reports', me.token, { target_type: 'kommentar', target_id: 1, reason: 'spam' })).status, 422);
  assert.equal((await post('/api/reports', me.token, { target_type: 'user', target_id: 999999999, reason: 'spam' })).status, 404);
});

test('nur Admins sehen und bearbeiten die Meldungen', async () => {
  const normal = await registerUser('repnormal');
  const admin = await registerUser('repadmin');
  await makeAdmin(admin.user.id);
  const target = await registerUser('reptarget');

  await post('/api/reports', normal.token, {
    target_type: 'user',
    target_id: target.user.id,
    reason: 'scam',
    note: 'Will Geld.',
  });

  assert.equal((await get('/api/admin/reports', normal.token)).status, 403);

  const list = await (await get('/api/admin/reports', admin.token)).json();
  const entry = list.data.find(
    (row) => row.target_type === 'user' && row.target_id === target.user.id,
  );
  assert.ok(entry, 'die Meldung muss in der Liste stehen');
  assert.equal(entry.status, 'open');
  assert.equal(entry.reason, 'scam');
  assert.equal(entry.note, 'Will Geld.');
  // Der Gegenstand kommt mit, damit ein Admin nicht suchen muss.
  assert.ok(entry.target.label.includes('@'));
  assert.equal(entry.reporter.name, normal.user.name);

  const updated = await patch(`/api/admin/reports/${entry.id}`, admin.token, { status: 'reviewed' });
  assert.equal(updated.status, 200);
  const afterPatch = await (await get('/api/admin/reports', admin.token)).json();
  const done = afterPatch.data.find((row) => row.id === entry.id);
  assert.equal(done.status, 'reviewed');
  assert.equal(done.admin_name, admin.user.name);
  assert.ok(done.handled_at);

  assert.equal((await patch(`/api/admin/reports/${entry.id}`, admin.token, { status: 'quatsch' })).status, 422);
});

/* --------------------------------------------------------------- Merkliste */

test('Merken ist keine Teilnahme und taucht in der Merkliste auf', async () => {
  const host = await registerUser('savehost');
  const viewer = await registerUser('saveviewer');
  const activity = await createActivity(host.token, 'Flohmarkt');

  const saved = await (await post(`/api/activities/${activity.id}/save`, viewer.token)).json();
  assert.equal(saved.data.is_saved, true);
  // Der entscheidende Punkt: Merken belegt keinen Platz.
  assert.equal(saved.data.is_joined, false);
  assert.equal(saved.data.participants_count, 1, 'nur der Host ist dabei');

  const list = await (await get('/api/activities/saved', viewer.token)).json();
  assert.equal(list.data.length, 1);
  assert.equal(list.data[0].id, activity.id);

  // Auch die normale Liste weiss davon.
  const all = await (await get('/api/activities', viewer.token)).json();
  assert.equal(all.data.find((row) => row.id === activity.id).is_saved, true);

  // Zweimal merken bleibt einmal gemerkt.
  await post(`/api/activities/${activity.id}/save`, viewer.token);
  const stillOne = await (await get('/api/activities/saved', viewer.token)).json();
  assert.equal(stillOne.data.length, 1);

  const removed = await (await del(`/api/activities/${activity.id}/save`, viewer.token)).json();
  assert.equal(removed.data.is_saved, false);
  const empty = await (await get('/api/activities/saved', viewer.token)).json();
  assert.deepEqual(empty.data, []);
});

/* ---------------------------------------------------------- Gruppe umbenennen */

test('umbenennen darf nur, wer die Gruppe angelegt hat', async () => {
  const owner = await registerUser('renameowner');
  const member = await registerUser('renamemember');
  const group = await makeGroup(owner, member);

  assert.equal((await patch(`/api/groups/${group.id}`, member.token, { name: 'Meine Runde' })).status, 403);

  const res = await patch(`/api/groups/${group.id}`, owner.token, {
    name: 'Donnerstagsrunde',
    description: 'Neuer Anlass',
  });
  assert.equal(res.status, 200);
  const updated = (await res.json()).data;
  assert.equal(updated.name, 'Donnerstagsrunde');
  assert.equal(updated.description, 'Neuer Anlass');

  assert.equal((await patch(`/api/groups/${group.id}`, owner.token, { name: '  ' })).status, 422);
});
