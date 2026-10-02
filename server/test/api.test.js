/**
 * Integrationstest der neuen Endpunkte gegen die echte Datenbank.
 * Startet die Express-App auf einem freien Port, legt Wegwerf-Nutzer an und
 * raeumt am Ende alles wieder weg.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { createApp } from '../src/app.js';
import { FUNCTIONAL_WRITE_LIMITS } from './support/app.js';
import { ensureSchema, first, pool } from '../src/db.js';
import { createUser, deleteTestUsers } from './support/fixtures.js';
import { PNG_1X1 } from './support/images.js';

// Diese Tests pruefen die Kontostufen-Regeln. In der App sind die Stufen gerade
// ausgeblendet (server/src/features.js) – hier werden sie ausdruecklich wieder
// eingeschaltet, sonst gaebe es nichts zu pruefen. Wird pro Anfrage gelesen.
process.env.FEATURE_ACCOUNT_TIERS = 'true';

let base;
let server;
const createdUserIds = [];
const createdActivityIds = [];

/**
 * Legt einen Wegwerf-Nutzer an und liefert {token, user}.
 *
 * Voreinstellung ist 'creator': Fast jeder Test hier legt Events an, und das
 * darf ein 'standard'-Konto absichtlich nicht. Wer die Sperre selbst pruefen
 * will, uebergibt 'standard'.
 *
 * The account and its token are written straight to the database with the
 * wanted tier (test/support/fixtures.js), the way an admin would grant it:
 * sign-up belongs to Laravel. (Node's copies of sign-up, GET/PATCH /api/user,
 * progress and leaderboard are deleted; their tests moved to api/tests/Feature:
 * RegisterTest, UserProfileTest, ProgressTest.)
 */
const registerUser = (prefix, accountType = 'creator') =>
  createUser(prefix, { accountType, created: createdUserIds });

/** Hebt einen Nutzer auf eine Kontostufe (direkt in der DB, ohne Admin-Umweg). */
const setAccountType = (userId, type) =>
  pool.query('UPDATE users SET account_type = ? WHERE id = ?', [type, userId]);

/** The tier stored for an account (read from the database: GET /api/user belongs to Laravel). */
const accountTypeOf = async (userId) =>
  (await first('SELECT account_type FROM users WHERE id = ?', [userId]))?.account_type;

/** POST/DELETE auf die Hervorheben-Endpunkte. */
const boost = (token, id, method = 'POST') =>
  fetch(`${base}/api/business/activities/${id}/boost`, {
    method,
    headers: { Authorization: `Bearer ${token}` },
  });

/** Legt ein Event an – ohne Erwartung an den Status (fuer die Creator-Sperre). */
async function tryCreateActivity(token, title) {
  const form = new FormData();
  form.append('title', title);
  form.append('description', 'Testbeschreibung');
  form.append('location', 'Teststrasse 1, 50667 Koeln');
  form.append('starts_at', new Date(Date.now() + 86400000).toISOString());
  return fetch(`${base}/api/activities`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
}

async function createActivity(token, title) {
  const res = await tryCreateActivity(token, title);
  assert.equal(res.status, 201, 'Activity anlegen muss klappen');
  const body = await res.json();
  createdActivityIds.push(body.data.id);
  return body.data;
}

const get = (path, token) =>
  fetch(`${base}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

/** Macht einen frisch registrierten Wegwerf-Nutzer zum Admin. */
const makeAdmin = (userId) => pool.query('UPDATE users SET is_admin = 1 WHERE id = ?', [userId]);

before(async () => {
  await ensureSchema();
  server = createApp({ writeLimits: FUNCTIONAL_WRITE_LIMITS }).listen(0);
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
    await deleteTestUsers(pool, createdUserIds);
  } finally {
    await pool.end();
    server?.close();
  }
});

test('POST /api/activities/:id/view zaehlt Aufrufe, aber pro Person nur einmal', async () => {
  const host = await registerUser('viewh');
  const visitor = await registerUser('viewv');
  const activity = await createActivity(host.token, 'View-Test');

  const first = await fetch(`${base}/api/activities/${activity.id}/view`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${visitor.token}` },
  });
  assert.equal(first.status, 200);
  assert.equal((await first.json()).views_count, 1);

  const second = await fetch(`${base}/api/activities/${activity.id}/view`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${visitor.token}` },
  });
  assert.equal((await second.json()).views_count, 1, 'derselbe Nutzer darf nicht doppelt zaehlen');
});

test('Aufrufe des eigenen Events zaehlen nicht mit', async () => {
  const host = await registerUser('viewself');
  const activity = await createActivity(host.token, 'Self-View-Test');
  const res = await fetch(`${base}/api/activities/${activity.id}/view`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${host.token}` },
  });
  assert.equal((await res.json()).views_count, 0);
});

