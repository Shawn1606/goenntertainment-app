/**
 * One owner per path (F-01), Node's side: Node serves none of the paths Laravel owns
 * (api/routes/api.php). Laravel's side, which derives the owned set from its route table and also
 * checks Node's route files, is api/tests/Feature/NodeTwinRoutesTest.php.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

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
