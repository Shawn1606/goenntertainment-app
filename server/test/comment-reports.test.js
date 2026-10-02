/**
 * Comments (F-08), against the real database: comments under events and posts can be reported,
 * admins see what was reported and may remove it, the host hears about comments on their event,
 * and a block hides a person's comments from the other side everywhere they show up.
 *
 * Comments are written straight to the database where the route that writes them is not what a
 * test is about, so no test depends on the moderation mode; the one test of the comment route
 * itself switches the AI moderation off for this process (it is about the notification, the
 * moderation has its own tests).
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { createApp } from '../src/app.js';
import { ensureSchema, first, pool } from '../src/db.js';
import { NOTIFICATION_TYPES } from '../src/notifications.js';
import { FUNCTIONAL_WRITE_LIMITS } from './support/app.js';
import { cleanup, createUser } from './support/fixtures.js';

// TEST-ONLY: the AI moderation off for this process (read per request, src/moderation.js). The
// comment route is called once below for its notification; whether moderation passes it is
// not what that test is about.
process.env.MODERATION_ENABLED = 'false';

let base;
let server;

const call = async (method, p, token, body) => {
  const res = await fetch(`${base}${p}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

async function insert(sql, params) {
  const [result] = await pool.query(sql, params);
  return result.insertId;
}

const event = (hostId) =>
  insert(
    `INSERT INTO activities (user_id, title, description, location, starts_at, created_at, updated_at)
     VALUES (?, 'Kommentartest', 'Testbeschreibung', 'Teststrasse 1', NOW() + INTERVAL 1 DAY, NOW(), NOW())`,
    [hostId],
  );
const postOf = (userId) =>
  insert("INSERT INTO posts (user_id, body, created_at, updated_at) VALUES (?, 'Beitrag', NOW(), NOW())", [userId]);
const eventComment = (activityId, userId, body) =>
  insert('INSERT INTO activity_comments (activity_id, user_id, body, created_at) VALUES (?, ?, ?, NOW())', [activityId, userId, body]);
const postComment = (postId, userId, body) =>
  insert('INSERT INTO post_comments (post_id, user_id, body, created_at) VALUES (?, ?, ?, NOW())', [postId, userId, body]);

const report = (token, targetType, targetId) =>
  call('POST', '/api/reports', token, { target_type: targetType, target_id: targetId, reason: 'harassment' });

before(async () => {
  await ensureSchema();
  server = createApp({ writeLimits: FUNCTIONAL_WRITE_LIMITS }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  try {
    await cleanup();
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  }
});

test('comments on events and posts can be reported, once per person, and only if they exist', async () => {
  const host = await createUser('crephost', { accountType: 'creator' });
  const writer = await createUser('crepwriter');
  const reporter = await createUser('crepreporter');
  const activityId = await event(host.user.id);
  const postId = await postOf(host.user.id);
  const onEvent = await eventComment(activityId, writer.user.id, 'unschoen unter dem Event');
  const onPost = await postComment(postId, writer.user.id, 'unschoen unter dem Beitrag');

  for (const [type, id] of [['activity_comment', onEvent], ['post_comment', onPost]]) {
    assert.equal((await report(reporter.token, type, id)).status, 201, `${type} cannot be reported`);
    assert.equal((await report(reporter.token, type, id)).status, 201, `${type}: a second report fails`);
    const rows = await first(
      'SELECT COUNT(*) AS c FROM content_reports WHERE reporter_id = ? AND target_type = ? AND target_id = ?',
      [reporter.user.id, type, id],
    );
    assert.equal(Number(rows.c), 1, `${type}: one report per person`);
    assert.equal((await report(reporter.token, type, 999999999)).status, 404, `${type}: an unknown comment`);
  }
});

test('admins see a reported comment with its text, author, time and where it stands', async () => {
  const host = await createUser('crephost', { accountType: 'creator' });
  const writer = await createUser('crepwriter');
  const reporter = await createUser('crepreporter');
  const admin = await createUser('crepadmin', { isAdmin: true });
  const activityId = await event(host.user.id);
  const postId = await postOf(host.user.id);
  const onEvent = await eventComment(activityId, writer.user.id, 'gemeldet unter dem Event');
  const onPost = await postComment(postId, writer.user.id, 'gemeldet unter dem Beitrag');
  await report(reporter.token, 'activity_comment', onEvent);
  await report(reporter.token, 'post_comment', onPost);

  const list = await call('GET', '/api/admin/reports', admin.token);
  assert.equal(list.status, 200);
  const entry = (type, id) => list.body.data.find((r) => r.target_type === type && r.target_id === id);

  const eventEntry = entry('activity_comment', onEvent);
  assert.ok(eventEntry, 'the event comment report is not listed');
  assert.equal(eventEntry.target?.label, 'gemeldet unter dem Event');
  assert.equal(eventEntry.target.author, writer.user.name);
  assert.equal(eventEntry.target.context_id, activityId);
  assert.ok(eventEntry.target.detail, 'the time of the comment');

  const postEntry = entry('post_comment', onPost);
  assert.ok(postEntry, 'the post comment report is not listed');
  assert.equal(postEntry.target?.label, 'gemeldet unter dem Beitrag');
  assert.equal(postEntry.target.context_id, postId);
});

test('admins may delete any post comment, and the comment list says so', async () => {
  const author = await createUser('crepauthor', { accountType: 'creator' });
  const writer = await createUser('crepwriter');
  const admin = await createUser('crepadmin', { isAdmin: true });
  const postId = await postOf(author.user.id);
  const commentId = await postComment(postId, writer.user.id, 'ein Kommentar');

  const list = await call('GET', `/api/posts/${postId}/comments`, admin.token);
  assert.equal(list.status, 200);
  assert.equal(list.body.data.find((c) => c.id === commentId)?.can_delete, true, 'the list hides the delete action from admins');
  assert.equal((await call('DELETE', `/api/comments/${commentId}`, admin.token)).status, 200);
  assert.equal(await first('SELECT 1 AS ok FROM post_comments WHERE id = ?', [commentId]), null);
});

/** The notifications of `userId`, newest first, straight from the table. */
const notificationsOf = async (userId) => {
  const [rows] = await pool.query('SELECT actor_id, type, ref_id, title, body FROM notifications WHERE user_id = ? ORDER BY id DESC', [userId]);
  return rows;
};

