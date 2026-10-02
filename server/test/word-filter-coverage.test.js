/**
 * The word filter covers every user text field of every Node write route, whatever the field's
 * JSON type (F-06).
 *
 * The denominator is the app's own route table: every POST/PUT/PATCH/DELETE route is in exactly
 * one of three tables below - FILTERED (its user text fields, 16 on 11 routes), NOT_FILTERED (free
 * text the fixed list deliberately does not check, with the reason) and NO_USER_TEXT (no free
 * text: ids, choices from a list, files, numbers). A new write route fails the first test until it
 * is placed in one of them.
 *
 * Every filtered field is then sent a blocked term three ways: as a string, inside an array and
 * inside an object (JSON, as a client can send it). Each must be refused with 422 at the field,
 * and nothing may be stored. Social links are also checked with the term in the path, in an
 * encoded path and in the host, and ordinary links must still pass.
 *
 * Laravel's text fields (register name and username, PATCH /api/user name and username) take
 * strings only (the `string` rule) and are tested in api/tests/Feature (RegisterTest,
 * UserProfileTest, NameInputTest).
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from '../src/app.js';
import { FUNCTIONAL_WRITE_LIMITS } from './support/app.js';
import { ensureSchema, first, pool } from '../src/db.js';
import { blockedTermMessageFor } from '../src/blocked-terms.js';
import { cleanup, createUser, uniqueStamp } from './support/fixtures.js';
import { TEST_INTERNAL_SECRET } from './support/startup-env.js';

// Blocked values already used by test/blocked-terms-routes.test.js (one per check mode).
const TEXT_TERM = 'Kommt alle, ihr Wichser';
const NAME_TERM = 'Hitler Fanclub';
const USERNAME_TERM = 'NaziKing';

const MSG_TEXT = blockedTermMessageFor('text');

const WRITE_METHODS = ['post', 'put', 'patch', 'delete'];

/** Write routes with user text: the fields the word filter checks. */
const FILTERED = {
  'POST /api/activities': ['title', 'description', 'location', 'custom_interests'],
  'POST /api/activities/:id/comments': ['body'],
  'PATCH /api/admin/users/:id': ['username'],
  'POST /api/stories': ['caption'],
  'POST /api/groups': ['name', 'description'],
  'PATCH /api/groups/:id': ['name', 'description'],
  'POST /api/chats/:kind/:refId/messages': ['body'],
  'PUT /api/me/links': ['links[].url'],
  'POST /api/posts': ['body'],
  'PATCH /api/posts/:id': ['body'],
  'POST /api/posts/:id/comments': ['body'],
};

/** Free text the fixed list deliberately leaves alone, each with the reason. */
const NOT_FILTERED = {
  'POST /api/reports':
    'note: read only by admins; a report quotes the abuse it reports, so a filter would refuse exactly the reports that matter',
  'POST /api/me/upgrade-request': 'message: read only by admins, never published',
  'POST /api/admin/users/:id/ban': 'reason: written by an admin',
  'POST /api/admin/users/:id/timeout': 'reason: written by an admin',
  'POST /api/admin/upgrade-requests/:id/reject': 'reason: written by an admin',
};

