/**
 * Long inputs are refused at the boundary, before any pattern runs (F-02).
 *
 * Denominator: every Node route field that goes through the word filter (14 field sites in 8
 * routes, src/routes/*.js: rejectBlockedTerms / findBlockedTerm). For each one:
 *   - one character over the route's own cap: the route's own length message, fast - the route
 *     caps before the filter;
 *   - 100,000 characters: refused by the body limits (JSON 32 KB, multipart field 16 KB) with
 *     413, fast.
 * Plus the other patterns that read request text: the chat message clean-up and the people
 * search.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from '../src/app.js';
import { ensureSchema, pool } from '../src/db.js';
import { cleanup, createUser } from './support/fixtures.js';

const MSG_TOO_LARGE = 'Die Anfrage ist zu groß.';
/** Generous bound per request: the refusals here take a few milliseconds. */
const FAST_MS = 1000;

let base;
let server;
let creator;
let member;
let admin;
let target;
let activityId;
let postId;
let groupId;

before(async () => {
  await ensureSchema();
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  creator = await createUser('capscreator', { accountType: 'creator' });
  member = await createUser('capsmember');
  admin = await createUser('capsadmin', { isAdmin: true });
  target = await createUser('capstarget');

  const [activity] = await pool.query(
    `INSERT INTO activities (user_id, title, description, location, starts_at, created_at, updated_at)
     VALUES (?, 'Kickerabend', 'Wir spielen Kicker.', 'Teststrasse 1', NOW() + INTERVAL 1 DAY, NOW(), NOW())`,
    [creator.user.id],
  );
  activityId = activity.insertId;
  const [post] = await pool.query(
    "INSERT INTO posts (user_id, body, image_path, created_at, updated_at) VALUES (?, 'Hallo', NULL, NOW(), NOW())",
    [creator.user.id],
  );
  postId = post.insertId;
  const group = await send('POST', '/api/groups', member.token, { name: 'Testrunde' });
  assert.equal(group.status, 201);
  groupId = (await group.json()).data.id;
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

function sendForm(path, token, fields) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return fetch(`${base}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
}

const eventFields = () => ({
  title: 'Kickerabend',
  description: 'Wir spielen Kicker.',
  location: 'Teststrasse 1, 50667 Koeln',
  starts_at: new Date(Date.now() + 86_400_000).toISOString(),
});

/**
 * The 14 field sites. `request(value)` sends the field with `value`; `cap` is the route's own
 * maximum, `message` its length message (at `field` in the errors).
 */
function fieldSites() {
  return [
    { site: 'POST /api/activities title', cap: 255, field: 'title', message: 'Der Titel ist erforderlich (max. 255 Zeichen).',
      request: (v) => sendForm('/api/activities', creator.token, { ...eventFields(), title: v }) },
    { site: 'POST /api/activities description', cap: 2000, field: 'description', message: 'Die Beschreibung ist erforderlich (max. 2000 Zeichen).',
      request: (v) => sendForm('/api/activities', creator.token, { ...eventFields(), description: v }) },
    { site: 'POST /api/activities location', cap: 255, field: 'location', message: 'Der Ort ist erforderlich (max. 255 Zeichen).',
      request: (v) => sendForm('/api/activities', creator.token, { ...eventFields(), location: v }) },
    { site: 'POST /api/activities/:id/comments body', cap: 500, field: 'body', message: 'Ein Kommentar fasst hoechstens 500 Zeichen.',
      request: (v) => send('POST', `/api/activities/${activityId}/comments`, member.token, { body: v }) },
    { site: 'PATCH /api/admin/users/:id username', cap: 30, field: 'username', message: 'Der Benutzername ist ungueltig (3-30 Zeichen, nur Buchstaben/Zahlen/-_).',
      request: (v) => send('PATCH', `/api/admin/users/${target.user.id}`, admin.token, { username: v }) },
    { site: 'POST /api/chats/:kind/:refId/messages body', cap: 1000, field: 'body', message: 'Eine Nachricht fasst hoechstens 1000 Zeichen.',
      request: (v) => send('POST', `/api/chats/group/${groupId}/messages`, member.token, { body: v }) },
    { site: 'POST /api/groups name', cap: 60, field: 'name', message: 'Der Name fasst hoechstens 60 Zeichen.',
      request: (v) => send('POST', '/api/groups', member.token, { name: v }) },
    { site: 'POST /api/groups description', cap: 200, field: 'description', message: 'Die Beschreibung fasst hoechstens 200 Zeichen.',
      request: (v) => send('POST', '/api/groups', member.token, { name: 'Runde', description: v }) },
    { site: 'PATCH /api/groups/:id name', cap: 60, field: 'name', message: 'Der Name fasst hoechstens 60 Zeichen.',
      request: (v) => send('PATCH', `/api/groups/${groupId}`, member.token, { name: v }) },
    { site: 'PATCH /api/groups/:id description', cap: 200, field: 'description', message: 'Die Beschreibung fasst hoechstens 200 Zeichen.',
      request: (v) => send('PATCH', `/api/groups/${groupId}`, member.token, { description: v }) },
    { site: 'POST /api/posts body', cap: 1000, field: 'body', message: 'Ein Beitrag fasst hoechstens 1000 Zeichen.',
      request: (v) => sendForm('/api/posts', creator.token, { body: v }) },
    { site: 'PATCH /api/posts/:id body', cap: 1000, field: 'body', message: 'Ein Beitrag fasst hoechstens 1000 Zeichen.',
      request: (v) => send('PATCH', `/api/posts/${postId}`, creator.token, { body: v }) },
    { site: 'POST /api/posts/:id/comments body', cap: 500, field: 'body', message: 'Ein Kommentar fasst hoechstens 500 Zeichen.',
      request: (v) => send('POST', `/api/posts/${postId}/comments`, member.token, { body: v }) },
    { site: 'POST /api/stories caption', cap: 200, field: 'caption', message: 'Die Unterschrift fasst hoechstens 200 Zeichen.',
      request: (v) => sendForm('/api/stories', creator.token, { caption: v }) },
  ];
}

async function timed(fn) {
  const started = performance.now();
  const res = await fn();
  return { res, ms: performance.now() - started };
}

test('every word-filter field refuses one character over its cap with its own length message, fast', async () => {
  const sites = fieldSites();
  assert.equal(sites.length, 14);
  for (const s of sites) {
    const { res, ms } = await timed(() => s.request('x'.repeat(s.cap + 1)));
    assert.equal(res.status, 422, s.site);
    const body = await res.json();
    assert.ok((body.errors?.[s.field] ?? []).includes(s.message), `${s.site}: ${JSON.stringify(body)}`);
    assert.ok(ms < FAST_MS, `${s.site}: ${ms.toFixed(0)} ms`);
  }
});

test('every word-filter field refuses 100,000 characters with 413 at the body limits, fast', async () => {
  for (const s of fieldSites()) {
    const { res, ms } = await timed(() => s.request('x'.repeat(100_000)));
    assert.equal(res.status, 413, s.site);
    assert.equal((await res.json()).message, MSG_TOO_LARGE, s.site);
    assert.ok(ms < FAST_MS, `${s.site}: ${ms.toFixed(0)} ms`);
  }
});

test('a chat message is refused by length before its clean-up patterns run', async () => {
  // 2001 line breaks: within the body limit, would clean up to almost nothing - refused first.
  const { res, ms } = await timed(() => send('POST', `/api/chats/group/${groupId}/messages`, member.token, { body: '\r\n'.repeat(1001) }));
  assert.equal(res.status, 422);
  assert.deepEqual((await res.json()).errors, { body: ['Eine Nachricht fasst hoechstens 1000 Zeichen.'] });
  assert.ok(ms < FAST_MS, `${ms.toFixed(0)} ms`);
});

test('a people search longer than any name finds nothing and runs no pattern', async () => {
  const res = await fetch(`${base}/api/users?q=${'a'.repeat(256)}`, { headers: { Authorization: `Bearer ${member.token}` } });
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).data, []);
  // A term of the longest name still searches.
  const ok = await fetch(`${base}/api/users?q=${encodeURIComponent(target.user.username)}`, {
    headers: { Authorization: `Bearer ${member.token}` },
  });
  assert.ok((await ok.json()).data.some((u) => u.id === target.user.id));
});
