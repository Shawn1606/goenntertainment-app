/**
 * Every write is limited per account and per client address (F-07, F-31).
 *
 * The denominator is the app's own route table: every POST/PUT/PATCH/DELETE route the server
 * mounts, read from the built app. EXPECTED below is the documented table (the PR text lists the
 * same routes with their classes and rules); the first test fails when a write route has no
 * limiter, sits in another class, or a route is added or removed without updating the table.
 *
 * Limits under test come in through createApp({ writeLimits }) or are the production defaults
 * (writeLimits {}: no override; the test process sets no WRITE_LIMIT_* variable). Every request
 * comes from 127.0.0.1, so the per-address tests either give each test its own app (own counters)
 * or forward a client address from the trusted hop.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { createApp } from '../src/app.js';
import { requireAuth } from '../src/auth.js';
import { ensureSchema, pool } from '../src/db.js';
import { cleanup, createUser } from './support/fixtures.js';
import { FUNCTIONAL_WRITE_LIMITS } from './support/app.js';
import { TEST_INTERNAL_SECRET } from './support/startup-env.js';

/** The answer to a limited request: the same text as Laravel's (api/app/Providers/AppServiceProvider.php). */
const RATE_LIMIT_MESSAGE = 'Zu viele Versuche – bitte warte kurz und probier es dann noch mal.';

const WRITE_METHODS = ['post', 'put', 'patch', 'delete'];

/** Every write route with its class; 'exempt' with the reason in EXEMPT. */
const EXPECTED = [
  'POST /api/activities moderated',
  'DELETE /api/activities/:id content',
  'POST /api/activities/:id/join state',
  'POST /api/activities/:id/view state',
  'POST /api/activities/:id/save state',
  'DELETE /api/activities/:id/save state',
  'DELETE /api/activities/:id/join state',
  'POST /api/activities/:id/like reaction',
  'DELETE /api/activities/:id/like reaction',
  'POST /api/activities/:id/comments comment',
  'DELETE /api/activities/:id/comments/:commentId content',
  'PATCH /api/admin/users/:id admin',
  'POST /api/admin/users/:id/ban admin',
  'POST /api/admin/users/:id/timeout admin',
  'POST /api/admin/users/:id/unban admin',
  'DELETE /api/admin/users/:id admin',
  'POST /api/admin/upgrade-requests/:id/approve admin',
  'POST /api/admin/upgrade-requests/:id/reject admin',
  'POST /api/business/activities/:id/boost content',
  'DELETE /api/business/activities/:id/boost content',
  'POST /api/me/rewards/redeem account',
  'POST /api/stories moderated',
  'POST /api/stories/:id/view state',
  'DELETE /api/stories/:id content',
  'POST /api/friends relationship',
  'DELETE /api/friends/:userId relationship',
  'POST /api/blocks block',
  'DELETE /api/blocks/:userId block',
  'POST /api/groups content',
  'PATCH /api/groups/:id content',
  'POST /api/groups/:id/members content',
  'DELETE /api/groups/:id/members/:userId content',
  'DELETE /api/groups/:id content',
  'POST /api/chats/:kind/:refId/messages chat',
  'POST /api/chats/:kind/:refId/read state',
  'DELETE /api/chats/messages/:id content',
  'POST /api/reports report',
  'PATCH /api/admin/reports/:id admin',
  'POST /api/me/upgrade-request account',
  'POST /api/notifications/read state',
  'POST /api/notifications/:id/read state',
  'POST /api/webhooks/revenuecat webhook',
  'POST /api/users/:id/follow relationship',
  'DELETE /api/users/:id/follow relationship',
  'PUT /api/me/links content',
  'POST /api/me/avatar moderated',
  'DELETE /api/me/avatar content',
  'POST /api/me/banner moderated',
  'DELETE /api/me/banner content',
  'POST /api/posts moderated',
  'PATCH /api/posts/:id moderated',
  'POST /api/posts/:id/like reaction',
  'DELETE /api/posts/:id/like reaction',
  'POST /api/posts/:id/comments comment',
  'DELETE /api/comments/:id content',
  'DELETE /api/posts/:id content',
  'DELETE /internal/accounts/:id(\\d+) exempt',
];