test('GET /api/activities liefert views_count mit', async () => {
  const host = await registerUser('viewlist');
  const visitor = await registerUser('viewlist2');
  const activity = await createActivity(host.token, 'List-View-Test');
  await fetch(`${base}/api/activities/${activity.id}/view`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${visitor.token}` },
  });
  const body = await (await get('/api/activities', host.token)).json();
  const found = body.data.find((a) => a.id === activity.id);
  assert.equal(found.views_count, 1);
});

test('POST /api/activities/:id/view auf ein unbekanntes Event ergibt 404', async () => {
  const { token } = await registerUser('view404');
  const res = await fetch(`${base}/api/activities/999999999/view`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 404);
});

// --- Events anlegen: erst ab Creator ----------------------------------------

test('POST /api/activities: ein Standard-Konto darf keine Events anlegen', async () => {
  const { token } = await registerUser('nocreate', 'standard');
  const res = await tryCreateActivity(token, 'Darf-nicht-Test');
  assert.equal(res.status, 403);
  assert.match((await res.json()).message, /Creator/);
});

test('POST /api/activities: ein Creator-Konto darf', async () => {
  const { token } = await registerUser('cancreate', 'creator');
  const res = await tryCreateActivity(token, 'Darf-Test');
  assert.equal(res.status, 201);
  createdActivityIds.push((await res.json()).data.id);
});

test('POST /api/activities: Admins duerfen auch mit Standard-Konto anlegen', async () => {
  // Admins verteilen die Stufen und muessen jede pruefen koennen, ohne sich
  // selbst auszusperren (siehe src/accounts.js).
  const { token, user } = await registerUser('admincreate', 'standard');
  await makeAdmin(user.id);
  const res = await tryCreateActivity(token, 'Admin-Standard-Test');
  assert.equal(res.status, 201);
  createdActivityIds.push((await res.json()).data.id);
});

// --- Business-Bereich: Zahlen und Hervorheben --------------------------------

test('GET /api/business/insights: gehoert den Business-Stufen', async () => {
  const { token, user } = await registerUser('bizgate', 'creator');
  assert.equal((await get('/api/business/insights', token)).status, 403);

  await setAccountType(user.id, 'business');
  assert.equal((await get('/api/business/insights', token)).status, 200);
});

test('GET /api/business/insights ohne Anmeldung ist nicht erlaubt', async () => {
  assert.equal((await get('/api/business/insights')).status, 401);
});

test('GET /api/business/insights zaehlt Aufrufe und Buchungen der eigenen Events', async () => {
  const host = await registerUser('bizhost', 'creator');
  const guest = await registerUser('bizguest', 'standard');
  const activity = await createActivity(host.token, 'Business-Zahlen-Test');

  await fetch(`${base}/api/activities/${activity.id}/view`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${guest.token}` },
  });
  await fetch(`${base}/api/activities/${activity.id}/join`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${guest.token}` },
  });

  await setAccountType(host.user.id, 'business');
  const body = await (await get('/api/business/insights', host.token)).json();

  assert.equal(body.months, 3, 'Business blickt 3 Monate zurueck');
  assert.equal(body.boost.slots, 1);
  assert.equal(body.revenue.available, false, 'ohne Bezahl-Events gibt es keinen Umsatz');
  assert.equal(body.revenue.gross_cents, 0);
  assert.ok(body.revenue.reason, 'der Grund muss dabeistehen');
  assert.ok(body.reach.views >= 1);
  assert.ok(body.reach.visitors >= 1);
  assert.ok(body.bookings.total >= 1, 'der Beitritt des Gastes muss zaehlen');
  assert.equal(body.bookings.series.length, 3, 'eine Reihe ohne Luecken');

  const mine = body.events.find((e) => e.id === activity.id);
  assert.ok(mine, 'das eigene Event muss in der Liste stehen');
  assert.equal(mine.views, 1);
  assert.equal(mine.bookings, 1, 'der eigene Platz zaehlt nicht als Buchung');
});

test('GET /api/business/insights: Business Plus blickt weiter zurueck', async () => {
  const { token, user } = await registerUser('bizplus', 'creator');
  await setAccountType(user.id, 'business_plus');
  const body = await (await get('/api/business/insights', token)).json();
  assert.equal(body.months, 12);
  assert.equal(body.boost.slots, 5);
  assert.equal(body.reach.series.length, 12);
});

test('Hervorheben: Business hat einen Platz, der zweite wird abgelehnt', async () => {
  const host = await registerUser('boosth', 'creator');
  const first = await createActivity(host.token, 'Boost-Test 1');
  const second = await createActivity(host.token, 'Boost-Test 2');
  await setAccountType(host.user.id, 'business');

  const on = await boost(host.token, first.id);
  assert.equal(on.status, 200);
  assert.ok((await on.json()).boosted_until, 'ein Ende-Zeitpunkt muss zurueckkommen');

  // Das Event traegt die Hervorhebung auch in der normalen Liste – daran haengt
  // die Sortierung in der App.
  const list = await (await get('/api/activities', host.token)).json();
  assert.ok(list.data.find((a) => a.id === first.id).boosted_until);

  const tooMany = await boost(host.token, second.id);
  assert.equal(tooMany.status, 422);

  const off = await boost(host.token, first.id, 'DELETE');
  assert.equal(off.status, 200);
  assert.equal((await off.json()).boosted_until, null);

  const now = await boost(host.token, second.id);
  assert.equal(now.status, 200, 'nach dem Freigeben ist der Platz wieder frei');
});

test('Hervorheben: dasselbe Event nochmal verlaengern geht', async () => {
  const host = await registerUser('boostagain', 'creator');
  const activity = await createActivity(host.token, 'Boost-Verlaengern-Test');
  await setAccountType(host.user.id, 'business');

  assert.equal((await boost(host.token, activity.id)).status, 200);
  assert.equal((await boost(host.token, activity.id)).status, 200, 'der eigene Boost darf nicht blockieren');
});

test('Hervorheben: fremde Events sind tabu', async () => {
  const owner = await registerUser('boostown', 'creator');
  const other = await registerUser('boostother', 'creator');
  const activity = await createActivity(owner.token, 'Boost-Fremd-Test');
  await setAccountType(other.user.id, 'business');

  assert.equal((await boost(other.token, activity.id)).status, 403);
});

test('Hervorheben: ohne Business-Stufe gar nicht', async () => {
  const host = await registerUser('boostcreator', 'creator');
  const activity = await createActivity(host.token, 'Boost-Ohne-Stufe-Test');
  assert.equal((await boost(host.token, activity.id)).status, 403);
});

test('Hervorheben: unbekanntes Event ergibt 404', async () => {
  const { token, user } = await registerUser('boost404', 'creator');
  await setAccountType(user.id, 'business');
  assert.equal((await boost(token, 999999999)).status, 404);
});

// --- Oeffentliches Profil, Beitraege und Social-Links ------------------------
//
// AI moderation is switched off for these suites (test/test.env, MODERATION_ENABLED=false), so
// posts go through without a model call: this tests the access logic, not the AI's verdict
// (that is test/moderation.test.js).

/** Schreibt einen Beitrag (multipart, wie die App). */
const createPost = (token, body) => {
  const form = new FormData();
  form.append('body', body);
  return fetch(`${base}/api/posts`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
};

const putLinks = (token, links) =>
  fetch(`${base}/api/me/links`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ links }),
  });

const deletePost = (token, id) =>
  fetch(`${base}/api/posts/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });

test('GET /api/users/:username: ein Creator hat ein Profil, das andere sehen', async () => {
  const owner = await registerUser('profowner', 'creator');
  const other = await registerUser('profother', 'creator');

  const res = await get(`/api/users/${owner.user.username}`, other.token);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.user.username, owner.user.username);
  assert.equal(body.user.account_type, 'creator');
  assert.equal(body.is_me, false);
  assert.deepEqual(body.posts, []);
  assert.deepEqual(body.links, []);
});