test('the host is notified of a comment on their event, but not of their own (F-08)', async () => {
  const host = await createUser('crephost', { accountType: 'creator' });
  const guest = await createUser('crepguest');
  const activityId = await event(host.user.id);

  const sent = await call('POST', `/api/activities/${activityId}/comments`, guest.token, { body: 'Bin dabei!' });
  assert.equal(sent.status, 201);

  const forHost = (await notificationsOf(host.user.id)).filter((n) => n.type === 'activity_comment');
  assert.equal(forHost.length, 1, 'the host got no notification about the comment');
  assert.equal(Number(forHost[0].actor_id), guest.user.id);
  assert.equal(Number(forHost[0].ref_id), activityId);
  assert.equal(forHost[0].body, 'Bin dabei!');

  // Through the API the host sees it in the list (the bell's data).
  const listed = await call('GET', '/api/notifications', host.token);
  assert.ok(listed.body.data.some((n) => n.type === 'activity_comment' && n.ref_id === activityId));

  assert.equal((await call('POST', `/api/activities/${activityId}/comments`, host.token, { body: 'Willkommen' })).status, 201);
  const later = (await notificationsOf(host.user.id)).filter((n) => n.type === 'activity_comment');
  assert.equal(later.length, 1, 'the host was notified of their own comment');
});

test('an admin in a block relation with the post owner can still remove a comment (F-13)', async () => {
  const author = await createUser('crepauthor', { accountType: 'creator' });
  const writer = await createUser('crepwriter');
  const admin = await createUser('crepadmin', { isAdmin: true });
  const postId = await postOf(author.user.id);
  const commentId = await postComment(postId, writer.user.id, 'gemeldet');
  assert.equal((await call('POST', '/api/blocks', author.token, { user_id: admin.user.id })).status, 201);

  // The moderation action deletes and then closes the report: it must not end in a 404.
  const res = await call('DELETE', `/api/comments/${commentId}`, admin.token);
  assert.equal(res.status, 200);
  assert.equal(await first('SELECT 1 AS ok FROM post_comments WHERE id = ?', [commentId]), null);
});

test('server and app know the same notification types', () => {
  const file = path.join(import.meta.dirname, '..', '..', 'src', 'domain', 'notification.ts');
  const block = fs.readFileSync(file, 'utf8').match(/export const NOTIFICATION_TYPES = \[([^\]]*)\]/);
  const app = block ? [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : [];
  assert.ok(app.length > 0, 'NOTIFICATION_TYPES not found in src/domain/notification.ts');
  assert.deepEqual([...app].sort(), [...NOTIFICATION_TYPES].sort());
  for (const type of NOTIFICATION_TYPES) assert.ok(type.length <= 20, `${type} does not fit notifications.type`);
});

test('a blocked commenter disappears from the post comment count and from the notifications (F-08)', async () => {
  const author = await createUser('crepauthor', { accountType: 'creator' });
  const pest = await createUser('creppest');
  const friend = await createUser('crepfriend');
  const postId = await postOf(author.user.id);
  // Through the route, so the comments leave their notifications as they do in the app.
  for (const [who, body] of [[pest, 'stoerend'], [friend, 'nett']]) {
    assert.equal((await call('POST', `/api/posts/${postId}/comments`, who.token, { body })).status, 201);
  }
  const count = async (viewer) =>
    (await call('GET', `/api/users/${author.user.username}`, viewer.token)).body.posts.find((p) => p.id === postId).comments_count;
  assert.equal(await count(author), 2, 'control: both comments count before the block');

  assert.equal((await call('POST', '/api/blocks', author.token, { user_id: pest.user.id })).status, 201);

  assert.equal(await count(author), 1, "the blocked person's comment still counts for the author");
  assert.equal(await count(friend), 2, 'control: for others both still count');
  // Every other answer with this post (here: a like) counts the same way.
  const liked = await call('POST', `/api/posts/${postId}/like`, author.token);
  assert.equal(liked.body.data.comments_count, 1);
  // The list matches the number.
  const listed = await call('GET', `/api/posts/${postId}/comments`, author.token);
  assert.deepEqual(listed.body.data.map((c) => c.body), ['nett']);

  const notes = await call('GET', '/api/notifications', author.token);
  const comments = notes.body.data.filter((n) => n.type === 'comment' && n.ref_id === postId);
  assert.deepEqual(comments.map((n) => n.actor?.id), [friend.user.id], "the blocked person's comment notification is still shown");
  assert.ok(!JSON.stringify(notes.body).includes('stoerend'), "the blocked person's comment text is still in the notifications");
});
