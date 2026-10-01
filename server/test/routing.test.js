/**
 * One owner per path (F-01), Node's side: Node serves none of the paths Laravel owns
 * (api/routes/api.php), and its routes match exactly one spelling: case-sensitive, no trailing
 * slash (src/router.js). Laravel's side, which derives the owned set from its route table and also
 * checks Node's route files, is api/tests/Feature/NodeTwinRoutesTest.php.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { createApp } from '../src/app.js';
import { ensureSchema, pool } from '../src/db.js';
import { cleanup, createUser } from './support/fixtures.js';

let base;
let server;

before(async () => {
  await ensureSchema();
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  try {
    await cleanup();
  } finally {
    await pool.end();
    server?.close();
  }
});

const send = (method, path, token) =>
  fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: method === 'GET' ? undefined : '{}',
  });

/**
 * The Laravel routes that Node used to serve as well (its "twins"). Laravel's other routes
 * (two-factor, password change) never had a Node copy.
 */
const LARAVEL_OWNED_TWINS = [
  ['GET', '/api/health'],
  ['POST', '/api/register'],
  ['POST', '/api/login'],
  ['GET', '/api/user'],
  ['PATCH', '/api/user'],
  ['DELETE', '/api/me'],
  ['POST', '/api/forgot-password'],
  ['POST', '/api/reset-password'],
  ['GET', '/api/interests'],
  ['GET', '/api/me/progress'],
  ['GET', '/api/leaderboard'],
  // Last: on a server that still had the copy, it would end the token's session.
  ['POST', '/api/logout'],
];

/** Node's own "unknown path" answer: what every other spelling of a route must get. */
async function isNodeNotFound(res) {
  const body = await res.json().catch(() => null);
  return res.status === 404 && body?.message === 'Nicht gefunden.';
}

test('every router file is made with createRouter() (case-sensitive and strict)', () => {
  const dir = new URL('../src/routes/', import.meta.url);
  const files = fs.readdirSync(dir).filter((name) => name.endsWith('.js'));
  assert.ok(files.length >= 14, `only ${files.length} router files found`);
  const wrong = [];
  for (const name of files) {
    const text = fs.readFileSync(new URL(name, dir), 'utf8');
    const made = text.match(/\bcreateRouter\(\)/g)?.length ?? 0;
    const bare = text.match(/(?<![\w.])Router\(/g)?.length ?? 0;
    if (made !== 1 || bare !== 0) wrong.push(`${name}: createRouter() x${made}, Router( x${bare}`);
  }
  assert.deepEqual(wrong, [], `${files.length} router files checked`);
});

/**
 * One route per mount: the spelling Laravel forwards is routed (whatever the route then answers),
 * another case of its last segment or of the mount prefix is Node's 404.
 */
const ONE_ROUTE_PER_MOUNT = [
  '/api/activities',
  '/api/admin/stats',
  '/api/business/insights',
  '/api/me/rewards',
  '/api/stories',
  '/api/friends',
  '/api/groups',
  '/api/chats',
  '/api/admin/reports',
  '/api/me/upgrade-request',
  '/api/notifications',
  '/api/me/subscription',
  '/api/users',
  '/internal/health',
];

const upperFirstOfLast = (path) => path.replace(/\/([a-z])([^/]*)$/, (_, c, rest) => `/${c.toUpperCase()}${rest}`);

test('routes match their lower-case spelling only', async () => {
  const { token } = await createUser('routingcase', { isAdmin: true, accountType: 'business' });
  // None of these routes answers 404 itself, so a 404 means: no route took the request. (Outside
  // /api and /internal the 404 is Express's own page, not JSON.)
  const status = async (path) => (await send('GET', path, token)).status;
  const leaks = [];
  for (const path of ONE_ROUTE_PER_MOUNT) {
    if ((await status(path)) === 404) leaks.push(`${path} is not routed at all`);
    const variant = upperFirstOfLast(path);
    if ((await status(variant)) !== 404) leaks.push(`${variant} is routed`);
  }
  for (const variant of ['/API/activities', '/Api/notifications', '/INTERNAL/health']) {
    if ((await status(variant)) !== 404) leaks.push(`${variant} is routed`);
  }
  assert.deepEqual(leaks, [], `${ONE_ROUTE_PER_MOUNT.length} mounts checked`);
});

test('strict routing: a trailing slash on a route below a mount is not the route', async () => {
  const { token } = await createUser('routingslash', { accountType: 'creator' });
  assert.equal((await send('GET', '/api/activities/history', token)).status, 200);
  assert.equal(await isNodeNotFound(await send('GET', '/api/activities/history/', token)), true);
  assert.equal(await isNodeNotFound(await send('GET', '/api/notifications/', token)), true);
});

test('Node no longer serves the paths Laravel owns (with a valid token, so not an auth refusal)', async () => {
  const { token } = await createUser('routingtwin');
  const served = [];
  for (const [method, path] of LARAVEL_OWNED_TWINS) {
    const res = await send(method, path, token);
    const body = await res.json().catch(() => null);
    if (res.status !== 404 || body?.message !== 'Nicht gefunden.') served.push(`${method} ${path} -> ${res.status}`);
  }
  assert.equal(LARAVEL_OWNED_TWINS.length, 12);
  assert.deepEqual(served, [], `${served.length} of ${LARAVEL_OWNED_TWINS.length} Laravel paths still served by Node`);
});
