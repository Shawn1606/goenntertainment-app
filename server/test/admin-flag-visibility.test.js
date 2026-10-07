/**
 * Whether an account is an admin is told only to that account itself (F-05).
 *
 * Every Node response that embeds another account is requested here by a viewer who is not an
 * admin, about an account that is one, and none of them may carry `is_admin` anywhere. Each
 * response must also really contain the admin account, so a list that came back empty cannot
 * pass the check. The owner still gets the flag on their own profile.
 *
 * The responses below are one per response shape (the serializer that builds the embedded
 * account), plus the write answers that embed another account:
 *   - profile:       GET /api/users/:username (the account, and its `stories`);
 *   - search:        GET /api/users?q=;
 *   - follow lists:  GET /api/users/:username/followers, …/following;
 *   - friends:       GET /api/friends (incoming, then friends), POST /api/friends;
 *   - groups:        POST /api/groups, GET /api/groups (members);
 *   - events:        GET /api/activities, GET /api/activities/:id (host, participants);
 *   - comments:      GET /api/activities/:id/comments, GET /api/posts/:id/comments;
 *   - stories:       GET /api/stories, GET /api/users/:id/stories;
 *   - chat:          GET /api/chats/group/:id/messages, GET /api/chats/activity/:id/messages,
 *                    GET /api/chats (the overview names the last author);
 *   - notifications: GET /api/notifications (the actor);
 *   - blocks:        POST /api/blocks, GET /api/blocks;
 *   - admin only:    GET /api/admin/users and GET /api/admin/reports answer 403 to this viewer.
 * The admin user list itself carries `is_admin` for admins; that is the admin area, where an
 * admin already sees every account's address.
 *
 * Content the read routes only display (events, comments, a post, a story) is written straight
 * to the database, so the check does not depend on the moderation of the write routes.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from '../src/app.js';
import { FUNCTIONAL_WRITE_LIMITS } from './support/app.js';
import { ensureSchema, pool } from '../src/db.js';
import { createUser, deleteTestUsers } from './support/fixtures.js';

let base;
let server;
const createdUserIds = [];

before(async () => {
  await ensureSchema();
  server = createApp({ writeLimits: FUNCTIONAL_WRITE_LIMITS }).listen(0);
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

const call = (method, path, token, body) =>
  fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

/** The responses the first test checks, in its order (the denominator). */
const CHECKED_RESPONSES = [
  'profile',
  'search',
  'followers',
  'following',
  'friend requests',
  'accept friend request',
  'friends',
  'create group',
  'groups',
  'events',
  'event host',
  'event participants',
  'event comments',
  'post comments',
  'stories',
  'stories of one account',
  'group chat',
  'event chat',
  'chat overview',
  'notifications',
  'admin user list',
  'admin reports',
  'block',
  'blocks',
];

/** Every path in `value` that holds an `is_admin` key. */
function isAdminPaths(value, path = '$') {
  if (Array.isArray(value)) return value.flatMap((item, i) => isAdminPaths(item, `${path}[${i}]`));
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, inner]) => [
    ...(key === 'is_admin' ? [`${path}.${key}`] : []),
    ...isAdminPaths(inner, `${path}.${key}`),
  ]);
}

/** Does `value` embed the account (an object with its username, or the overview's author name)? */
function embeds(value, account) {
  if (Array.isArray(value)) return value.some((item) => embeds(item, account));
  if (value === null || typeof value !== 'object') return false;
  if (value.username === account.username || value.author === account.name) return true;
  return Object.values(value).some((inner) => embeds(inner, account));
}

/** Inserts a row and returns its id (test content only; bound parameters). */
async function insert(sql, params) {
  const [result] = await pool.query(sql, params);
  return result.insertId;
}

/** An upcoming event hosted by `hostId`, with the host as its first participant. */
async function insertEvent(hostId, title) {
  const id = await insert(
    `INSERT INTO activities (user_id, title, description, location, starts_at, created_at, updated_at)
     VALUES (?, ?, 'Testbeschreibung', 'Teststrasse 1, 50667 Koeln', NOW() + INTERVAL 1 DAY, NOW(), NOW())`,
    [hostId, title],
  );
  await pool.query(
    'INSERT INTO activity_user (activity_id, user_id, created_at, updated_at) VALUES (?, ?, NOW(), NOW())',
    [id, hostId],
  );
  return id;
}