test('GET /api/users/:username: das eigene Profil ist als solches markiert', async () => {
  const { token, user } = await registerUser('profself', 'creator');
  const body = await (await get(`/api/users/${user.username}`, token)).json();
  assert.equal(body.is_me, true);
});

test('GET /api/users/:username: ein Standard-Konto hat eine Visitenkarte ohne Beitraege', async () => {
  // Seit der Freunde-Bereich zu Profilen fuehrt, waere ein 404 hier eine
  // Sackgasse mitten im Ablauf. Die Seite gibt es also – nur ohne Beitraege und
  // Social-Links, denn die gibt es erst ab Creator (siehe routes/profile.js).
  const standard = await registerUser('profstd', 'standard');
  const viewer = await registerUser('profview', 'creator');

  const res = await get(`/api/users/${standard.user.username}`, viewer.token);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.shows_posts, false);
  assert.deepEqual(body.posts, []);
  assert.deepEqual(body.links, []);
});

test('GET /api/users/:username: ab Creator zeigt das Profil Beitraege', async () => {
  const creator = await registerUser('profshows', 'creator');
  const body = await (await get(`/api/users/${creator.user.username}`, creator.token)).json();
  assert.equal(body.shows_posts, true);
});

test('GET /api/users/:username: unbekannter Name ergibt 404', async () => {
  const { token } = await registerUser('prof404', 'creator');
  assert.equal((await get('/api/users/gibtesnicht12345', token)).status, 404);
});

test('GET /api/users/:username ohne Anmeldung ist nicht erlaubt', async () => {
  const { user } = await registerUser('profanon', 'creator');
  assert.equal((await get(`/api/users/${user.username}`)).status, 401);
});

test('GET /api/users?q=: findet Leute ueber Name und Benutzernamen', async () => {
  const target = await registerUser('suchziel', 'standard');
  const seeker = await registerUser('suchender', 'creator');

  const body = await (await get(`/api/users?q=suchziel`, seeker.token)).json();
  const hit = body.data.find((row) => row.id === target.user.id);
  assert.ok(hit, 'der gesuchte Treffer fehlt');
  assert.equal(hit.username, target.user.username);
  assert.equal(hit.friendship, 'none');
  // Die Suche gibt nur weiter, was auf einer Visitenkarte steht – keine E-Mail.
  assert.equal(hit.email, undefined);
});

test('GET /api/users?q=: man findet sich nicht selbst', async () => {
  const { token, user } = await registerUser('suchselbst', 'creator');
  const body = await (await get(`/api/users?q=suchselbst`, token)).json();
  assert.equal(
    body.data.some((row) => row.id === user.id),
    false,
  );
});

test('GET /api/users?q=: ein zu kurzes Suchwort liefert nichts', async () => {
  // Eine Suche ohne Suchwort waere ein Verzeichnis aller Konten.
  const { token } = await registerUser('suchkurz', 'creator');
  assert.deepEqual((await (await get('/api/users?q=a', token)).json()).data, []);
  assert.deepEqual((await (await get('/api/users', token)).json()).data, []);
});

test('POST /api/posts: ein Creator schreibt einen Beitrag, er steht im Profil', async () => {
  const { token, user } = await registerUser('postcreate', 'creator');

  const res = await createPost(token, 'Mein erster Beitrag');
  assert.equal(res.status, 201);
  const created = (await res.json()).data;
  assert.equal(created.body, 'Mein erster Beitrag');
  assert.equal(created.image_url, null);

  const profile = await (await get(`/api/users/${user.username}`, token)).json();
  assert.equal(profile.posts.length, 1);
  assert.equal(profile.posts[0].id, created.id);
  assert.equal(profile.stats.posts, 1);
});

test('POST /api/posts: neueste Beitraege stehen oben', async () => {
  const { token, user } = await registerUser('postorder', 'creator');
  const first = (await (await createPost(token, 'aelter')).json()).data;
  const second = (await (await createPost(token, 'neuer')).json()).data;

  const profile = await (await get(`/api/users/${user.username}`, token)).json();
  assert.deepEqual(
    profile.posts.map((p) => p.id),
    [second.id, first.id],
  );
});

test('POST /api/posts: ein Standard-Konto darf nicht posten', async () => {
  const { token } = await registerUser('poststd', 'standard');
  assert.equal((await createPost(token, 'Darf ich nicht')).status, 403);
});

test('POST /api/posts: ohne Text geht es nicht', async () => {
  const { token } = await registerUser('postleer', 'creator');
  const res = await createPost(token, '   ');
  assert.equal(res.status, 422);
  assert.ok((await res.json()).errors.body);
});

test('POST /api/posts: zu lange Beitraege werden abgelehnt', async () => {
  const { token } = await registerUser('postlang', 'creator');
  const res = await createPost(token, 'a'.repeat(1001));
  assert.equal(res.status, 422);
  assert.ok((await res.json()).errors.body);
});

test('DELETE /api/posts/:id: den eigenen Beitrag loeschen geht', async () => {
  const { token, user } = await registerUser('postdel', 'creator');
  const post = (await (await createPost(token, 'weg damit')).json()).data;

  assert.equal((await deletePost(token, post.id)).status, 200);
  const profile = await (await get(`/api/users/${user.username}`, token)).json();
  assert.deepEqual(profile.posts, []);
});

test('DELETE /api/posts/:id: fremde Beitraege sind tabu', async () => {
  const owner = await registerUser('postmine', 'creator');
  const stranger = await registerUser('poststranger', 'creator');
  const post = (await (await createPost(owner.token, 'meins')).json()).data;

  assert.equal((await deletePost(stranger.token, post.id)).status, 403);
});

test('DELETE /api/posts/:id: ein Admin darf aufraeumen', async () => {
  const owner = await registerUser('postadminown', 'creator');
  const admin = await registerUser('postadmin', 'creator');
  await makeAdmin(admin.user.id);
  const post = (await (await createPost(owner.token, 'unfug')).json()).data;

  assert.equal((await deletePost(admin.token, post.id)).status, 200);
});

test('DELETE /api/posts/:id: unbekannter Beitrag ergibt 404', async () => {
  const { token } = await registerUser('post404', 'creator');
  assert.equal((await deletePost(token, 999999999)).status, 404);
});

