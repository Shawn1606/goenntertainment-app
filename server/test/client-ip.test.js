/**
 * The real client address (F-31), Node's side: Node believes X-Forwarded-For (and -Proto, -Host)
 * only from the one configured hop, Laravel (createApp's trustProxy option; NODE_TRUST_PROXY in
 * production). Then `req.ip` is the client address Laravel passes on, and from any other peer it
 * is that peer: the key that per-address rate limits use.
 *
 * Each test builds its own app with the trust setting it needs. `req.ip` and `req.protocol` are
 * read through a test-only route added to that app (GET /test-only/client), never part of the
 * server. The requests come from 127.0.0.1, so "trusted hop" is loopback and an untrusted setting
 * names another address.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from '../src/app.js';
import { FUNCTIONAL_WRITE_LIMITS } from './support/app.js';
import { ensureSchema, pool } from '../src/db.js';
import { cleanup, createUser } from './support/fixtures.js';

const CLIENT = '203.0.113.7';
const UNTRUSTED_HOP = '10.255.255.1';
const savedPublicUrl = process.env.PUBLIC_URL;

/** Starts createApp(options) plus the test-only route; returns its base address and a stop function. */
async function start(options) {
  const app = createApp({ writeLimits: FUNCTIONAL_WRITE_LIMITS, ...options });
  app.get('/test-only/client', (req, res) => res.json({ ip: req.ip, protocol: req.protocol }));
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  return {
    app,
    url: `http://127.0.0.1:${server.address().port}`,
    stop: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function clientSeenBy(options, headers) {
  const node = await start(options);
  try {
    return await (await fetch(`${node.url}/test-only/client`, { headers })).json();
  } finally {
    await node.stop();
  }
}

const isLoopback = (ip) => ip === '127.0.0.1' || ip === '::ffff:127.0.0.1' || ip === '::1';

before(async () => {
  await ensureSchema();
  // Image addresses are built from the request only without PUBLIC_URL.
  delete process.env.PUBLIC_URL;
});

after(async () => {
  if (savedPublicUrl !== undefined) process.env.PUBLIC_URL = savedPublicUrl;
  try {
    await cleanup();
  } finally {
    await pool.end();
  }
});

test('X-Forwarded-For from the trusted Laravel hop is the client address', async () => {
  const seen = await clientSeenBy({ trustProxy: 'loopback' }, { 'X-Forwarded-For': CLIENT });
  assert.equal(seen.ip, CLIENT);
});

test('X-Forwarded-For from any other peer is ignored: the peer is the address', async () => {
  const seen = await clientSeenBy({ trustProxy: UNTRUSTED_HOP }, { 'X-Forwarded-For': CLIENT });
  assert.ok(isLoopback(seen.ip), `req.ip is ${seen.ip}`);
});

test('a chain from the trusted hop counts only its last entry', async () => {
  const seen = await clientSeenBy({ trustProxy: 'loopback' }, { 'X-Forwarded-For': `192.0.2.66, ${CLIENT}` });
  assert.equal(seen.ip, CLIENT);
});

test('the trust function trusts exactly the configured hop', async () => {
  const trust = createApp({ trustProxy: '10.0.0.20', writeLimits: FUNCTIONAL_WRITE_LIMITS }).get('trust proxy fn');
  assert.equal(trust('10.0.0.20', 0), true);
  assert.equal(trust('::ffff:10.0.0.20', 0), true);
  for (const other of ['10.0.0.21', '127.0.0.1', '172.17.0.1', CLIENT]) {
    assert.equal(trust(other, 0), false, `${other} must not be trusted`);
  }
});

test('X-Forwarded-Proto and -Host count only from the trusted hop (image addresses)', async () => {
  const { user } = await createUser('clientipimg', { accountType: 'creator' });
  await pool.query('UPDATE users SET avatar = ? WHERE id = ?', ['avatars/fixture-client-ip.png', user.id]);
  const viewer = await createUser('clientipview');
  const headers = {
    Authorization: `Bearer ${viewer.token}`,
    'X-Forwarded-Proto': 'https',
    'X-Forwarded-Host': 'spoofed.example.invalid',
  };

  for (const [trustProxy, expected] of [
    [UNTRUSTED_HOP, /^http:\/\/127\.0\.0\.1:\d+\/storage\/avatars\//],
    ['loopback', /^https:\/\/spoofed\.example\.invalid\/storage\/avatars\//],
  ]) {
    const node = await start({ trustProxy });
    try {
      const res = await fetch(`${node.url}/api/users/${user.username}`, { headers });
      assert.equal(res.status, 200);
      assert.match(String((await res.json()).user.avatar), expected, `trust ${trustProxy}`);
    } finally {
      await node.stop();
    }
  }
});

test('the scheme Express derives follows the same rule', async () => {
  const untrusted = await clientSeenBy({ trustProxy: UNTRUSTED_HOP }, { 'X-Forwarded-Proto': 'https' });
  assert.equal(untrusted.protocol, 'http');
  const trusted = await clientSeenBy({ trustProxy: 'loopback' }, { 'X-Forwarded-Proto': 'https' });
  assert.equal(trusted.protocol, 'https');
});