/** Write routes without free text. */
const NO_USER_TEXT = {
  'DELETE /api/activities/:id': 'no body',
  'POST /api/activities/:id/join': 'no body',
  'POST /api/activities/:id/view': 'no body',
  'POST /api/activities/:id/save': 'no body',
  'DELETE /api/activities/:id/save': 'no body',
  'DELETE /api/activities/:id/join': 'no body',
  'POST /api/activities/:id/like': 'no body',
  'DELETE /api/activities/:id/like': 'no body',
  'DELETE /api/activities/:id/comments/:commentId': 'no body',
  'POST /api/admin/users/:id/unban': 'no body',
  'DELETE /api/admin/users/:id': 'no body',
  'POST /api/admin/upgrade-requests/:id/approve': 'no body',
  'POST /api/business/activities/:id/boost': 'no body',
  'DELETE /api/business/activities/:id/boost': 'no body',
  'POST /api/me/rewards/redeem': 'coupon: a slug looked up in a fixed list',
  'POST /api/stories/:id/view': 'no body',
  'DELETE /api/stories/:id': 'no body',
  'POST /api/friends': 'user_id: a number',
  'DELETE /api/friends/:userId': 'no body',
  'POST /api/blocks': 'user_id: a number',
  'DELETE /api/blocks/:userId': 'no body',
  'POST /api/groups/:id/members': 'user_id: a number',
  'DELETE /api/groups/:id/members/:userId': 'no body',
  'DELETE /api/groups/:id': 'no body',
  'POST /api/chats/:kind/:refId/read': 'message_id: a number',
  'DELETE /api/chats/messages/:id': 'no body',
  'PATCH /api/admin/reports/:id': 'status: one of a fixed list',
  'POST /api/notifications/read': 'no body',
  'POST /api/notifications/:id/read': 'no body',
  'POST /api/webhooks/revenuecat': 'the store\'s event, never shown as user text',
  'POST /api/users/:id/follow': 'no body',
  'DELETE /api/users/:id/follow': 'no body',
  'POST /api/me/avatar': 'an image (moderated by the AI, test/moderation.test.js)',
  'DELETE /api/me/avatar': 'no body',
  'POST /api/me/banner': 'an image (moderated by the AI)',
  'DELETE /api/me/banner': 'no body',
  'POST /api/posts/:id/like': 'no body',
  'DELETE /api/posts/:id/like': 'no body',
  'DELETE /api/comments/:id': 'no body',
  'DELETE /api/posts/:id': 'no body',
  'DELETE /internal/accounts/:id(\\d+)': 'internal route, no body',
};

