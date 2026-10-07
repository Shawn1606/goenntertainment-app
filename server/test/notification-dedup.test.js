/**
 * Like/unlike and follow/unfollow loops notify the other person once (F-07), against the real
 * database.
 *
 * The routes notify only for a NEW like or follow, but after an unlike or unfollow the next one is
 * new again, so each cycle of a loop wrote another notification. The rule now (notifyOnce in
 * src/notifications.js): no new row while a notification with the same recipient, actor, type and
 * target exists. Withdrawing leaves the earlier one in place.
 *
 * The denominator is the first test: every statement that writes a notification row and every
 * call that reaches one, each with the reason why a loop can or cannot repeat it. A new call fails
 * that test until it is classified there. Covered by the route tests: the post like and the follow
 * (profile.js), and the event like (activities.js), which writes no notification at all and must
 * stay that way. Guards: the first like and follow still notify, the rule is per actor and per
 * target, and a block still refuses the like and the follow before anything is written.
 *
 * Posts and events are inserted directly (setup only); every like, unlike, follow and unfollow
 * goes through its HTTP route.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { createApp } from '../src/app.js';
import { FUNCTIONAL_WRITE_LIMITS } from './support/app.js';
import { ensureSchema, pool } from '../src/db.js';
import { createUser, deleteTestUsers } from './support/fixtures.js';

const ROOT = path.join(import.meta.dirname, '..', '..');

/**
 * Every call in server/src that writes a notification, as `<file> <function> <type>`, with the
 * reason a loop can or cannot repeat it. notifyOnce = at most one row per recipient, actor, type
 * and target; the others write a row per call. The event like (POST /api/activities/:id/like) has
 * no entry: it writes no notification.
 */
const EXPECTED_CALLS = {
  'routes/profile.js notifyOnce follow': 'follow/unfollow loop: repeatable, so once per follower',
  'routes/profile.js notifyOnce like': 'like/unlike loop on a post: repeatable, so once per fan and post',
  'routes/profile.js notifyQuietly comment': 'one row per comment; each comment is new, moderated text',
  'routes/profile.js notifyFollowers post': 'fan-out per new post; each post is new, moderated content',
  'routes/stories.js notifyFollowers story': 'fan-out per new story; each story is new, moderated content',
  'routes/activities.js notifyFollowers activity': 'fan-out per new event; each event is new, moderated content',
};

/** The statements that insert notification rows: notify() (via insertOne) and notifyMany(). */
const EXPECTED_INSERTS = ['server/src/notifications.js', 'server/src/notifications.js'];