test('PUT /api/me/links: Links setzen, ersetzen und leeren', async () => {
  const { token, user } = await registerUser('links', 'creator');

  const set = await putLinks(token, [
    { platform: 'instagram', url: 'https://instagram.com/goenn4fun' },
    { platform: 'website', url: 'https://goenn4fun.de' },
  ]);
  assert.equal(set.status, 200);
  assert.equal((await set.json()).links.length, 2);

  // Ersetzen: Was nicht mitkommt, ist danach weg.
  const replaced = await putLinks(token, [{ platform: 'tiktok', url: 'https://tiktok.com/@goenn' }]);
  assert.deepEqual((await replaced.json()).links, [
    { platform: 'tiktok', url: 'https://tiktok.com/@goenn' },
  ]);

  const profile = await (await get(`/api/users/${user.username}`, token)).json();
  assert.deepEqual(profile.links, [{ platform: 'tiktok', url: 'https://tiktok.com/@goenn' }]);

  assert.deepEqual((await (await putLinks(token, [])).json()).links, []);
});

test('PUT /api/me/links: fremde Schemata werden abgelehnt', async () => {
  const { token } = await registerUser('linksbad', 'creator');
  const res = await putLinks(token, [{ platform: 'website', url: 'javascript:alert(1)' }]);
  assert.equal(res.status, 422);
  assert.ok((await res.json()).errors.links);
});

test('PUT /api/me/links: unbekannte Plattformen werden abgelehnt', async () => {
  const { token } = await registerUser('linksunk', 'creator');
  assert.equal(
    (await putLinks(token, [{ platform: 'myspace', url: 'https://myspace.com/x' }])).status,
    422,
  );
});

test('PUT /api/me/links: ein Standard-Konto hat keine Links zu pflegen', async () => {
  const { token } = await registerUser('linksstd', 'standard');
  assert.equal(
    (await putLinks(token, [{ platform: 'website', url: 'https://goenn4fun.de' }])).status,
    403,
  );
});

test('PUT /api/me/links: eine abgelehnte Liste laesst die alten Links stehen', async () => {
  const { token, user } = await registerUser('linkskeep', 'creator');
  await putLinks(token, [{ platform: 'website', url: 'https://goenn4fun.de' }]);

  // Zweiter Eintrag ist kaputt -> die ganze Liste wird abgelehnt, nichts wird
  // geloescht. Ohne Transaktion stuende hier ein leeres Profil.
  const res = await putLinks(token, [
    { platform: 'instagram', url: 'https://instagram.com/ok' },
    { platform: 'website', url: 'ftp://nope.de' },
  ]);
  assert.equal(res.status, 422);

  const profile = await (await get(`/api/users/${user.username}`, token)).json();
  assert.deepEqual(profile.links, [{ platform: 'website', url: 'https://goenn4fun.de' }]);
});

/* ------------------------------------- Profilbild und Karten-Hintergrund */

// PNG_1X1: a valid 1x1 PNG from test/support/images.js (the one written here before was malformed).

/** Setzt Profilbild ('avatar') oder Karten-Hintergrund ('banner') – multipart, wie die App. */
const putProfileImage = (token, kind, { mime = 'image/png', name = 'bild.png', withFile = true } = {}) => {
  const form = new FormData();
  if (withFile) form.append('image', new Blob([PNG_1X1], { type: mime }), name);
  return fetch(`${base}/api/me/${kind}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
};

/** Nimmt ein Bild wieder ab. Raeumt zugleich die Testdateien weg. */
const dropProfileImage = (token, kind) =>
  fetch(`${base}/api/me/${kind}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });

/** Aus der Adresse den Pfad auf der Platte machen (…/storage/avatars/x.png). */
const storagePathOf = (url) =>
  path.join(process.cwd(), 'storage', url.slice(url.indexOf('/storage/') + '/storage/'.length));

test('POST /api/me/avatar: setzt das Profilbild und liefert eine volle Adresse', async () => {
  const { token } = await registerUser('avatarset', 'creator');

  const res = await putProfileImage(token, 'avatar');
  assert.equal(res.status, 200);
  const { user } = await res.json();
  // Die App setzt den Wert unveraendert in ein <Image> – ein relativer Pfad
  // waere dort nichts wert (siehe src/media.js).
  assert.match(user.avatar, /^https?:\/\/.+\/storage\/avatars\/[0-9a-f]+\.png$/);
  assert.ok(fs.existsSync(storagePathOf(user.avatar)), 'die Datei muss auf der Platte liegen');

  assert.equal((await dropProfileImage(token, 'avatar')).status, 200);
});

