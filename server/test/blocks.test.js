/**
 * Blocks on every cross-user path (F-13), one table, against the real database.
 *
 * ## The denominator
 *
 * COVERAGE_ROUTES are the 20 cross-user routes the security review checked for block enforcement
 * (its coverage notes, in the order given there). EXTRA_ROUTES are the further cross-user paths
 * named by the finding and the fix plan: joining an event, the leaderboard, event comments and
 * likes, participant lists and notifications. Every route has at least one row in ROWS below, or
 * is delegated to the backend that owns it (the leaderboard is Laravel's). The first test checks
 * that, checks that every Node row names a route the app really serves, and refuses a count of 0.
 *
 * ## What a block means (the same for every row)
 *
 *   hide    lists and counters that show people drop anyone in a block relation with the viewer,
 *           in either direction; numbers that are capacity (participants_count) stay true;
 *   404     reads addressed to the other person or their things answer like "does not exist",
 *           with the same message, so the answer is no block oracle;
 *   refuse  writes that create contact keep their neutral answer (403 / 422);
 *   allow   withdrawing one's own action always works.
 *
 * ## The fixture
 *
 * A, B and C are creators. C is friends with both and owns group G with A and B; C hosts event
 * E_C, which A and B joined; A hosts E_A, B hosts E_B. Posts P_A, P_B, P_C; B likes P_A and E_A.
 * Live stories S_A, S_B. In G, C then A then B wrote a message; in E_C, A then B. A, B and C
 * commented on E_C, B on P_C. B follows A, and B's comment left A a notification (plus one from C).
 * Then A blocks B through the real route. Content is written straight to the database, so no
 * row depends on the moderation mode; the routes under test are called over HTTP. C sees
 * everything and is the positive control of most rows: a hidden row that C still sees was hidden
 * by the block, not missing from the start.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { createApp } from '../src/app.js';
import { ensureSchema, first, pool } from '../src/db.js';
import { FUNCTIONAL_WRITE_LIMITS } from './support/app.js';
import { cleanup, createUser } from './support/fixtures.js';

/** The 20 cross-user routes of the review's coverage notes, in their order. */
const COVERAGE_ROUTES = [
  'R01 POST /api/users/:id/follow',
  'R02 POST /api/posts/:id/like',
  'R03 POST /api/posts/:id/comments',
  'R04 POST /api/friends',
  'R05 POST /api/groups/:id/members',
  'R06 POST /api/groups',
  'R07 GET /api/users/:username/followers',
  'R08 GET /api/users/:username/following',
  'R09 GET /api/posts/:id/comments',
  'R10 GET /api/chats',
  'R11 GET /api/chats/:kind/:refId/messages',
  'R12 GET /api/users',
  'R13 GET /api/users/:username',
  'R14 DELETE /api/posts/:id/like',
  'R15 GET /api/groups',
  'R16 POST /api/chats/:kind/:refId/messages',
  'R17 GET /api/stories',
  'R18 GET /api/users/:id/stories',
  'R19 POST /api/stories/:id/view',
  'R20 DELETE /api/users/:id/follow',
];

/** Further cross-user paths named by the finding and the plan. */
const EXTRA_ROUTES = [
  'R21 POST /api/activities/:id/join',
  'R22 GET /api/leaderboard',
  'R23 GET /api/activities/:id/comments',
  'R24 POST /api/activities/:id/comments',
  'R25 POST /api/activities/:id/like',
  'R26 DELETE /api/activities/:id/like',
  'R27 GET /api/activities/:id',
  'R28 GET /api/notifications',
];

/** Routes another backend owns, with the test that covers them there. */
const DELEGATED = {
  'R22 GET /api/leaderboard': 'api/tests/Feature/LeaderboardBlocksTest.php',
};

const REPO = path.resolve(import.meta.dirname, '..', '..');

let base;
let server;
const f = {};

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
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, body: json };
};
const get = (p, token) => call('GET', p, token);

async function insert(sql, params) {
  const [result] = await pool.query(sql, params);
  return result.insertId;
}

