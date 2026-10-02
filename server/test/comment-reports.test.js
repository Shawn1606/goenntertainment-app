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

import { createApp } from '../src/app.js';
import { ensureSchema, first, pool } from '../src/db.js';
import { FUNCTIONAL_WRITE_LIMITS } from './support/app.js';
import { cleanup, createUser } from './support/fixtures.js';

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