/** Where a router is mounted (literal mounts only, as in app.js; same as test/write-limits.test.js). */
function mountOf(layer) {
  const m = /^\^(.*?)\\\/\?\(\?=\\\/\|\$\)$/.exec(layer.regexp.source);
  if (!m) throw new Error(`unexpected mount pattern ${layer.regexp.source}`);
  return m[1].replace(/\\\//g, '/');
}

/** Every write route of an app as 'METHOD /path'. */
function writeRouteKeys(app) {
  const keys = [];
  for (const layer of app._router.stack) {
    if (!Array.isArray(layer.handle?.stack)) continue;
    const mount = mountOf(layer);
    for (const inner of layer.handle.stack) {
      if (!inner.route) continue;
      for (const method of WRITE_METHODS) {
        if (inner.route.methods[method]) {
          keys.push(`${method.toUpperCase()} ${mount}${inner.route.path === '/' && mount ? '' : inner.route.path}`);
        }
      }
    }
  }
  return keys;
}

let base;
let server;
let creator;
let admin;
let target;

before(async () => {
  await ensureSchema();
  server = createApp({ writeLimits: FUNCTIONAL_WRITE_LIMITS, internalSecret: TEST_INTERNAL_SECRET }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  creator = await createUser('wfcreator', { accountType: 'creator' });
  admin = await createUser('wfadmin', { isAdmin: true });
  target = await createUser('wftarget');
});

after(async () => {
  try {
    await cleanup();
  } finally {
    await pool.end();
    server?.close();
  }
});

function send(method, path, token, body) {
  return fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

const count = async (sql, params) => Number((await first(sql, params)).c);
const eventFields = () => ({
  title: 'Kickerabend',
  description: 'Wir spielen Kicker.',
  location: 'Teststrasse 1, 50667 Koeln',
  starts_at: new Date(Date.now() + 86_400_000).toISOString(),
});

/** Things the field cases write to: one event, one post, one group of the creator. */
async function fixtures() {
  const event = await send('POST', '/api/activities', creator.token, eventFields());
  assert.equal(event.status, 201, 'precondition: an event');
  const post = await send('POST', '/api/posts', creator.token, { body: 'Ein Beitrag' });
  assert.equal(post.status, 201, 'precondition: a post');
  const group = await send('POST', '/api/groups', creator.token, { name: `Kicker ${uniqueStamp(4)}`, description: 'Donnerstags' });
  assert.equal(group.status, 201, 'precondition: a group');
  return {
    eventId: (await event.json()).data.id,
    postId: (await post.json()).data.id,
    groupId: (await group.json()).data.id,
  };
}

/**
 * The 16 filtered fields: how to send a value to the field, where the error must be, and what
 * must not change (a count of rows or the stored value).
 */
function fieldCases({ eventId, postId, groupId }) {
  const c = creator.user.id;
  return [
    {
      field: 'POST /api/activities title',
      term: TEXT_TERM,
      error: 'title',
      request: (value) => send('POST', '/api/activities', creator.token, { ...eventFields(), title: value }),
      stored: () => count('SELECT COUNT(*) AS c FROM activities WHERE user_id = ?', [c]),
    },
    {
      field: 'POST /api/activities description',
      term: TEXT_TERM,
      error: 'description',
      request: (value) => send('POST', '/api/activities', creator.token, { ...eventFields(), description: value }),
      stored: () => count('SELECT COUNT(*) AS c FROM activities WHERE user_id = ?', [c]),
    },
    {
      field: 'POST /api/activities location',
      term: TEXT_TERM,
      error: 'location',
      request: (value) => send('POST', '/api/activities', creator.token, { ...eventFields(), location: value }),
      stored: () => count('SELECT COUNT(*) AS c FROM activities WHERE user_id = ?', [c]),
    },
    {
      field: 'POST /api/activities custom_interests',
      term: TEXT_TERM,
      error: 'interests',
      request: (value) => send('POST', '/api/activities', creator.token, { ...eventFields(), custom_interests: value }),
      stored: () => count('SELECT COUNT(*) AS c FROM activities WHERE user_id = ?', [c]),
    },
    {
      field: 'POST /api/activities/:id/comments body',
      term: TEXT_TERM,
      error: 'body',
      request: (value) => send('POST', `/api/activities/${eventId}/comments`, creator.token, { body: value }),
      stored: () => count('SELECT COUNT(*) AS c FROM activity_comments WHERE user_id = ?', [c]),
    },
    {
      field: 'PATCH /api/admin/users/:id username',
      term: USERNAME_TERM,
      error: 'username',
      request: (value) => send('PATCH', `/api/admin/users/${target.user.id}`, admin.token, { username: value }),
      stored: async () => (await first('SELECT username FROM users WHERE id = ?', [target.user.id])).username,
    },
    {
      field: 'POST /api/stories caption',
      term: TEXT_TERM,
      error: 'caption',
      request: (value) => send('POST', '/api/stories', creator.token, { caption: value }),
      stored: () => count('SELECT COUNT(*) AS c FROM stories WHERE user_id = ?', [c]),
    },
    {
      field: 'POST /api/groups name',
      term: NAME_TERM,
      error: 'name',
      request: (value) => send('POST', '/api/groups', creator.token, { name: value }),
      stored: () => count('SELECT COUNT(*) AS c FROM friend_groups WHERE owner_id = ?', [c]),
    },
    {
      field: 'POST /api/groups description',
      term: TEXT_TERM,
      error: 'description',
      request: (value) => send('POST', '/api/groups', creator.token, { name: 'Kickerrunde', description: value }),
      stored: () => count('SELECT COUNT(*) AS c FROM friend_groups WHERE owner_id = ?', [c]),
    },
    {
      field: 'PATCH /api/groups/:id name',
      term: NAME_TERM,
      error: 'name',
      request: (value) => send('PATCH', `/api/groups/${groupId}`, creator.token, { name: value }),
      stored: async () => (await first('SELECT name FROM friend_groups WHERE id = ?', [groupId])).name,
    },
    {
      field: 'PATCH /api/groups/:id description',
      term: TEXT_TERM,
      error: 'description',
      request: (value) => send('PATCH', `/api/groups/${groupId}`, creator.token, { description: value }),
      stored: async () => (await first('SELECT description FROM friend_groups WHERE id = ?', [groupId])).description,
    },
    {
      field: 'POST /api/chats/:kind/:refId/messages body',
      term: TEXT_TERM,
      error: 'body',
      request: (value) => send('POST', `/api/chats/group/${groupId}/messages`, creator.token, { body: value }),
      stored: () => count('SELECT COUNT(*) AS c FROM chat_messages WHERE user_id = ?', [c]),
    },
    {
      field: 'PUT /api/me/links links[].url',
      term: 'https://example.invalid/wichser',
      error: 'links',
      request: (value) => send('PUT', '/api/me/links', creator.token, { links: [{ platform: 'website', url: value }] }),
      stored: () => count('SELECT COUNT(*) AS c FROM user_links WHERE user_id = ?', [c]),
    },
    {
      field: 'POST /api/posts body',
      term: TEXT_TERM,
      error: 'body',
      request: (value) => send('POST', '/api/posts', creator.token, { body: value }),
      stored: () => count('SELECT COUNT(*) AS c FROM posts WHERE user_id = ?', [c]),
    },
    {
      field: 'PATCH /api/posts/:id body',
      term: TEXT_TERM,
      error: 'body',
      request: (value) => send('PATCH', `/api/posts/${postId}`, creator.token, { body: value }),
      stored: async () => (await first('SELECT body FROM posts WHERE id = ?', [postId])).body,
    },
    {
      field: 'POST /api/posts/:id/comments body',
      term: TEXT_TERM,
      error: 'body',
      request: (value) => send('POST', `/api/posts/${postId}/comments`, creator.token, { body: value }),
      stored: () => count('SELECT COUNT(*) AS c FROM post_comments WHERE user_id = ?', [c]),
    },
  ];
}

test('every write route is placed: filtered fields, deliberately unfiltered text, or no text (denominator)', () => {
  const app = createApp({ writeLimits: FUNCTIONAL_WRITE_LIMITS, internalSecret: TEST_INTERNAL_SECRET });
  const routes = writeRouteKeys(app);
  assert.ok(routes.length > 0, 'no write route found: the check would prove nothing');
  const tables = [FILTERED, NOT_FILTERED, NO_USER_TEXT];
  const placed = tables.flatMap((table) => Object.keys(table));
  assert.deepEqual([...routes].sort(), [...placed].sort(), 'every write route in exactly one table');
  assert.equal(new Set(placed).size, placed.length, 'no route in two tables');
  console.log(
    `${routes.length} write routes: ${Object.keys(FILTERED).length} with filtered text, ` +
      `${Object.keys(NOT_FILTERED).length} with unfiltered text, ${Object.keys(NO_USER_TEXT).length} without user text`,
  );
  assert.equal(Object.values(FILTERED).flat().length, 16, 'filtered fields');
});

test('every filtered field refuses a blocked term as a string, in an array and in an object', async () => {
  const cases = fieldCases(await fixtures());
  const listed = Object.entries(FILTERED).flatMap(([route, fields]) => fields.map((f) => `${route} ${f}`));
  assert.deepEqual(cases.map((x) => x.field).sort(), listed.sort(), 'one case per filtered field');

  const failures = [];
  for (const x of cases) {
    for (const [shape, value] of [
      ['string', x.term],
      ['array', [x.term]],
      ['object', { text: x.term }],
    ]) {
      const before = await x.stored();
      const res = await x.request(value);
      const json = await res.json();
      const label = `${x.field} (${shape})`;
      if (res.status !== 422 || !json.errors?.[x.error]) failures.push(`${label}: ${res.status} ${JSON.stringify(json)}`);
      if (shape === 'string' && x.error !== 'username' && x.term !== NAME_TERM && !json.errors?.[x.error]?.includes(MSG_TEXT)) {
        failures.push(`${label}: not the word filter's message: ${JSON.stringify(json.errors)}`);
      }
      const after = await x.stored();
      if (JSON.stringify(after) !== JSON.stringify(before)) failures.push(`${label}: stored ${JSON.stringify(after)}`);
    }
  }
  assert.deepEqual(failures, []);
});

test('social links: a blocked term in the path, encoded or in the host is refused', async () => {
  for (const url of [
    'https://example.invalid/wichser',
    'https://example.invalid/%77ichser',
    'https://example.invalid/%2577ichser',
    'https://wichser.example.invalid/',
    'https://www.instagram.com/ihr.wichser',
  ]) {
    const res = await send('PUT', '/api/me/links', creator.token, { links: [{ platform: 'website', url }] });
    assert.equal(res.status, 422, url);
    assert.deepEqual((await res.json()).errors, { links: [MSG_TEXT] }, url);
  }
});

test('social links: ordinary profile links still pass (no false alarm on harmless words)', async () => {
  const links = [
    { platform: 'instagram', url: 'https://www.instagram.com/scunthorpe_runners' },
    { platform: 'tiktok', url: 'https://www.tiktok.com/@essex.boardgames' },
    { platform: 'youtube', url: 'https://www.youtube.com/@analytics-cafe' },
    { platform: 'x', url: 'https://x.com/sussex_hiking' },
    { platform: 'facebook', url: 'https://www.facebook.com/cocktailbar.example' },
    { platform: 'twitch', url: 'https://www.twitch.tv/assassins_creed_club' },
    { platform: 'linkedin', url: 'https://www.linkedin.com/company/therapist-network' },
    { platform: 'website', url: 'https://example.invalid/events?ort=essen&tag=2026-10-01#programm' },
  ];
  const res = await send('PUT', '/api/me/links', creator.token, { links });
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
  assert.equal((await res.json()).links.length, links.length);
});
