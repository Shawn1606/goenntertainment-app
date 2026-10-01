/**
 * The admin seed only creates the admin (F-05): `npm run seed:admin` (node src/seed.js
 * --only=admin) refuses, and changes nothing, when the address or the username "admin" is
 * already taken; it never promotes, renames or resets an account; it exits 1 without
 * ADMIN_EMAIL/ADMIN_PASSWORD; and it never prints the address.
 *
 * The CLI runs as a child process against the test database (the DB_* settings of this process).
 * Values are obviously fake. Every test starts with an empty "admin" slot, so none depends on what
 * an earlier one left behind.
 */
import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import bcrypt from 'bcryptjs';

import { ensureSchema, first, pool } from '../src/db.js';
import { TOKENABLE_TYPE, cleanup, createUser, uniqueStamp } from './support/fixtures.js';

const SERVER_DIR = path.resolve(import.meta.dirname, '..');
const ADMIN_PASSWORD = 'Fixture-Admin-Pass-not-a-secret-1';

/** Runs the admin seed with exactly these ADMIN_* values (undefined = unset). */
function seedAdmin({ email, password }) {
  const env = { ...process.env };
  delete env.ADMIN_EMAIL;
  delete env.ADMIN_PASSWORD;
  if (email !== undefined) env.ADMIN_EMAIL = email;
  if (password !== undefined) env.ADMIN_PASSWORD = password;
  const run = spawnSync(process.execPath, ['src/seed.js', '--only=admin'], {
    cwd: SERVER_DIR,
    env,
    encoding: 'utf8',
    timeout: 60_000,
  });
  return { code: run.status, out: `${run.stdout}\n${run.stderr}`, stderr: run.stderr };
}

const freshAddress = () => `seed-admin-${uniqueStamp()}@example.invalid`;
const adminRow = () => first("SELECT * FROM users WHERE username = 'admin'");

async function deleteAdminSlot() {
  const row = await adminRow();
  if (!row) return;
  await pool.query('DELETE FROM personal_access_tokens WHERE tokenable_type = ? AND tokenable_id = ?', [TOKENABLE_TYPE, row.id]);
  await pool.query('DELETE FROM users WHERE id = ?', [row.id]);
}

before(async () => {
  await ensureSchema();
});

beforeEach(async () => {
  await deleteAdminSlot();
});

after(async () => {
  try {
    await deleteAdminSlot();
    await cleanup();
  } finally {
    await pool.end();
  }
});

test('seed:admin refuses an existing address and changes nothing', async () => {
  const { user, token } = await createUser('seedtaken');
  const before = await first('SELECT * FROM users WHERE id = ?', [user.id]);

  const run = seedAdmin({ email: user.email, password: ADMIN_PASSWORD });

  assert.equal(run.code, 1, run.out);
  assert.match(run.stderr, /Admin: refused/);
  assert.equal(run.out.includes(user.email), false, 'the address must not be printed');
  const afterRow = await first('SELECT * FROM users WHERE id = ?', [user.id]);
  assert.equal(afterRow.is_admin, 0);
  assert.equal(afterRow.username, before.username);
  assert.equal(afterRow.password, before.password);
  assert.equal(afterRow.account_type, before.account_type);
  const tokenId = token.slice(0, token.indexOf('|'));
  assert.ok(await first('SELECT id FROM personal_access_tokens WHERE id = ?', [tokenId]), 'the token was deleted');
  assert.equal(await adminRow(), null, 'an admin was created after all');
});

test('seed:admin refuses when the username admin is taken by another address', async () => {
  const holder = freshAddress();
  await pool.query(
    `INSERT INTO users (name, username, email, account_type, is_admin, created_at, updated_at)
     VALUES ('Fixture Holder', 'admin', ?, 'standard', 0, NOW(), NOW())`,
    [holder],
  );
  const wanted = freshAddress();

  const run = seedAdmin({ email: wanted, password: ADMIN_PASSWORD });

  assert.equal(run.code, 1, run.out);
  assert.match(run.stderr, /Admin: refused/);
  assert.doesNotMatch(run.out, /Seed fehlgeschlagen/);
  assert.equal(await first('SELECT id FROM users WHERE email = ?', [wanted]), null);
  const row = await adminRow();
  assert.equal(row.email, holder);
  assert.equal(row.is_admin, 0);
});

test('seed:admin creates the admin on an empty slot, without printing the address', async () => {
  const email = freshAddress();

  const run = seedAdmin({ email, password: ADMIN_PASSWORD });

  assert.equal(run.code, 0, run.out);
  assert.equal(run.out.includes(email), false, 'the address must not be printed');
  const row = await adminRow();
  assert.equal(row.email, email);
  assert.equal(row.is_admin, 1);
  assert.equal(row.account_type, 'business_plus');
  assert.equal(await bcrypt.compare(ADMIN_PASSWORD, row.password), true);
});

test('running the seed again does not reset the admin password', async () => {
  const email = freshAddress();
  assert.equal(seedAdmin({ email, password: ADMIN_PASSWORD }).code, 0, 'the first run creates the admin');
  const before = await adminRow();
  assert.ok(before, 'the first run created no admin');

  const run = seedAdmin({ email, password: `${ADMIN_PASSWORD}-other` });

  assert.equal(run.code, 1, run.out);
  assert.match(run.stderr, /Admin: refused/);
  const afterRow = await adminRow();
  assert.equal(afterRow.password, before.password);
  assert.equal(afterRow.updated_at, before.updated_at);
});

test('seed:admin without ADMIN_EMAIL or ADMIN_PASSWORD exits 1 naming only the missing settings', async () => {
  const neither = seedAdmin({});
  assert.equal(neither.code, 1, neither.out);
  assert.match(neither.stderr, /ADMIN_EMAIL and ADMIN_PASSWORD must be set/);

  const email = freshAddress();
  const noPassword = seedAdmin({ email, password: '' });
  assert.equal(noPassword.code, 1, noPassword.out);
  assert.match(noPassword.stderr, /ADMIN_PASSWORD must be set/);
  assert.doesNotMatch(noPassword.stderr, /ADMIN_EMAIL /);
  assert.equal(noPassword.out.includes(email), false, 'the address must not be printed');

  assert.equal(await adminRow(), null);
});