async function room(kind, refId) {
  const column = kind === 'group' ? 'group_id' : 'activity_id';
  return insert(`INSERT INTO chat_rooms (kind, ${column}, created_at) VALUES (?, ?, NOW())`, [kind, refId]);
}

const message = (roomId, userId, body) =>
  insert('INSERT INTO chat_messages (room_id, user_id, body, created_at) VALUES (?, ?, ?, NOW())', [roomId, userId, body]);

const event = (hostId, title) =>
  insert(
    `INSERT INTO activities (user_id, title, description, location, starts_at, created_at, updated_at)
     VALUES (?, ?, 'Testbeschreibung', 'Teststrasse 1', NOW() + INTERVAL 1 DAY, NOW(), NOW())`,
    [hostId, title],
  );

const join = (activityId, userId) =>
  insert('INSERT INTO activity_user (activity_id, user_id, created_at, updated_at) VALUES (?, ?, NOW(), NOW())', [activityId, userId]);

const postOf = (userId, body) =>
  insert('INSERT INTO posts (user_id, body, created_at, updated_at) VALUES (?, ?, NOW(), NOW())', [userId, body]);

const story = (userId) =>
  insert(
    `INSERT INTO stories (user_id, caption, image_path, created_at, expires_at)
     VALUES (?, NULL, 'stories/blocks-test.jpg', NOW(), NOW() + INTERVAL 1 DAY)`,
    [userId],
  );

const ids = (list) => (list ?? []).map((row) => row.id);
const bodies = (list) => (list ?? []).map((row) => row.body);