test('a viewer never receives is_admin of another account, on any response that embeds one', async () => {
  const admin = await createUser('flagadm', { accountType: 'creator', isAdmin: true, created: createdUserIds });
  const viewer = await createUser('flagview', { accountType: 'creator', created: createdUserIds });
  const adminAccount = { username: admin.user.username, name: admin.user.name };
  const checked = [];
  const leaks = [];

  /** One response of the viewer: expected status, the admin embedded (unless 403), no is_admin. */
  async function check(label, method, path, { body, status = 200 } = {}) {
    const res = await call(method, path, viewer.token, body);
    assert.equal(res.status, status, `${label}: status`);
    const json = await res.json();
    if (status !== 403) assert.ok(embeds(json, adminAccount), `${label}: the admin account is not in the response`);
    checked.push(label);
    leaks.push(...isAdminPaths(json).map((where) => `${label} ${where}`));
    return json;
  }

  // Relations: the admin follows the viewer (a follower and a notification), the viewer follows back.
  assert.equal((await call('POST', `/api/users/${viewer.user.id}/follow`, admin.token)).status, 200);
  assert.equal((await call('POST', `/api/users/${admin.user.id}/follow`, viewer.token)).status, 200);
  assert.equal((await call('POST', '/api/friends', admin.token, { user_id: viewer.user.id })).status, 201);

  // Content shown by the read routes.
  const adminEvent = await insertEvent(admin.user.id, 'Sichtbarkeit Admin');
  const viewerEvent = await insertEvent(viewer.user.id, 'Sichtbarkeit Gast');
  assert.equal((await call('POST', `/api/activities/${viewerEvent}/join`, admin.token)).status, 200);
  await insert('INSERT INTO activity_comments (activity_id, user_id, body, created_at) VALUES (?, ?, ?, NOW())', [
    viewerEvent,
    admin.user.id,
    'Kommentar unter dem Event',
  ]);
  const post = await insert('INSERT INTO posts (user_id, body, created_at, updated_at) VALUES (?, ?, NOW(), NOW())', [
    viewer.user.id,
    'Ein Beitrag',
  ]);
  await insert('INSERT INTO post_comments (post_id, user_id, body, created_at) VALUES (?, ?, ?, NOW())', [
    post,
    admin.user.id,
    'Kommentar unter dem Beitrag',
  ]);
  await insert(
    `INSERT INTO stories (user_id, caption, image_path, created_at, expires_at)
     VALUES (?, 'Eine Story', 'stories/none.jpg', NOW(), NOW() + INTERVAL 1 DAY)`,
    [admin.user.id],
  );

  await check('profile', 'GET', `/api/users/${encodeURIComponent(admin.user.username)}`);
  await check('search', 'GET', `/api/users?q=${encodeURIComponent(admin.user.username)}`);
  await check('followers', 'GET', `/api/users/${encodeURIComponent(viewer.user.username)}/followers`);
  await check('following', 'GET', `/api/users/${encodeURIComponent(viewer.user.username)}/following`);
  await check('friend requests', 'GET', '/api/friends');
  await check('accept friend request', 'POST', '/api/friends', { body: { user_id: admin.user.id } });
  await check('friends', 'GET', '/api/friends');
  const created = await check('create group', 'POST', '/api/groups', {
    body: { name: 'Sichtbarkeit', members: [admin.user.id] },
    status: 201,
  });
  const groupId = created.data.id;
  await check('groups', 'GET', '/api/groups');
  await check('events', 'GET', '/api/activities');
  await check('event host', 'GET', `/api/activities/${adminEvent}`);
  await check('event participants', 'GET', `/api/activities/${viewerEvent}`);
  await check('event comments', 'GET', `/api/activities/${viewerEvent}/comments`);
  await check('post comments', 'GET', `/api/posts/${post}/comments`);
  await check('stories', 'GET', '/api/stories');
  await check('stories of one account', 'GET', `/api/users/${admin.user.id}/stories`);

  assert.equal((await call('POST', `/api/chats/group/${groupId}/messages`, admin.token, { body: 'Hallo Gruppe' })).status, 201);
  assert.equal((await call('POST', `/api/chats/activity/${viewerEvent}/messages`, admin.token, { body: 'Hallo Event' })).status, 201);
  await check('group chat', 'GET', `/api/chats/group/${groupId}/messages`);
  await check('event chat', 'GET', `/api/chats/activity/${viewerEvent}/messages`);
  await check('chat overview', 'GET', '/api/chats');
  await check('notifications', 'GET', '/api/notifications');

  await check('admin user list', 'GET', '/api/admin/users', { status: 403 });
  await check('admin reports', 'GET', '/api/admin/reports', { status: 403 });

  // Last: blocking hides the account from most of the lists above.
  await check('block', 'POST', '/api/blocks', { body: { user_id: admin.user.id }, status: 201 });
  await check('blocks', 'GET', '/api/blocks');

  // Denominator: every response in the list was checked, and none carried the flag.
  assert.deepEqual(checked, CHECKED_RESPONSES);
  assert.deepEqual(leaks, [], `${checked.length} responses checked`);
});

test('the owner sees is_admin on their own profile, and only there', async () => {
  const admin = await createUser('flagadm', { accountType: 'creator', isAdmin: true, created: createdUserIds });
  const member = await createUser('flagview', { accountType: 'creator', created: createdUserIds });
  const profile = async (token, username) => {
    const res = await call('GET', `/api/users/${encodeURIComponent(username)}`, token);
    assert.equal(res.status, 200);
    return res.json();
  };

  const own = await profile(admin.token, admin.user.username);
  assert.equal(own.is_me, true);
  assert.equal(own.user.is_admin, true);

  const ownMember = await profile(member.token, member.user.username);
  assert.equal(ownMember.is_me, true);
  assert.equal(ownMember.user.is_admin, false);

  // Not for someone else, whoever looks: an admin does not learn it from a profile either.
  const other = await profile(admin.token, member.user.username);
  assert.equal(other.is_me, false);
  assert.deepEqual(isAdminPaths(other), []);
});