test('POST /api/me/banner: das Banner steht auch im oeffentlichen Profil', async () => {
  const { token, user } = await registerUser('bannerset', 'creator');

  const res = await putProfileImage(token, 'banner');
  assert.equal(res.status, 200);
  assert.match((await res.json()).user.banner, /\/storage\/user-banners\/[0-9a-f]+\.png$/);

  // Der Banner gehoert zum Auftritt: Wer das Profil ansieht, sieht ihn auch.
  const viewer = await registerUser('bannerview', 'creator');
  const profile = await (await get(`/api/users/${user.username}`, viewer.token)).json();
  assert.match(profile.user.banner, /\/storage\/user-banners\//);

  await dropProfileImage(token, 'banner');
});

test('POST /api/me/avatar: das zweite Bild raeumt das erste weg', async () => {
  const { token } = await registerUser('avatarswap', 'creator');

  const first = (await (await putProfileImage(token, 'avatar')).json()).user.avatar;
  const second = (await (await putProfileImage(token, 'avatar')).json()).user.avatar;
  assert.notEqual(first, second, 'ein neues Bild bekommt einen neuen Namen');
  assert.equal(fs.existsSync(storagePathOf(first)), false, 'das alte Bild muss weg sein');

  await dropProfileImage(token, 'avatar');
});

test('DELETE /api/me/banner: danach ist das Banner weg – Datei und Eintrag', async () => {
  const { token } = await registerUser('bannerdel', 'creator');
  const url = (await (await putProfileImage(token, 'banner')).json()).user.banner;

  const res = await dropProfileImage(token, 'banner');
  assert.equal(res.status, 200);
  assert.equal((await res.json()).user.banner, null);
  assert.equal(fs.existsSync(storagePathOf(url)), false);

  // Nichts zu entfernen ist kein Fehler – danach ist ohnehin keins da.
  assert.equal((await dropProfileImage(token, 'banner')).status, 200);
});

test('POST /api/me/avatar: auch ein Standard-Konto darf ein Profilbild setzen', async () => {
  // Anders als Beitraege und Social-Links haengt das NICHT an der Kontostufe:
  // Ein Gesicht gehoert zu jedem Konto (siehe routes/profile.js).
  const { token } = await registerUser('avatarstd', 'standard');
  const res = await putProfileImage(token, 'avatar');
  assert.equal(res.status, 200);
  await dropProfileImage(token, 'avatar');
});

test('POST /api/me/avatar: ohne Bild und mit fremdem Dateityp gibt es 422', async () => {
  const { token } = await registerUser('avatarbad', 'creator');

  const leer = await putProfileImage(token, 'avatar', { withFile: false });
  assert.equal(leer.status, 422);
  assert.ok((await leer.json()).errors.image);

  const falsch = await putProfileImage(token, 'avatar', { mime: 'application/pdf', name: 'x.pdf' });
  assert.equal(falsch.status, 422);
  assert.ok((await falsch.json()).errors.image);
});

test('POST /api/me/avatar ohne Anmeldung ist nicht erlaubt', async () => {
  const form = new FormData();
  form.append('image', new Blob([PNG_1X1], { type: 'image/png' }), 'bild.png');
  const res = await fetch(`${base}/api/me/avatar`, { method: 'POST', body: form });
  assert.equal(res.status, 401);
});

test('GET /api/users/:username: ohne Bilder stehen dort null-Werte', async () => {
  const { token, user } = await registerUser('noimages', 'creator');
  const body = await (await get(`/api/users/${user.username}`, token)).json();
  assert.equal(body.user.avatar, null);
  assert.equal(body.user.banner, null);
});

test('GET /api/users/:username: die Zahlen zaehlen Veranstaltetes und Mitgemachtes', async () => {
  const host = await registerUser('statshost', 'creator');
  const guest = await registerUser('statsguest', 'creator');
  const activity = await createActivity(host.token, 'Zahlen-Event');

  await fetch(`${base}/api/activities/${activity.id}/join`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${guest.token}` },
  });

  const hostProfile = await (await get(`/api/users/${host.user.username}`, guest.token)).json();
  assert.equal(hostProfile.stats.hosted, 1);
  // Der eigene Auto-Beitritt zaehlt nicht als "mitgemacht".
  assert.equal(hostProfile.stats.joined, 0);

  const guestProfile = await (await get(`/api/users/${guest.user.username}`, host.token)).json();
  assert.equal(guestProfile.stats.hosted, 0);
  assert.equal(guestProfile.stats.joined, 1);
});

test('GET /api/activities: der Host bringt seine Stufe mit', async () => {
  // Danach entscheidet die App, ob sich der Name zum Profil verlinken laesst.
  const { token, user } = await registerUser('hosttier', 'creator');
  await createActivity(token, 'Stufen-Event');

  const body = await (await get('/api/activities', token)).json();
  const mine = body.data.find((a) => a.host?.id === user.id);
  assert.equal(mine.host.account_type, 'creator');
});

/* ---------------------------------------------------------------- Praemien */

const post = (path, token, body) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

const del = (path, token) =>
  fetch(`${base}${path}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });

test('GET /api/me/rewards: ein neues Konto steht bei 0 Punkten', async () => {
  const { token } = await registerUser('rewnew', 'creator');
  const body = await (await get('/api/me/rewards', token)).json();
  assert.equal(body.points.balance, 0);
  assert.equal(body.pointsPerActivity, 10);
  assert.ok(body.coupons.length > 0, 'der Katalog kommt mit');
  assert.deepEqual(body.redemptions, []);
});

test('POST /api/activities: ein erstelltes Event bringt 10 Punkte', async () => {
  const { token } = await registerUser('rewearn', 'creator');
  await createActivity(token, 'Punkte-Event 1');
  await createActivity(token, 'Punkte-Event 2');

  const body = await (await get('/api/me/rewards', token)).json();
  assert.equal(body.points.earned, 20);
  assert.equal(body.points.balance, 20);
});

test('GET /api/me/rewards traegt Punkte fuer Bestands-Events nach', async () => {
  // Genau der Fall eines Bestandskontos: Das Event stand vor dem Punktesystem da.
  const { token, user } = await registerUser('rewback', 'creator');
  await createActivity(token, 'Nachtrag-Event');
  await pool.query('DELETE FROM reward_points WHERE user_id = ?', [user.id]);

  const firstLook = await (await get('/api/me/rewards', token)).json();
  assert.equal(firstLook.points.earned, 10);

  // Und der zweite Blick verdoppelt nichts.
  const secondLook = await (await get('/api/me/rewards', token)).json();
  assert.equal(secondLook.points.earned, 10);
});

test('POST /api/me/rewards/redeem: ohne genug Punkte gibt es 422 mit der Luecke', async () => {
  const { token } = await registerUser('rewpoor', 'creator');
  const res = await post('/api/me/rewards/redeem', token, { coupon: 'kaffee' });
  assert.equal(res.status, 422);
  assert.match((await res.json()).message, /fehlen noch 50 Punkte/);
});

test('POST /api/me/rewards/redeem: mit genug Punkten kommt ein Code und der Stand sinkt', async () => {
  const { token } = await registerUser('rewrich', 'creator');
  for (let i = 0; i < 5; i += 1) {
    await createActivity(token, `Reich-Event ${i}`);
  }

  const res = await post('/api/me/rewards/redeem', token, { coupon: 'kaffee' });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.data.coupon_slug, 'kaffee');
  assert.equal(body.data.points, 50);
  assert.match(body.data.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(body.points.balance, 0);

  // Der Coupon steht danach in der eigenen Liste.
  const after = await (await get('/api/me/rewards', token)).json();
  assert.equal(after.redemptions.length, 1);
  assert.equal(after.redemptions[0].code, body.data.code);
  assert.equal(after.redemptions[0].title, 'Kaffee aufs Haus');

  // Und ein zweites Mal geht nicht mehr â€“ die Punkte sind ausgegeben.
  assert.equal((await post('/api/me/rewards/redeem', token, { coupon: 'kaffee' })).status, 422);
});

test('POST /api/me/rewards/redeem: eine unbekannte Praemie wird abgewiesen', async () => {
  const { token } = await registerUser('rewbogus', 'creator');
  assert.equal((await post('/api/me/rewards/redeem', token, { coupon: 'gold' })).status, 422);
});

/* ----------------------------------------------------------------- Freunde */

test('POST /api/friends: anfragen, dann annehmen - beide sind befreundet', async () => {
  const a = await registerUser('frienda', 'creator');
  const b = await registerUser('friendb', 'standard');

  const asked = await post('/api/friends', a.token, { user_id: b.user.id });
  assert.equal(asked.status, 201);
  assert.equal((await asked.json()).status, 'pending');

  // Bei B liegt die Anfrage eingehend, bei A ausgehend.
  const bBefore = await (await get('/api/friends', b.token)).json();
  assert.equal(bBefore.incoming.length, 1);
  assert.equal(bBefore.incoming[0].id, a.user.id);
  const aBefore = await (await get('/api/friends', a.token)).json();
  assert.equal(aBefore.outgoing.length, 1);

  // Dieselbe Anfrage aus der anderen Richtung IST die Zusage.
  const accepted = await post('/api/friends', b.token, { user_id: a.user.id });
  assert.equal((await accepted.json()).status, 'accepted');

  for (const person of [a, b]) {
    const body = await (await get('/api/friends', person.token)).json();
    assert.equal(body.friends.length, 1);
    assert.equal(body.incoming.length, 0);
    assert.equal(body.outgoing.length, 0);
  }
});

test('POST /api/friends: sich selbst anfragen geht nicht', async () => {
  const { token, user } = await registerUser('friendself', 'creator');
  assert.equal((await post('/api/friends', token, { user_id: user.id })).status, 422);
});

test('POST /api/friends: dieselbe Anfrage zweimal legt keine zweite Zeile an', async () => {
  const a = await registerUser('frienddupa', 'creator');
  const b = await registerUser('frienddupb', 'creator');
  await post('/api/friends', a.token, { user_id: b.user.id });
  const again = await post('/api/friends', a.token, { user_id: b.user.id });
  assert.equal(again.status, 200);
  assert.equal((await (await get('/api/friends', b.token)).json()).incoming.length, 1);
});

test('DELETE /api/friends/:id: beendet die Freundschaft in beide Richtungen', async () => {
  const a = await registerUser('frienddela', 'creator');
  const b = await registerUser('frienddelb', 'creator');
  await post('/api/friends', a.token, { user_id: b.user.id });
  await post('/api/friends', b.token, { user_id: a.user.id });

  assert.equal((await del(`/api/friends/${b.user.id}`, a.token)).status, 200);
  assert.equal((await (await get('/api/friends', a.token)).json()).friends.length, 0);
  assert.equal((await (await get('/api/friends', b.token)).json()).friends.length, 0);
});

test('GET /api/users?q=: der Beziehungszustand kommt mit', async () => {
  const a = await registerUser('frstatea', 'creator');
  const b = await registerUser('frstateb', 'creator');
  await post('/api/friends', a.token, { user_id: b.user.id });

  const fromA = await (await get(`/api/users?q=${b.user.username}`, a.token)).json();
  assert.equal(fromA.data.find((row) => row.id === b.user.id).friendship, 'outgoing');

  const fromB = await (await get(`/api/users?q=${a.user.username}`, b.token)).json();
  assert.equal(fromB.data.find((row) => row.id === a.user.id).friendship, 'incoming');
});

/* ----------------------------------------------------------------- Gruppen */

async function befriend(a, b) {
  await post('/api/friends', a.token, { user_id: b.user.id });
  await post('/api/friends', b.token, { user_id: a.user.id });
}

test('POST /api/groups: wer anlegt ist drin, Freunde kommen mit', async () => {
  const owner = await registerUser('grpowner', 'creator');
  const friend = await registerUser('grpfriend', 'creator');
  await befriend(owner, friend);

  const res = await post('/api/groups', owner.token, {
    name: 'Kickerrunde',
    description: 'Jeden Donnerstag',
    members: [friend.user.id],
  });
  assert.equal(res.status, 201);
  const group = (await res.json()).data;
  assert.equal(group.name, 'Kickerrunde');
  assert.equal(group.is_owner, true);
  assert.equal(group.members.length, 2);
  // Wer die Gruppe angelegt hat, steht zuerst.
  assert.equal(group.members[0].id, owner.user.id);

  // Und die Gruppe erscheint bei BEIDEN in der Liste.
  const forFriend = (await (await get('/api/groups', friend.token)).json()).data;
  assert.equal(forFriend.length, 1);
  assert.equal(forFriend[0].is_owner, false);
});

test('POST /api/groups: ohne Name gibt es 422', async () => {
  const { token } = await registerUser('grpnoname', 'creator');
  assert.equal((await post('/api/groups', token, { name: '  ' })).status, 422);
});

test('POST /api/groups/:id/members: nur bestaetigte Freunde kommen hinein', async () => {
  const owner = await registerUser('grpstricta', 'creator');
  const stranger = await registerUser('grpstrictb', 'creator');
  const created = await post('/api/groups', owner.token, { name: 'Nur Freunde' });
  const group = (await created.json()).data;

  const res = await post(`/api/groups/${group.id}/members`, owner.token, {
    user_id: stranger.user.id,
  });
  assert.equal(res.status, 422);

  await befriend(owner, stranger);
  const ok = await post(`/api/groups/${group.id}/members`, owner.token, {
    user_id: stranger.user.id,
  });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).data.members.length, 2);
});