/** Write routes without the limiter, each with its reason. */
const EXEMPT = {
  'DELETE /internal/accounts/:id(\\d+)':
    "secret-gated internal route with a one-time grant per account; Laravel's account-sensitive throttle runs first, and Laravel calls it without a client address",
};

/** Where a router is mounted, from the layer's pattern (literal mounts only, as in app.js). */
function mountOf(layer) {
  const m = /^\^(.*?)\\\/\?\(\?=\\\/\|\$\)$/.exec(layer.regexp.source);
  if (!m) throw new Error(`unexpected mount pattern ${layer.regexp.source}`);
  return m[1].replace(/\\\//g, '/');
}

/** Every write route of an app: { key: 'METHOD /path', handles: [middleware...] }. */
function writeRoutes(app) {
  const routes = [];
  for (const layer of app._router.stack) {
    if (!Array.isArray(layer.handle?.stack)) continue; // not a router
    const mount = mountOf(layer);
    for (const inner of layer.handle.stack) {
      if (!inner.route) continue;
      for (const method of WRITE_METHODS) {
        if (!inner.route.methods[method]) continue;
        const handles = inner.route.stack.filter((l) => l.method === method || l.method === undefined).map((l) => l.handle);
        routes.push({ key: `${method.toUpperCase()} ${mount}${inner.route.path === '/' && mount ? '' : inner.route.path}`, handles });
      }
    }
  }
  return routes;
}

const classOf = (handle) => handle?.rateLimitClass;

/** Every class with `rule` (webhook: address rules only). */
function everyClass(userRule, ipRule) {
  return Object.fromEntries(
    Object.keys(FUNCTIONAL_WRITE_LIMITS).map((cls) => [cls, cls === 'webhook' ? ipRule : `${userRule},${ipRule}`]),
  );
}

/**
 * Starts an app with the given write limits ({} = the production defaults) and, optionally, a
 * trust-proxy setting; returns its base address and a stop function.
 */
async function startApp({ writeLimits, trustProxy }) {
  const server = createApp({ internalSecret: TEST_INTERNAL_SECRET, trustProxy, writeLimits }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, stop: () => new Promise((r) => server.close(r)) };
}

function call(base, method, routePath, { token, body = {}, headers = {} } = {}) {
  return fetch(`${base}${routePath}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

/** A concrete path for a route pattern: ids that exist nowhere, the room kind 'group'. */
const concrete = (pattern) => pattern.replace(/:kind\b/, 'group').replace(/:\w+(\([^)]*\))?/g, '999999999');

before(async () => {
  // The default tests must see the code's defaults, not a setting of the machine running them.
  assert.deepEqual(Object.keys(process.env).filter((key) => key.startsWith('WRITE_LIMIT_')), []);
  await ensureSchema();
});

after(async () => {
  try {
    await cleanup();
  } finally {
    await pool.end();
  }
});

test('every write route is limited and in its documented class (the denominator)', () => {
  const app = createApp({ writeLimits: FUNCTIONAL_WRITE_LIMITS, internalSecret: TEST_INTERNAL_SECRET });
  const routes = writeRoutes(app);
  assert.ok(routes.length > 0, 'no write route found: the check would prove nothing');

  const actual = [];
  const misplaced = [];
  const counts = {};
  for (const { key, handles } of routes) {
    const limiters = handles.filter(classOf);
    const label = limiters.length === 0 ? (Object.hasOwn(EXEMPT, key) ? 'exempt' : 'NO-LIMITER') : limiters.map(classOf).join('+');
    actual.push(`${key} ${label}`);
    counts[label] = (counts[label] ?? 0) + 1;
    if (limiters.length === 0) continue;
    // Right after requireAuth (first on a route without an account), so role checks and
    // uploads only run for requests within the limit.
    const want = handles[0] === requireAuth ? 1 : 0;
    if (limiters.length !== 1 || handles.indexOf(limiters[0]) !== want) misplaced.push(`${key}: limiter at ${handles.indexOf(limiters[0])}, expected ${want}`);
  }

  console.log(`${routes.length} write routes: ${Object.entries(counts).map(([c, n]) => `${c} ${n}`).join(', ')}`);
  console.log(actual.map((line) => `  ${line}`).join('\n'));
  assert.deepEqual([...actual].sort(), [...EXPECTED].sort());
  assert.deepEqual(misplaced, []);
  assert.equal(EXPECTED.length, 57);
});

test('every write route answers 429 once its class limit is used up', async () => {
  const node = await startApp({ writeLimits: everyClass('user:1/1h', 'ip:100000/1h') });
  // Webhook: its own app with one request per address (it has no account).
  const webhook = await startApp({ writeLimits: { ...everyClass('user:1/1h', 'ip:100000/1h'), webhook: 'ip:1/1h' } });
  try {
    const routes = writeRoutes(createApp({ writeLimits: FUNCTIONAL_WRITE_LIMITS, internalSecret: TEST_INTERNAL_SECRET })).filter(
      ({ key }) => !Object.hasOwn(EXEMPT, key),
    );
    assert.equal(routes.length, 56);
    for (const { key } of routes) {
      const [method, pattern] = key.split(' ');
      const routePath = concrete(pattern);
      const anonymous = pattern === '/api/webhooks/revenuecat';
      const base = anonymous ? webhook.url : node.url;
      // A fresh account per route: the per-account counter of the class starts at zero.
      const token = anonymous ? undefined : (await createUser('limitroute', { isAdmin: pattern.startsWith('/api/admin/') })).token;

      const first = await call(base, method, routePath, { token });
      assert.notEqual(first.status, 429, `${key}: the first request was refused`);
      if (!anonymous) assert.notEqual(first.status, 401, `${key}: the fixture token was not accepted`);
      await first.arrayBuffer();

      const second = await call(base, method, routePath, { token });
      assert.equal(second.status, 429, `${key}: the second request was not limited`);
      assert.deepEqual(await second.json(), { message: RATE_LIMIT_MESSAGE }, key);
      assert.ok(Number(second.headers.get('retry-after')) >= 1, `${key}: Retry-After ${second.headers.get('retry-after')}`);
    }
  } finally {
    await node.stop();
    await webhook.stop();
  }
});

/**
 * F-07 with the production defaults: each write the review names stops at its class's per-account
 * limit. The numbers are the documented defaults (src/rate-limit.js DEFAULT_WRITE_LIMITS, the PR
 * table); each case gets its own app, so the per-address counters start at zero too.
 */
const F07 = [
  { name: 'post comments', limit: 20, setup: 'post', send: (b, t, s) => call(b, 'POST', `/api/posts/${s.postId}/comments`, { token: t, body: { body: 'Schoener Beitrag!' } }) },
  { name: 'avatar uploads', limit: 10, send: (b, t) => call(b, 'POST', '/api/me/avatar', { token: t }) },
  { name: 'banner uploads', limit: 10, send: (b, t) => call(b, 'POST', '/api/me/banner', { token: t }) },
  { name: 'event creation', limit: 10, send: (b, t) => call(b, 'POST', '/api/activities', { token: t }) },
  { name: 'follows', limit: 30, setup: 'target', send: (b, t, s) => call(b, 'POST', `/api/users/${s.targetId}/follow`, { token: t }) },
  { name: 'friend requests', limit: 30, setup: 'target', send: (b, t, s) => call(b, 'POST', '/api/friends', { token: t, body: { user_id: s.targetId } }) },
  { name: 'follow/unfollow loop', limit: 30, setup: 'target', send: (b, t, s, i) => call(b, i % 2 ? 'DELETE' : 'POST', `/api/users/${s.targetId}/follow`, { token: t }) },
  { name: 'like/unlike loop on posts', limit: 60, setup: 'post', send: (b, t, s, i) => call(b, i % 2 ? 'DELETE' : 'POST', `/api/posts/${s.postId}/like`, { token: t }) },
  { name: 'reports', limit: 10, setup: 'target', send: (b, t, s) => call(b, 'POST', '/api/reports', { token: t, body: { target_type: 'user', target_id: s.targetId, reason: 'spam' } }) },
  { name: 'event comments', limit: 20, setup: 'activity', send: (b, t, s) => call(b, 'POST', `/api/activities/${s.activityId}/comments`, { token: t, body: { body: 'Bin dabei!' } }) },
  { name: 'event like/unlike loop', limit: 60, setup: 'activity', send: (b, t, s, i) => call(b, i % 2 ? 'DELETE' : 'POST', `/api/activities/${s.activityId}/like`, { token: t }) },
];

for (const c of F07) {
  test(`defaults (F-07): ${c.name} stop at ${c.limit} per account`, async () => {
    const node = await startApp({ writeLimits: {} });
    try {
      const owner = await createUser('limitowner', { accountType: 'creator' });
      const setup = {};
      if (c.setup === 'target') setup.targetId = owner.user.id;
      if (c.setup === 'post') {
        const [r] = await pool.query("INSERT INTO posts (user_id, body, created_at, updated_at) VALUES (?, 'Hallo', NOW(), NOW())", [owner.user.id]);
        setup.postId = r.insertId;
      }
      if (c.setup === 'activity') {
        const [r] = await pool.query(
          `INSERT INTO activities (user_id, title, description, location, starts_at, created_at, updated_at)
           VALUES (?, 'Kickerabend', 'Wir spielen Kicker.', 'Teststrasse 1', NOW() + INTERVAL 1 DAY, NOW(), NOW())`,
          [owner.user.id],
        );
        setup.activityId = r.insertId;
      }
      const { token } = await createUser('limitactor', { accountType: 'creator' });

      let firstRefused = null;
      for (let i = 1; i <= c.limit + 1; i += 1) {
        const res = await c.send(node.url, token, setup, i);
        await res.arrayBuffer();
        if (res.status === 401) assert.fail(`${c.name}: request ${i} was not authenticated`);
        if (res.status === 429) {
          firstRefused = i;
          break;
        }
      }
      assert.equal(firstRefused, c.limit + 1, `${c.name}: first 429 at request ${firstRefused}`);
    } finally {
      await node.stop();
    }
  });
}

test('the per-address limit holds across accounts', async () => {
  const node = await startApp({ writeLimits: { ...FUNCTIONAL_WRITE_LIMITS, reaction: 'user:100/1h,ip:2/1h' } });
  try {
    const statuses = [];
    const accounts = [await createUser('limitipa'), await createUser('limitipb'), await createUser('limitipc')];
    for (const { token } of accounts) {
      const res = await call(node.url, 'POST', '/api/posts/999999999/like', { token });
      await res.arrayBuffer();
      statuses.push(res.status);
    }
    assert.notEqual(statuses[0], 429);
    assert.notEqual(statuses[1], 429);
    assert.equal(statuses[2], 429, `statuses ${statuses.join(', ')}`);
  } finally {
    await node.stop();
  }
});

test('the per-address limit counts the client address forwarded by the trusted hop, not the hop or a spoofed entry (F-31)', async () => {
  const limits = { ...FUNCTIONAL_WRITE_LIMITS, reaction: 'user:100/1h,ip:1/1h' };
  const like = (base, token, forwardedFor) =>
    call(base, 'POST', '/api/posts/999999999/like', { token, headers: { 'X-Forwarded-For': forwardedFor } }).then(async (res) => {
      await res.arrayBuffer();
      return res.status;
    });
  const tokens = [
    (await createUser('limitxffa')).token,
    (await createUser('limitxffb')).token,
    (await createUser('limitxffc')).token,
    (await createUser('limitxffd')).token,
  ];

  // Trusted hop (Laravel on loopback): each forwarded client has its own bucket.
  const trusted = await startApp({ trustProxy: 'loopback', writeLimits: limits });
  try {
    assert.notEqual(await like(trusted.url, tokens[0], '198.51.100.1'), 429, 'client 1, first request');
    assert.notEqual(await like(trusted.url, tokens[1], '198.51.100.2'), 429, 'client 2 is not counted on the hop address');
    assert.equal(await like(trusted.url, tokens[2], '198.51.100.1'), 429, 'client 1 again, from another account');
    // Only the last entry counts (the one Laravel wrote); an entry the client put in front does not.
    assert.equal(await like(trusted.url, tokens[3], '203.0.113.9, 198.51.100.2'), 429, 'a spoofed first entry does not make a new bucket');
  } finally {
    await trusted.stop();
  }

  // Untrusted peer: its forwarding header is ignored, every request counts on the peer's address.
  const untrusted = await startApp({ trustProxy: '10.255.255.1', writeLimits: limits });
  try {
    assert.notEqual(await like(untrusted.url, tokens[0], '198.51.100.1'), 429);
    assert.equal(await like(untrusted.url, tokens[1], '198.51.100.2'), 429, 'a header from an untrusted peer chose the bucket');
  } finally {
    await untrusted.stop();
  }
});

test('a realistic session stays well under the defaults', async () => {
  const node = await startApp({ writeLimits: {} });
  try {
    const owner = await createUser('limitsessowner', { accountType: 'creator' });
    const [r] = await pool.query("INSERT INTO posts (user_id, body, created_at, updated_at) VALUES (?, 'Hallo', NOW(), NOW())", [owner.user.id]);
    const { token } = await createUser('limitsession');
    const statuses = [];
    const record = async (res) => {
      await res.arrayBuffer();
      statuses.push(res.status);
    };
    for (let i = 0; i < 10; i += 1) await record(await call(node.url, i % 2 ? 'DELETE' : 'POST', `/api/posts/${r.insertId}/like`, { token }));
    for (let i = 0; i < 5; i += 1) await record(await call(node.url, 'POST', `/api/posts/${r.insertId}/comments`, { token, body: { body: `Kommentar ${i}` } }));
    for (let i = 0; i < 5; i += 1) await record(await call(node.url, i % 2 ? 'DELETE' : 'POST', `/api/users/${owner.user.id}/follow`, { token }));
    for (let i = 0; i < 10; i += 1) await record(await call(node.url, 'POST', '/api/notifications/read', { token }));
    assert.ok(!statuses.includes(429), `refused in a normal session: ${statuses.join(', ')}`);
    assert.equal(statuses.length, 30);
  } finally {
    await node.stop();
  }
});

test('a 429 on an upload is delivered, not a connection reset', async () => {
  const node = await startApp({ writeLimits: { ...FUNCTIONAL_WRITE_LIMITS, moderated: 'user:1/1h,ip:1000/1h' } });
  try {
    const { token } = await createUser('limitupload', { accountType: 'creator' });
    const first = await call(node.url, 'POST', '/api/me/avatar', { token });
    await first.arrayBuffer();
    const form = new FormData();
    form.append('image', new Blob([Buffer.alloc(1024 * 1024, 0x61)], { type: 'image/png' }), 'gross.png');
    const res = await fetch(`${node.url}/api/me/avatar`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
    assert.equal(res.status, 429);
    assert.deepEqual(await res.json(), { message: RATE_LIMIT_MESSAGE });
  } finally {
    await node.stop();
  }
});

test('every createApp() in the server tests passes writeLimits (functional or its own)', () => {
  const dir = import.meta.dirname;
  const files = fs.readdirSync(dir).filter((name) => name.endsWith('.test.js'));
  const missing = [];
  let calls = 0;
  for (const name of files) {
    // Code only: without comments and single-quoted strings (test names, messages).
    const text = fs
      .readFileSync(path.join(dir, name), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/'(?:[^'\\\n]|\\.)*'/g, "''");
    for (const m of text.matchAll(/\bcreateApp\(/g)) {
      // The argument text up to the matching parenthesis.
      let depth = 1;
      let i = m.index + m[0].length;
      while (i < text.length && depth > 0) {
        if (text[i] === '(') depth += 1;
        else if (text[i] === ')') depth -= 1;
        i += 1;
      }
      const args = text.slice(m.index + m[0].length, i - 1);
      calls += 1;
      if (!/\bwriteLimits\b/.test(args)) missing.push(`${name}: app built with (${args})`);
    }
  }
  console.log(`${calls} calls of createApp in ${files.length} test files, ${missing.length} without writeLimits`);
  assert.ok(calls >= 10, `only ${calls} calls found`);
  assert.deepEqual(missing, []);
});