const NOTIFY_CALL = /\b(notify|notifyQuietly|notifyOnce|notifyFollowers)\(/g;
const INSERT_NOTIFICATION = /\b(?:INSERT|REPLACE)\s+(?:IGNORE\s+)?INTO\s+`?notifications`?(?![\w`])|table\(\s*['"]notifications['"]\s*\)/gi;

function filesUnder(dir, extensions) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(full, extensions));
    else if (extensions.some((ext) => entry.name.endsWith(ext))) out.push(full);
  }
  return out;
}

const rel = (full) => path.relative(ROOT, full).split(path.sep).join('/');

/** Like/unlike or follow/unfollow cycles per loop: enough to show "one per cycle" plainly. */
const CYCLES = 5;

let base;
let server;
const createdUserIds = [];

/** A throw-away account with a token (test/support/fixtures.js; sign-up belongs to Laravel). */
const registerUser = (prefix) => createUser(prefix, { created: createdUserIds });

const send = (method, url, token) =>
  fetch(`${base}${url}`, { method, headers: { Authorization: `Bearer ${token}` } });

async function expectStatus(promise, status, what) {
  const res = await promise;
  assert.equal(res.status, status, `${what}: HTTP ${res.status}`);
  return res;
}

const likePost = (token, id) => expectStatus(send('POST', `/api/posts/${id}/like`, token), 200, 'like post');
const unlikePost = (token, id) => expectStatus(send('DELETE', `/api/posts/${id}/like`, token), 200, 'unlike post');
const followUser = (token, id) => expectStatus(send('POST', `/api/users/${id}/follow`, token), 200, 'follow');
const unfollowUser = (token, id) => expectStatus(send('DELETE', `/api/users/${id}/follow`, token), 200, 'unfollow');
const likeEvent = (token, id) => expectStatus(send('POST', `/api/activities/${id}/like`, token), 200, 'like event');
const unlikeEvent = (token, id) =>
  expectStatus(send('DELETE', `/api/activities/${id}/like`, token), 200, 'unlike event');

async function insertPost(userId) {
  const [result] = await pool.query(
    "INSERT INTO posts (user_id, body, created_at, updated_at) VALUES (?, 'Testbeitrag', NOW(), NOW())",
    [userId],
  );
  return result.insertId;
}

async function insertEvent(userId) {
  const [result] = await pool.query(
    `INSERT INTO activities (user_id, title, description, location, starts_at, created_at, updated_at)
     VALUES (?, 'Notify-Test', 'Testbeschreibung', 'Teststrasse 1, 50667 Koeln', NOW() + INTERVAL 1 DAY, NOW(), NOW())`,
    [userId],
  );
  return result.insertId;
}

/** The notification rows `recipientId` holds from `actorId` (optionally of one type), oldest first. */
async function notificationsFrom(recipientId, actorId, type = null) {
  const [rows] = await pool.query(
    `SELECT id, type, ref_id, title, read_at FROM notifications
      WHERE user_id = ? AND actor_id = ? AND (? IS NULL OR type = ?)
      ORDER BY id`,
    [recipientId, actorId, type, type],
  );
  return rows.map((row) => ({ ...row, ref_id: row.ref_id === null ? null : Number(row.ref_id) }));
}

before(async () => {
  await ensureSchema();
  server = createApp({ writeLimits: FUNCTIONAL_WRITE_LIMITS }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  // Notifications, posts, likes, follows and blocks go with the accounts (ON DELETE CASCADE).
  try {
    await deleteTestUsers(pool, createdUserIds);
  } finally {
    await pool.end();
    server?.close();
  }
});

test('the denominator: every notification write, and which ones a loop can repeat', () => {
  const serverFiles = filesUnder(path.join(ROOT, 'server', 'src'), ['.js', '.mjs']);
  const apiFiles = ['app', 'database', 'routes'].flatMap((dir) => filesUnder(path.join(ROOT, 'api', dir), ['.php']));
  assert.ok(serverFiles.length >= 30 && apiFiles.length >= 20, `${serverFiles.length} + ${apiFiles.length} files scanned`);

  const inserts = [];
  const calls = [];
  for (const file of [...serverFiles, ...apiFiles]) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(INSERT_NOTIFICATION)) inserts.push(rel(file));
    // Calls: in the server's JS files, outside the module that defines the functions.
    if (rel(file) === 'server/src/notifications.js' || !file.endsWith('.js')) continue;
    for (const m of text.matchAll(NOTIFY_CALL)) {
      // The `type` of this call's own object literal (up to its closing `})`).
      const args = text.slice(m.index, text.indexOf('})', m.index));
      const type = args.match(/\btype:\s*'([a-z_]+)'/)?.[1] ?? '?';
      calls.push(`${rel(file).replace('server/src/', '')} ${m[1]} ${type}`);
    }
  }
  console.log(`${serverFiles.length} server and ${apiFiles.length} api files scanned: ${inserts.length} INSERT statements, ${calls.length} calls`);
  for (const call of calls) console.log(`  ${call}: ${EXPECTED_CALLS[call] ?? 'NOT CLASSIFIED'}`);

  assert.deepEqual(inserts, EXPECTED_INSERTS, 'notification rows are written only in src/notifications.js');
  assert.deepEqual([...calls].sort(), Object.keys(EXPECTED_CALLS).sort(), 'classify every notification call here');
});

test('the first like on a post notifies its author, once', async () => {
  const author = await registerUser('ndauthor');
  const fan = await registerUser('ndfan');
  const postId = await insertPost(author.user.id);

  await likePost(fan.token, postId);

  const rows = await notificationsFrom(author.user.id, fan.user.id);
  assert.equal(rows.length, 1, `rows: ${JSON.stringify(rows)}`);
  assert.equal(rows[0].type, 'like');
  assert.equal(rows[0].ref_id, postId);
  assert.ok(rows[0].title.startsWith(fan.user.name), rows[0].title);

  // The author's bell shows it.
  const res = await expectStatus(
    fetch(`${base}/api/notifications`, { headers: { Authorization: `Bearer ${author.token}` } }),
    200,
    'notifications',
  );
  const body = await res.json();
  assert.equal(body.unread, 1);
  assert.deepEqual(
    body.data.map((n) => [n.type, n.ref_id, n.actor?.id]),
    [['like', postId, fan.user.id]],
  );
});

test(`a like/unlike loop on a post leaves exactly one notification (F-07, ${CYCLES} cycles)`, async () => {
  const author = await registerUser('ndauthor');
  const fan = await registerUser('ndfan');
  const postId = await insertPost(author.user.id);

  for (let i = 0; i < CYCLES; i += 1) {
    await likePost(fan.token, postId);
    await unlikePost(fan.token, postId);
  }
  const last = await (await likePost(fan.token, postId)).json();
  assert.equal(last.data.liked_by_me, true, 'the like itself still works');
  assert.equal(last.data.likes_count, 1);

  const rows = await notificationsFrom(author.user.id, fan.user.id);
  assert.equal(
    rows.length,
    1,
    `${CYCLES + 1} likes from one fan on one post wrote ${rows.length} notifications: ${JSON.stringify(rows.map((r) => r.type))}`,
  );
  assert.equal(rows[0].type, 'like');
  assert.equal(rows[0].ref_id, postId);
});

test('an unlike leaves the earlier like notification in place, and a read one stays read', async () => {
  const author = await registerUser('ndauthor');
  const fan = await registerUser('ndfan');
  const postId = await insertPost(author.user.id);

  await likePost(fan.token, postId);
  await expectStatus(
    fetch(`${base}/api/notifications/read`, { method: 'POST', headers: { Authorization: `Bearer ${author.token}` } }),
    200,
    'mark read',
  );
  await unlikePost(fan.token, postId);
  const afterUnlike = await notificationsFrom(author.user.id, fan.user.id);
  assert.equal(afterUnlike.length, 1, 'withdrawing removes nothing');

  await likePost(fan.token, postId);
  const afterRelike = await notificationsFrom(author.user.id, fan.user.id);
  assert.deepEqual(
    afterRelike.map((r) => r.id),
    afterUnlike.map((r) => r.id),
    'the same row, no new one',
  );
  assert.notEqual(afterRelike[0].read_at, null, 'a repeated like does not make it unread again');
});

test(`a follow/unfollow loop leaves exactly one notification (F-07, ${CYCLES} cycles)`, async () => {
  const target = await registerUser('ndtarget');
  const follower = await registerUser('ndfollower');

  for (let i = 0; i < CYCLES; i += 1) {
    await followUser(follower.token, target.user.id);
    await unfollowUser(follower.token, target.user.id);
  }
  const last = await (await followUser(follower.token, target.user.id)).json();
  assert.equal(last.is_following, true, 'the follow itself still works');
  assert.equal(last.followers, 1);

  const rows = await notificationsFrom(target.user.id, follower.user.id);
  assert.equal(
    rows.length,
    1,
    `${CYCLES + 1} follows of one account wrote ${rows.length} notifications: ${JSON.stringify(rows.map((r) => r.type))}`,
  );
  assert.equal(rows[0].type, 'follow');
  assert.equal(rows[0].ref_id, follower.user.id);
});

test(`an event like/unlike loop leaves no notification: event likes do not notify (${CYCLES} cycles)`, async () => {
  const host = await registerUser('ndhost');
  const fan = await registerUser('ndfan');
  const eventId = await insertEvent(host.user.id);

  await likeEvent(fan.token, eventId); // the first like, too
  await unlikeEvent(fan.token, eventId);
  for (let i = 1; i < CYCLES; i += 1) {
    await likeEvent(fan.token, eventId);
    await unlikeEvent(fan.token, eventId);
  }
  await likeEvent(fan.token, eventId);

  assert.deepEqual(await notificationsFrom(host.user.id, fan.user.id), []);
});

test('the rule is per actor and per target: other fans and other posts still notify', async () => {
  const author = await registerUser('ndauthor');
  const fanA = await registerUser('ndfan');
  const fanB = await registerUser('ndfan');
  const postOne = await insertPost(author.user.id);
  const postTwo = await insertPost(author.user.id);

  await likePost(fanA.token, postOne);
  await likePost(fanB.token, postOne);
  await likePost(fanA.token, postTwo);
  await followUser(fanA.token, author.user.id);

  assert.deepEqual(
    (await notificationsFrom(author.user.id, fanA.user.id)).map((r) => [r.type, r.ref_id]),
    [
      ['like', postOne],
      ['like', postTwo],
      ['follow', fanA.user.id],
    ],
  );
  assert.deepEqual(
    (await notificationsFrom(author.user.id, fanB.user.id)).map((r) => [r.type, r.ref_id]),
    [['like', postOne]],
  );
});

test('blocks unchanged: a like or follow across a block is refused and writes no notification', async () => {
  const author = await registerUser('ndauthor');
  const fan = await registerUser('ndfan');
  const postId = await insertPost(author.user.id);
  await pool.query('INSERT INTO user_blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, NOW())', [
    author.user.id,
    fan.user.id,
  ]);

  await expectStatus(send('POST', `/api/posts/${postId}/like`, fan.token), 403, 'like across a block');
  await expectStatus(send('POST', `/api/users/${author.user.id}/follow`, fan.token), 403, 'follow across a block');
  assert.deepEqual(await notificationsFrom(author.user.id, fan.user.id), []);
});