test('Gruppen: wer nicht drin ist, findet sie nicht (404 statt 403)', async () => {
  const owner = await registerUser('grphidea', 'creator');
  const outsider = await registerUser('grphideb', 'creator');
  const created = await post('/api/groups', owner.token, { name: 'Geheim' });
  const group = (await created.json()).data;

  assert.equal((await del(`/api/groups/${group.id}`, outsider.token)).status, 404);
  assert.equal((await (await get('/api/groups', outsider.token)).json()).data.length, 0);
});

test('Gruppen: Mitglieder gehen selbst, entfernen aber niemand anderen', async () => {
  const owner = await registerUser('grpleavea', 'creator');
  const member = await registerUser('grpleaveb', 'creator');
  await befriend(owner, member);
  const created = await post('/api/groups', owner.token, {
    name: 'Verlassen',
    members: [member.user.id],
  });
  const group = (await created.json()).data;

  // Ein Mitglied darf die Person, die die Gruppe angelegt hat, nicht hinauswerfen.
  const kick = await del(`/api/groups/${group.id}/members/${owner.user.id}`, member.token);
  assert.equal(kick.status, 403);

  // Aber selbst gehen.
  const leave = await del(`/api/groups/${group.id}/members/${member.user.id}`, member.token);
  assert.equal(leave.status, 200);
  assert.equal((await (await get('/api/groups', member.token)).json()).data.length, 0);
});