before(async () => {
  await ensureSchema();
  server = createApp({ writeLimits: FUNCTIONAL_WRITE_LIMITS }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  const A = await createUser('blka', { accountType: 'creator' });
  const B = await createUser('blkb', { accountType: 'creator' });
  const C = await createUser('blkc', { accountType: 'creator' });
  Object.assign(f, { A, B, C, a: A.user.id, b: B.user.id, c: C.user.id });

  // C is friends with A and B and owns group G with both; A owns G_A alone.
  await insert(
    `INSERT INTO friendships (requester_id, addressee_id, status, created_at, updated_at)
     VALUES (?, ?, 'accepted', NOW(), NOW()), (?, ?, 'accepted', NOW(), NOW())`,
    [f.c, f.a, f.c, f.b],
  );
  f.group = await insert(
    "INSERT INTO friend_groups (owner_id, name, created_at, updated_at) VALUES (?, 'Blockrunde', NOW(), NOW())",
    [f.c],
  );
  for (const id of [f.c, f.a, f.b]) {
    await insert('INSERT INTO group_members (group_id, user_id, created_at) VALUES (?, ?, NOW())', [f.group, id]);
  }
  f.groupA = await insert(
    "INSERT INTO friend_groups (owner_id, name, created_at, updated_at) VALUES (?, 'Eigene Runde', NOW(), NOW())",
    [f.a],
  );
  await insert('INSERT INTO group_members (group_id, user_id, created_at) VALUES (?, ?, NOW())', [f.groupA, f.a]);

  // Events: E_C with A and B, E_A and E_B with their hosts.
  f.eventC = await event(f.c, 'Blocktest C');
  for (const id of [f.c, f.a, f.b]) await join(f.eventC, id);
  f.eventA = await event(f.a, 'Blocktest A');
  await join(f.eventA, f.a);
  f.eventB = await event(f.b, 'Blocktest B');
  await join(f.eventB, f.b);

  // Chats: G (C, A, B in that order, B's last), E_C (A, then B).
  f.roomG = await room('group', f.group);
  f.msgCG = await message(f.roomG, f.c, 'c-in-g');
  f.msgAG = await message(f.roomG, f.a, 'a-in-g');
  f.msgBG = await message(f.roomG, f.b, 'b-in-g');
  f.roomE = await room('activity', f.eventC);
  await message(f.roomE, f.a, 'a-in-e');
  await message(f.roomE, f.b, 'b-in-e');

  // Posts, likes, comments.
  f.postA = await postOf(f.a, 'Beitrag A');
  f.postB = await postOf(f.b, 'Beitrag B');
  f.postC = await postOf(f.c, 'Beitrag C');
  await insert('INSERT INTO post_likes (post_id, user_id, created_at) VALUES (?, ?, NOW())', [f.postA, f.b]);
  await insert('INSERT INTO activity_likes (activity_id, user_id, created_at) VALUES (?, ?, NOW())', [f.eventA, f.b]);
  for (const [id, body] of [[f.a, 'a-comment'], [f.b, 'b-comment'], [f.c, 'c-comment']]) {
    await insert('INSERT INTO activity_comments (activity_id, user_id, body, created_at) VALUES (?, ?, ?, NOW())', [f.eventC, id, body]);
  }
  await insert('INSERT INTO post_comments (post_id, user_id, body, created_at) VALUES (?, ?, ?, NOW())', [f.postC, f.b, 'b-on-p-c']);

  // Stories, a follow, notifications for A (one from B, one from C).
  f.storyA = await story(f.a);
  f.storyB = await story(f.b);
  await insert('INSERT INTO follows (follower_id, following_id, created_at) VALUES (?, ?, NOW())', [f.b, f.a]);
  f.noteFromB = await insert(
    "INSERT INTO notifications (user_id, actor_id, type, ref_id, title, body, created_at) VALUES (?, ?, 'comment', ?, 'B hat kommentiert', 'b-note', NOW())",
    [f.a, f.b, f.postA],
  );
  f.noteFromC = await insert(
    "INSERT INTO notifications (user_id, actor_id, type, ref_id, title, body, created_at) VALUES (?, ?, 'follow', ?, 'C folgt dir', NULL, NOW())",
    [f.a, f.c, f.c],
  );

  // The block, through the real route.
  const blocked = await call('POST', '/api/blocks', A.token, { user_id: f.b });
  assert.equal(blocked.status, 201, 'A must be able to block B');
});

after(async () => {
  try {
    await cleanup();
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  }
});

/** Every route the app serves: 'METHOD /path' (literal mounts, as in app.js). */
function servedRoutes(app) {
  const routes = new Set();
  for (const layer of app._router.stack) {
    if (!Array.isArray(layer.handle?.stack)) continue;
    const m = /^\^(.*?)\\\/\?\(\?=\\\/\|\$\)$/.exec(layer.regexp.source);
    if (!m) continue;
    const mount = m[1].replace(/\\\//g, '/');
    for (const inner of layer.handle.stack) {
      if (!inner.route) continue;
      for (const method of Object.keys(inner.route.methods)) {
        routes.add(`${method.toUpperCase()} ${mount}${inner.route.path === '/' && mount ? '' : inner.route.path}`);
      }
    }
  }
  return routes;
}

/** The rows: one test each. `who` says who acts on whom. */
const ROWS = [
  {
    id: 'R01', route: 'POST /api/users/:id/follow', semantics: 'refuse', who: 'B->A and A->B',
    async run() {
      assert.equal((await call('POST', `/api/users/${f.a}/follow`, f.B.token)).status, 403);
      assert.equal((await call('POST', `/api/users/${f.b}/follow`, f.A.token)).status, 403);
    },
  },
  {
    id: 'R02', route: 'POST /api/posts/:id/like', semantics: 'refuse', who: 'B->A and A->B',
    async run() {
      assert.equal((await call('POST', `/api/posts/${f.postA}/like`, f.B.token)).status, 403);
      assert.equal((await call('POST', `/api/posts/${f.postB}/like`, f.A.token)).status, 403);
    },
  },
  {
    id: 'R03', route: 'POST /api/posts/:id/comments', semantics: 'refuse', who: 'B->A and A->B',
    async run() {
      assert.equal((await call('POST', `/api/posts/${f.postA}/comments`, f.B.token, { body: 'Hallo' })).status, 403);
      assert.equal((await call('POST', `/api/posts/${f.postB}/comments`, f.A.token, { body: 'Hallo' })).status, 403);
    },
  },
  {
    id: 'R04', route: 'POST /api/friends', semantics: 'refuse', who: 'B->A and A->B',
    async run() {
      assert.equal((await call('POST', '/api/friends', f.B.token, { user_id: f.a })).status, 422);
      assert.equal((await call('POST', '/api/friends', f.A.token, { user_id: f.b })).status, 422);
    },
  },
  {
    id: 'R05', route: 'POST /api/groups/:id/members', semantics: 'refuse', who: 'A adds B',
    async run() {
      const res = await call('POST', `/api/groups/${f.groupA}/members`, f.A.token, { user_id: f.b });
      assert.equal(res.status, 422);
      assert.equal(await first('SELECT 1 AS ok FROM group_members WHERE group_id = ? AND user_id = ?', [f.groupA, f.b]), null);
    },
  },
  {
    id: 'R06', route: 'POST /api/groups', semantics: 'refuse (member skipped)', who: 'A creates a group with B',
    async run() {
      // A stale friendship row (as if the block had not removed it): the block alone must keep B out.
      const stale = await insert(
        "INSERT INTO friendships (requester_id, addressee_id, status, created_at, updated_at) VALUES (?, ?, 'accepted', NOW(), NOW())",
        [f.a, f.b],
      );
      try {
        const res = await call('POST', '/api/groups', f.A.token, { name: 'Neue Runde', members: [f.b] });
        assert.equal(res.status, 201);
        assert.ok(!ids(res.body.data.members).includes(f.b), 'B was added to the group despite the block');
        assert.equal(
          await first('SELECT 1 AS ok FROM group_members WHERE group_id = ? AND user_id = ?', [res.body.data.id, f.b]),
          null,
        );
      } finally {
        await pool.query('DELETE FROM friendships WHERE id = ?', [stale]);
      }
    },
  },
  {
    id: 'R07', route: 'GET /api/users/:username/followers', semantics: '404', who: 'B->A and A->B',
    async run() {
      for (const [viewer, owner] of [[f.B, f.A], [f.A, f.B]]) {
        const res = await get(`/api/users/${owner.user.username}/followers`, viewer.token);
        assert.equal(res.status, 404);
        assert.equal(res.body.message, 'Dieses Profil gibt es nicht.');
      }
      assert.equal((await get(`/api/users/${f.A.user.username}/followers`, f.C.token)).status, 200, 'control: C');
    },
  },
  {
    id: 'R08', route: 'GET /api/users/:username/following', semantics: '404', who: 'B->A and A->B',
    async run() {
      for (const [viewer, owner] of [[f.B, f.A], [f.A, f.B]]) {
        const res = await get(`/api/users/${owner.user.username}/following`, viewer.token);
        assert.equal(res.status, 404);
        assert.equal(res.body.message, 'Dieses Profil gibt es nicht.');
      }
      assert.equal((await get(`/api/users/${f.A.user.username}/following`, f.C.token)).status, 200, 'control: C');
    },
  },
  {
    id: 'R09', route: 'GET /api/posts/:id/comments', semantics: '404', who: 'B->P_A and A->P_B',
    async run() {
      for (const [viewer, postId] of [[f.B, f.postA], [f.A, f.postB]]) {
        const res = await get(`/api/posts/${postId}/comments`, viewer.token);
        assert.equal(res.status, 404);
        assert.equal(res.body.message, 'Diesen Beitrag gibt es nicht.');
      }
      assert.equal((await get(`/api/posts/${f.postA}/comments`, f.C.token)).status, 200, 'control: C');
    },
  },
  {
    id: 'R10', route: 'GET /api/chats', semantics: 'hide', who: "A's previews, B's unread",
    async run() {
      const entry = (list, kind, refId) => list.find((c) => c.kind === kind && c.ref_id === refId);
      const forA = (await get('/api/chats', f.A.token)).body.data;
      assert.equal(entry(forA, 'group', f.group).last_message.preview, 'a-in-g');
      assert.equal(entry(forA, 'activity', f.eventC).last_message.preview, 'a-in-e');
      const forB = (await get('/api/chats', f.B.token)).body.data;
      assert.equal(entry(forB, 'group', f.group).unread, 1, "B's unread counts A's message");
      assert.equal(entry(forB, 'activity', f.eventC).unread, 0, "B's unread counts A's message");
      const forC = (await get('/api/chats', f.C.token)).body.data;
      assert.equal(entry(forC, 'group', f.group).last_message.preview, 'b-in-g', 'control: C');
      assert.equal(entry(forC, 'group', f.group).unread, 2, 'control: C');
    },
  },
  {
    id: 'R11', route: 'GET /api/chats/:kind/:refId/messages', semantics: 'hide', who: 'A and B in G and E_C',
    async run() {
      const read = async (who, kind, refId) => bodies((await get(`/api/chats/${kind}/${refId}/messages`, who.token)).body.data);
      assert.deepEqual(await read(f.B, 'group', f.group), ['c-in-g', 'b-in-g']);
      assert.deepEqual(await read(f.A, 'group', f.group), ['c-in-g', 'a-in-g']);
      assert.deepEqual(await read(f.B, 'activity', f.eventC), ['b-in-e']);
      assert.deepEqual(await read(f.A, 'activity', f.eventC), ['a-in-e']);
      assert.deepEqual(await read(f.C, 'group', f.group), ['c-in-g', 'a-in-g', 'b-in-g'], 'control: C');
    },
  },
  {
    id: 'R12', route: 'GET /api/users', semantics: 'hide', who: 'B searches A, A searches B',
    async run() {
      const search = async (who, term) => ids((await get(`/api/users?q=${encodeURIComponent(term)}`, who.token)).body.data);
      assert.ok(!(await search(f.B, f.A.user.username)).includes(f.a), 'B finds A');
      assert.ok(!(await search(f.A, f.B.user.username)).includes(f.b), 'A finds B');
      assert.ok((await search(f.C, f.A.user.username)).includes(f.a), 'control: C finds A');
    },
  },
  {
    id: 'R13', route: 'GET /api/users/:username', semantics: '404', who: 'B->A and A->B',
    async run() {
      for (const [viewer, owner] of [[f.B, f.A], [f.A, f.B]]) {
        const res = await get(`/api/users/${owner.user.username}`, viewer.token);
        assert.equal(res.status, 404);
        assert.equal(res.body.message, 'Dieses Profil gibt es nicht.');
      }
      assert.equal((await get(`/api/users/${f.A.user.username}`, f.C.token)).status, 200, 'control: C');
    },
  },
  {
    id: 'R14', route: 'DELETE /api/posts/:id/like', semantics: 'allow + 404', who: "B withdraws B's like on P_A",
    async run() {
      const res = await call('DELETE', `/api/posts/${f.postA}/like`, f.B.token);
      assert.equal(await first('SELECT 1 AS ok FROM post_likes WHERE post_id = ? AND user_id = ?', [f.postA, f.b]), null, 'the like stays');
      assert.equal(res.status, 404);
      assert.equal(res.body.message, 'Diesen Beitrag gibt es nicht.');
      assert.equal(res.body.data, undefined, 'the answer carries the post');
    },
  },
  {
    id: 'R15', route: 'GET /api/groups', semantics: 'hide', who: "G's members for A and B",
    async run() {
      const group = async (who) => (await get('/api/groups', who.token)).body.data.find((g) => g.id === f.group);
      const forB = await group(f.B);
      assert.ok(!ids(forB.members).includes(f.a), 'B sees A among the members');
      assert.equal(forB.unread, 1, "B's unread counts A's message");
      assert.ok(!ids((await group(f.A)).members).includes(f.b), 'A sees B among the members');
      assert.deepEqual(ids((await group(f.C)).members).sort(), [f.a, f.b, f.c].sort(), 'control: C');
    },
  },
  {
    id: 'R16', route: 'POST /api/chats/:kind/:refId/messages', semantics: 'allow (hidden from the other)', who: 'A writes in G',
    async run() {
      const sent = await call('POST', `/api/chats/group/${f.group}/messages`, f.A.token, { body: 'a-after-block' });
      assert.equal(sent.status, 201);
      const poll = async (who) => bodies((await get(`/api/chats/group/${f.group}/messages?after=${f.msgBG}`, who.token)).body.data);
      assert.ok(!(await poll(f.B)).includes('a-after-block'), 'B reads A after the block');
      assert.ok((await poll(f.C)).includes('a-after-block'), 'control: C');
    },
  },
  {
    id: 'R17', route: 'GET /api/stories', semantics: 'hide', who: "A's and B's story feeds",
    async run() {
      const feed = async (who) => ids((await get('/api/stories', who.token)).body.data);
      const forC = await feed(f.C);
      assert.ok(forC.includes(f.storyA) && forC.includes(f.storyB), 'control: C sees both stories');
      assert.ok(!(await feed(f.A)).includes(f.storyB), "A sees B's story");
      assert.ok(!(await feed(f.B)).includes(f.storyA), "B sees A's story");
    },
  },
  {
    id: 'R18', route: 'GET /api/users/:id/stories', semantics: '404', who: 'B->A and A->B',
    async run() {
      for (const [viewer, owner] of [[f.B, f.a], [f.A, f.b]]) {
        const res = await get(`/api/users/${owner}/stories`, viewer.token);
        assert.equal(res.status, 404);
        assert.equal(res.body.message, 'Dieses Konto gibt es nicht.');
      }
      assert.deepEqual(ids((await get(`/api/users/${f.a}/stories`, f.C.token)).body.data), [f.storyA], 'control: C');
    },
  },
  {
    id: 'R19', route: 'POST /api/stories/:id/view', semantics: '404', who: 'B views S_A',
    async run() {
      const res = await call('POST', `/api/stories/${f.storyA}/view`, f.B.token);
      assert.equal(res.status, 404);
      assert.equal(res.body.message, 'Diese Story gibt es nicht mehr.');
      assert.equal(await first('SELECT 1 AS ok FROM story_views WHERE story_id = ? AND user_id = ?', [f.storyA, f.b]), null);
      assert.equal((await call('POST', `/api/stories/${f.storyA}/view`, f.C.token)).status, 200, 'control: C');
    },
  },
  {
    id: 'R20', route: 'DELETE /api/users/:id/follow', semantics: 'allow', who: 'B unfollows A',
    async run() {
      const res = await call('DELETE', `/api/users/${f.a}/follow`, f.B.token);
      assert.equal(res.status, 200);
      assert.equal(res.body.is_following, false);
    },
  },
  {
    id: 'R21', route: 'POST /api/activities/:id/join', semantics: 'refuse', who: 'B joins E_A, A joins E_B',
    async run() {
      for (const [who, userId, eventId] of [[f.B, f.b, f.eventA], [f.A, f.a, f.eventB]]) {
        const res = await call('POST', `/api/activities/${eventId}/join`, who.token);
        assert.equal(res.status, 403);
        assert.equal(res.body.message, 'Das geht mit diesem Konto nicht.');
        assert.equal(await first('SELECT 1 AS ok FROM activity_user WHERE activity_id = ? AND user_id = ?', [eventId, userId]), null);
      }
    },
  },
  {
    id: 'R23', route: 'GET /api/activities/:id/comments', semantics: 'hide', who: "E_C's comments for A and B",
    async run() {
      const list = async (who) => bodies((await get(`/api/activities/${f.eventC}/comments`, who.token)).body.data);
      assert.deepEqual(await list(f.A), ['a-comment', 'c-comment']);
      assert.deepEqual(await list(f.B), ['b-comment', 'c-comment']);
      assert.deepEqual(await list(f.C), ['a-comment', 'b-comment', 'c-comment'], 'control: C');
      assert.equal((await get(`/api/activities/${f.eventC}`, f.A.token)).body.data.comments_count, 2);
    },
  },
  {
    id: 'R24', route: 'POST /api/activities/:id/comments', semantics: 'refuse', who: 'B comments on E_A',
    async run() {
      assert.equal((await call('POST', `/api/activities/${f.eventA}/comments`, f.B.token, { body: 'Hallo' })).status, 403);
    },
  },
  {
    id: 'R25', route: 'POST /api/activities/:id/like', semantics: 'refuse', who: 'A likes E_B',
    async run() {
      assert.equal((await call('POST', `/api/activities/${f.eventB}/like`, f.A.token)).status, 403);
    },
  },
  {
    id: 'R26', route: 'DELETE /api/activities/:id/like', semantics: 'allow', who: "B withdraws B's like on E_A",
    async run() {
      assert.equal((await call('DELETE', `/api/activities/${f.eventA}/like`, f.B.token)).status, 200);
      assert.equal(await first('SELECT 1 AS ok FROM activity_likes WHERE activity_id = ? AND user_id = ?', [f.eventA, f.b]), null);
    },
  },
  {
    id: 'R27', route: 'GET /api/activities/:id', semantics: 'hide (count stays)', who: "participants of E_C and E_A for A and B",
    async run() {
      const show = async (who, id) => (await get(`/api/activities/${id}`, who.token)).body.data;
      const forB = await show(f.B, f.eventC);
      assert.ok(!ids(forB.participants).includes(f.a), 'B sees A among the participants');
      assert.equal(forB.participants_count, 3, 'the count is capacity and stays true');
      assert.equal(forB.is_joined, true);
      assert.ok(!ids((await show(f.A, f.eventC)).participants).includes(f.b), 'A sees B among the participants');
      assert.ok(!ids((await show(f.B, f.eventA)).participants).includes(f.a), "B sees A among E_A's participants");
      // The list answer goes through the same loader.
      const listed = (await get('/api/activities', f.B.token)).body.data.find((a) => a.id === f.eventC);
      assert.ok(!ids(listed.participants).includes(f.a), 'B sees A in the event list');
      assert.deepEqual(ids((await show(f.C, f.eventC)).participants).sort(), [f.a, f.b, f.c].sort(), 'control: C');
    },
  },
  {
    id: 'R28', route: 'GET /api/notifications', semantics: 'hide', who: "A's notifications",
    async run() {
      const res = await get('/api/notifications', f.A.token);
      assert.ok(!ids(res.body.data).includes(f.noteFromB), "A sees B's notification");
      assert.ok(ids(res.body.data).includes(f.noteFromC), 'control: the one from C');
      assert.equal(res.body.unread, 1, "A's unread counts B's notification");
      const marked = await call('POST', `/api/notifications/${f.noteFromC}/read`, f.A.token);
      assert.equal(marked.body.unread, 0, "the counter after marking one read counts B's notification");
    },
  },
];

test('denominator: the 20 routes of the coverage notes and 8 further cross-user paths each have a row', () => {
  assert.equal(COVERAGE_ROUTES.length, 20);
  assert.equal(EXTRA_ROUTES.length, 8);
  const keys = [...COVERAGE_ROUTES, ...EXTRA_ROUTES];
  assert.equal(new Set(keys).size, keys.length, 'a route is listed twice');

  const rowKeys = ROWS.map((row) => `${row.id} ${row.route}`);
  assert.ok(rowKeys.length > 0, 'no rows');
  const missing = keys.filter((key) => !rowKeys.includes(key) && !DELEGATED[key]);
  assert.deepEqual(missing, [], 'routes without a row');
  assert.deepEqual(rowKeys.filter((key) => !keys.includes(key)), [], 'rows outside the denominator');

  // Every Node row is a route this app serves; a delegated one is not (its owner tests it).
  const served = servedRoutes(createApp({ writeLimits: FUNCTIONAL_WRITE_LIMITS }));
  assert.ok(served.size > 50, `only ${served.size} routes found in the app`);
  for (const row of ROWS) assert.ok(served.has(row.route), `${row.id}: Node serves no ${row.route}`);
  for (const [key, file] of Object.entries(DELEGATED)) {
    assert.ok(!served.has(key.slice(4)), `${key} is delegated, but Node serves it`);
    assert.ok(fs.existsSync(path.join(REPO, file)), `${key}: ${file} is missing`);
  }
  console.log(`${keys.length} cross-user routes: ${ROWS.length} Node rows, ${Object.keys(DELEGATED).length} delegated`);
});

for (const row of ROWS) {
  test(`${row.id} ${row.route} [${row.semantics}] ${row.who}`, row.run);
}
