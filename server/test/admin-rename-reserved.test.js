/**
 * An admin cannot give another account a username the system reserves for itself
 * (shared/reserved-accounts.json, F-05): PATCH /api/admin/users/:id is the one Node route that
 * writes a username. An account that already has such a name keeps it.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from '../src/app.js';
import { ensureSchema, first, pool } from '../src/db.js';
import { cleanup, createUser } from './support/fixtures.js';
import { FUNCTIONAL_WRITE_LIMITS } from './support/app.js';

const MSG_RESERVED = 'Dieser Benutzername ist reserviert – bitte wähle einen anderen.';

let base;
let server;

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
    await pool.end();
    server?.close();
  }
});

const rename = (token, id, username) =>
  fetch(`${base}/api/admin/users/${id}`, {
    method: 'PATCH',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ username }),
  });

test('an admin cannot rename an account to a reserved username, in any case', async () => {
  const admin = await createUser('renameadmin', { isAdmin: true });
  const { user } = await createUser('renametarget');

  for (const name of ['admin', 'Admin', 'NOERGELBUFF', 'freibad-goettingen']) {
    const res = await rename(admin.token, user.id, name);
    assert.equal(res.status, 422, name);
    const body = await res.json();
    assert.deepEqual(body.errors?.username, [MSG_RESERVED], name);
  }

  assert.equal((await first('SELECT username FROM users WHERE id = ?', [user.id])).username, user.username);
});

test('other names still work, and an account keeps the reserved name it has', async () => {
  const admin = await createUser('renameadmin', { isAdmin: true });
  const { user } = await createUser('renametarget');

  const plain = await rename(admin.token, user.id, `${user.username}x`.slice(0, 30));
  assert.equal(plain.status, 200);

  // A system account (here: given the import host's name directly; no test creates that host)
  // may be renamed to its own name in another case.
  await pool.query("UPDATE users SET username = 'noergelbuff' WHERE id = ?", [user.id]);
  try {
    const same = await rename(admin.token, user.id, 'NoergelBuff');
    assert.equal(same.status, 200);
  } finally {
    await pool.query('UPDATE users SET username = ? WHERE id = ?', [user.username, user.id]);
  }
});