test('Gruppen: wer sie angelegt hat, kann nicht aussteigen - nur loeschen', async () => {
  const owner = await registerUser('grpownerout', 'creator');
  const created = await post('/api/groups', owner.token, { name: 'Meins' });
  const group = (await created.json()).data;

  const leave = await del(`/api/groups/${group.id}/members/${owner.user.id}`, owner.token);
  assert.equal(leave.status, 422);
  assert.equal((await del(`/api/groups/${group.id}`, owner.token)).status, 200);
  assert.equal((await (await get('/api/groups', owner.token)).json()).data.length, 0);
});

test('Freundschaft beenden nimmt die Gruppen-Mitgliedschaft mit', async () => {
  // Sonst laese jemand in einer Gruppe weiter, in die man ihn nicht mehr
  // aufnehmen koennte.
  const owner = await registerUser('grpunfrienda', 'creator');
  const member = await registerUser('grpunfriendb', 'creator');
  await befriend(owner, member);
  const created = await post('/api/groups', owner.token, {
    name: 'Entfreundet',
    members: [member.user.id],
  });
  const group = (await created.json()).data;
  assert.equal(group.members.length, 2);

  await del(`/api/friends/${member.user.id}`, owner.token);
  assert.equal((await (await get('/api/groups', member.token)).json()).data.length, 0);
  const left = (await (await get('/api/groups', owner.token)).json()).data[0];
  assert.equal(left.members.length, 1);
});

/* ------------------------------------------------------------------ Storys */

test('GET /api/stories: leer, und can_publish folgt der Kontostufe', async () => {
  const creator = await registerUser('storycreator', 'creator');
  const standard = await registerUser('storystd', 'standard');

  const asCreator = await (await get('/api/stories', creator.token)).json();
  assert.equal(asCreator.can_publish, true);
  assert.ok(Array.isArray(asCreator.data));

  const asStandard = await (await get('/api/stories', standard.token)).json();
  assert.equal(asStandard.can_publish, false);
});

test('POST /api/stories: ein Standard-Konto darf keine Story anlegen', async () => {
  const { token } = await registerUser('storyblock', 'standard');
  const form = new FormData();
  form.append('caption', 'Hallo');
  const res = await fetch(`${base}/api/stories`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  assert.equal(res.status, 403);
});

test('POST /api/stories: ohne Bild gibt es 422', async () => {
  const { token } = await registerUser('storynoimg', 'creator');
  const form = new FormData();
  form.append('caption', 'Nur Text');
  const res = await fetch(`${base}/api/stories`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  assert.equal(res.status, 422);
  assert.ok((await res.json()).errors.image);
});

/**
 * Legt eine Story direkt in der Datenbank an.
 *
 * Der Weg ueber POST /api/stories braucht ein echtes Bild UND die
 * KI-Verifizierung (die einen Schluessel und einen Netzaufruf verlangt) – fuer
 * die Admin-Liste zaehlt nur, dass eine laufende Story in der Tabelle steht.
 */
async function insertStory(userId, caption) {
  const [res] = await pool.query(
    `INSERT INTO stories (user_id, caption, image_path, created_at, expires_at)
     VALUES (?, ?, 'stories/test.jpg', NOW(), DATE_ADD(NOW(), INTERVAL 24 HOUR))`,
    [userId, caption],
  );
  return res.insertId;
}

test('GET /api/admin/stories: nur fuer Admins, und Admins loeschen jede Story', async () => {
  const author = await registerUser('adminstoryauthor', 'creator');
  const admin = await registerUser('adminstoryadm', 'creator');
  await makeAdmin(admin.user.id);
  const storyId = await insertStory(author.user.id, 'Story im Admin-Panel');

  // Ein normales Konto kommt an die Liste nicht heran.
  assert.equal((await get('/api/admin/stories', author.token)).status, 403);

  const body = await (await get('/api/admin/stories', admin.token)).json();
  const mine = body.data.find((s) => s.id === storyId);
  assert.ok(mine, 'die laufende Story muss in der Liste stehen');
  assert.equal(mine.caption, 'Story im Admin-Panel');
  assert.equal(mine.user.id, author.user.id);
  assert.equal(mine.views, 0);

  // Loeschen laeuft ueber den bestehenden Endpunkt – fremde Story, aber Admin.
  assert.equal((await del(`/api/stories/${storyId}`, admin.token)).status, 200);
  const after = await (await get('/api/admin/stories', admin.token)).json();
  assert.equal(after.data.some((s) => s.id === storyId), false);
});

test('GET /api/admin/stories: abgelaufene Storys stehen nicht in der Liste', async () => {
  const author = await registerUser('adminstoryold', 'creator');
  const admin = await registerUser('adminstoryoldadm', 'creator');
  await makeAdmin(admin.user.id);
  const [res] = await pool.query(
    `INSERT INTO stories (user_id, caption, image_path, created_at, expires_at)
     VALUES (?, 'schon vorbei', 'stories/test.jpg', NOW(), DATE_SUB(NOW(), INTERVAL 1 HOUR))`,
    [author.user.id],
  );
  const body = await (await get('/api/admin/stories', admin.token)).json();
  assert.equal(body.data.some((s) => s.id === res.insertId), false);
});

/* --------------------------------------------------- Anfragen auf eine Stufe */

test('POST /api/me/upgrade-request: Standard fragt Creator an, Admin bestaetigt', async () => {
  const person = await registerUser('upgreq', 'standard');
  const admin = await registerUser('upgadm', 'creator');
  await makeAdmin(admin.user.id);

  const created = await post('/api/me/upgrade-request', person.token, {
    account_type: 'creator',
    billing_period: 'yearly',
    message: 'Ich moechte Events veranstalten.',
  });
  assert.equal(created.status, 201);
  const request = (await created.json()).data;
  assert.equal(request.status, 'pending');
  assert.equal(request.requested_type, 'creator');
  assert.equal(request.billing_period, 'yearly');

  // Die Anfrage taucht beim Admin auf – und die Kennzahl zaehlt sie mit.
  const list = await (await get('/api/admin/upgrade-requests', admin.token)).json();
  const mine = list.data.find((r) => r.id === request.id);
  assert.ok(mine, 'die offene Anfrage muss beim Admin stehen');
  assert.equal(mine.user.id, person.user.id);
  assert.equal(mine.message, 'Ich moechte Events veranstalten.');
  // Ohne den Rhythmus wuesste der Admin nicht, was angefragt wurde: "Creator"
  // sind 7,99 € im Monat oder 79,90 € im Jahr.
  assert.equal(mine.billing_period, 'yearly');
  assert.ok(list.pending >= 1);
  const stats = await (await get('/api/admin/stats', admin.token)).json();
  assert.ok(stats.totals.pending_requests >= 1);

  // Bestaetigen setzt die Stufe wirklich um.
  assert.equal((await post(`/api/admin/upgrade-requests/${request.id}/approve`, admin.token)).status, 200);
  assert.equal(await accountTypeOf(person.user.id), 'creator');
  const own = await (await get('/api/me/upgrade-request', person.token)).json();
  assert.equal(own.data.status, 'approved');
  // Creator ist jetzt erreicht, also bleiben nur die Business-Stufen uebrig.
  assert.deepEqual(own.requestable, ['business', 'business_plus']);

  // Zweimal entscheiden geht nicht.
  assert.equal((await post(`/api/admin/upgrade-requests/${request.id}/approve`, admin.token)).status, 422);
});

test('POST /api/admin/upgrade-requests/:id/reject: Grund landet bei der Person', async () => {
  const person = await registerUser('upgrej', 'standard');
  const admin = await registerUser('upgrejadm', 'creator');
  await makeAdmin(admin.user.id);

  const request = (
    await (await post('/api/me/upgrade-request', person.token, { account_type: 'business' })).json()
  ).data;
  const rejected = await post(`/api/admin/upgrade-requests/${request.id}/reject`, admin.token, {
    reason: 'Bitte erst ein Gewerbe nachweisen.',
  });
  assert.equal(rejected.status, 200);

  const own = await (await get('/api/me/upgrade-request', person.token)).json();
  assert.equal(own.data.status, 'rejected');
  assert.equal(own.data.decision_note, 'Bitte erst ein Gewerbe nachweisen.');
  // Die Stufe bleibt, wo sie war.
  assert.equal(await accountTypeOf(person.user.id), 'standard');
});

test('POST /api/me/upgrade-request: eine neue Anfrage ersetzt die alte', async () => {
  const person = await registerUser('upgagain', 'standard');
  const admin = await registerUser('upgagainadm', 'creator');
  await makeAdmin(admin.user.id);

  const first = (
    await (await post('/api/me/upgrade-request', person.token, { account_type: 'creator' })).json()
  ).data;
  await post(`/api/admin/upgrade-requests/${first.id}/reject`, admin.token, { reason: 'noch nicht' });

  // Nach der Ablehnung erneut fragen: dieselbe Zeile, wieder offen, ohne den
  // alten Ablehnungsgrund.
  const second = (
    await (await post('/api/me/upgrade-request', person.token, { account_type: 'business' })).json()
  ).data;
  assert.equal(second.id, first.id);
  assert.equal(second.status, 'pending');
  assert.equal(second.requested_type, 'business');
  assert.equal(second.decision_note, null);
});

test('POST /api/me/upgrade-request: ohne Rhythmus gilt monatlich, Unsinn wird abgelehnt', async () => {
  const person = await registerUser('upgperiod', 'standard');

  // Eine aeltere App-Version im Store kennt das Feld nicht. Ihre Anfragen muessen
  // weiter durchgehen – sonst kann diese Person keine Stufe mehr anfragen, und
  // der Fehler stuende in unserem Log statt in ihrem Bildschirm.
  const created = await post('/api/me/upgrade-request', person.token, { account_type: 'creator' });
  assert.equal(created.status, 201);
  assert.equal((await created.json()).data.billing_period, 'monthly');

  // Steht dagegen etwas drin, das es nicht gibt, wird nicht geraten: 'jaehrlich'
  // (verschrieben) waere sonst von einem gemeinten 'monthly' nicht zu
  // unterscheiden.
  const wrong = await post('/api/me/upgrade-request', person.token, {
    account_type: 'creator',
    billing_period: 'jaehrlich',
  });
  assert.equal(wrong.status, 422);

  // Und die vorhandene Anfrage bleibt, wie sie war.
  const own = await (await get('/api/me/upgrade-request', person.token)).json();
  assert.equal(own.data.billing_period, 'monthly');
});

test('POST /api/me/upgrade-request: ein neuer Rhythmus ersetzt den alten', async () => {
  const person = await registerUser('upgperiod2', 'standard');

  await post('/api/me/upgrade-request', person.token, {
    account_type: 'creator',
    billing_period: 'yearly',
  });
  // Wer sich umentscheidet, hat danach genau eine Anfrage – mit dem neuen
  // Rhythmus. Sonst stuende beim Admin weiter das Jahresabo.
  await post('/api/me/upgrade-request', person.token, {
    account_type: 'business',
    billing_period: 'monthly',
  });

  const own = await (await get('/api/me/upgrade-request', person.token)).json();
  assert.equal(own.data.requested_type, 'business');
  assert.equal(own.data.billing_period, 'monthly');
});

test('POST /api/me/upgrade-request: die eigene Stufe kann man nicht anfragen', async () => {
  const { token } = await registerUser('upgsame', 'creator');
  const res = await post('/api/me/upgrade-request', token, { account_type: 'creator' });
  assert.equal(res.status, 422);
  assert.ok((await res.json()).errors.account_type);

  // Und 'standard' ist keine Stufe, die man anfragt.
  assert.equal((await post('/api/me/upgrade-request', token, { account_type: 'standard' })).status, 422);
});

test('Anfragen brauchen eine Anmeldung, die Admin-Liste einen Admin', async () => {
  const person = await registerUser('upgguard', 'standard');
  assert.equal((await get('/api/me/upgrade-request')).status, 401);
  assert.equal((await get('/api/admin/upgrade-requests', person.token)).status, 403);
});
