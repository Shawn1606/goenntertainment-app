/**
 * The seed and the importer take over an existing account for one of their hosts only when it is
 * exactly the system's own account (F-05).
 *
 * users.email compares under utf8mb4_unicode_ci, which ignores accents and width: an address that
 * differs from a host address only by an accented or full-width letter in the domain is a
 * different address (sign-up does not see the reserved domain in it), yet the hosts' lookup by
 * address finds it. Such an account is refused before anything is written - no business tier, no
 * events - and the seed exits 1. So is an account with the exact address but another username, and
 * one that holds the host's username under another address.
 *
 * Needs MySQL with server/schema.sql. Accounts made here use stamped names; the real host names
 * are only used where nothing is created under them, because other test files use them too. The
 * seed test runs the whole seed, which writes the interest list (idempotently) before it stops.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { ensureSchema, first, pool } from '../src/db.js';
import { ensureVenueHost as ensureImportHost } from '../src/import/store.js';
import { SOURCES } from '../src/import/sources.js';
// A namespace import: the seed's host function is exported only since this check exists.
import * as seed from '../src/seed.js';
import { deleteTestUsers, uniqueStamp } from './support/fixtures.js';

const SERVER_DIR = path.resolve(import.meta.dirname, '..');
const SYSTEM_DOMAIN = 'goenntertainment.local';

/** The address the seed gives a venue host (seed.js ensureVenueHost builds the same one). */
const seedHostAddress = (username) => `dauerangebot+${username}@${SYSTEM_DOMAIN}`;

/**
 * Addresses that differ from `address` (on the system domain) and that MySQL's utf8mb4_unicode_ci
 * still compares as equal to it: an accented letter, a combining accent, a full-width letter, and
 * the ligature "œ" for "oe".
 */
function lookalikes(address) {
  assert.ok(address.endsWith(`@${SYSTEM_DOMAIN}`), address);
  const local = address.slice(0, -SYSTEM_DOMAIN.length);
  return [
    ['precomposed accent', `${local}goenntertainment.locál`],
    ['combining accent', `${local}goenntertainment.locál`],
    ['full-width letter', `${local}goenntertainment.ｌocal`],
    ['ligature', `${local}gœnntertainment.local`],
  ];
}

/** Every account this file made, removed at the end (with their events and tokens). */
const made = [];

async function insertAccount({ email, username, accountType = 'standard' }) {
  const [result] = await pool.query(
    `INSERT INTO users (name, username, email, account_type, created_at, updated_at)
     VALUES ('Fixture Account', ?, ?, ?, NOW(), NOW())`,
    [username, email, accountType],
  );
  made.push(result.insertId);
  return result.insertId;
}

const accountRow = (id) =>
  first('SELECT username, email, account_type, granted_account_type, is_admin, updated_at FROM users WHERE id = ?', [id]);

async function eventCount(userId) {
  const row = await first('SELECT COUNT(*) AS n FROM activities WHERE user_id = ?', [userId]);
  return Number(row.n);
}

/** A test-only import source on the system domain, so nothing is created under a real host name. */
function fixtureSource() {
  const stamp = uniqueStamp();
  return {
    slug: `fixture${stamp}`,
    name: 'Fixture Host',
    host: { email: `import+fixture${stamp}@${SYSTEM_DOMAIN}`, username: `fixturehost${stamp}` },
  };
}

const isConflict = (err) => err?.name === 'SystemAccountConflict';

before(async () => {
  await ensureSchema();
});

after(async () => {
  try {
    await deleteTestUsers(pool, made);
  } finally {
    await pool.end();
  }
});

test('the importer refuses an account whose address only looks like its host address and changes nothing', async () => {
  const source = SOURCES[0];
  const cases = lookalikes(source.host.email);
  for (const [label, address] of cases) {
    const squatter = await insertAccount({ email: address, username: `squat${uniqueStamp()}` });
    try {
      // Precondition: the lookup by the host address finds this account.
      assert.equal((await first('SELECT id FROM users WHERE email = ?', [source.host.email]))?.id, squatter, label);
      const before = await accountRow(squatter);

      await assert.rejects(ensureImportHost(source), isConflict, `${label}: the account was taken over`);

      assert.deepEqual(await accountRow(squatter), before, `${label}: the account was changed`);
      assert.equal(await eventCount(squatter), 0, label);
    } finally {
      await deleteTestUsers(pool, [squatter]);
    }
  }
  assert.equal(cases.length, 4);
});

test('the importer refuses an account with its exact host address but another username', async () => {
  const source = fixtureSource();
  const holder = await insertAccount({ email: source.host.email, username: `other${uniqueStamp()}` });
  const before = await accountRow(holder);

  await assert.rejects(ensureImportHost(source), isConflict);

  assert.deepEqual(await accountRow(holder), before);
});

test('the importer refuses an account that holds its host username under another address', async () => {
  const source = fixtureSource();
  const holder = await insertAccount({
    email: `holder${uniqueStamp()}@example.invalid`,
    username: source.host.username.toUpperCase(),
  });
  const before = await accountRow(holder);

  await assert.rejects(ensureImportHost(source), isConflict);

  assert.deepEqual(await accountRow(holder), before);
});

test('the importer creates its host account, and takes over exactly that account on the next run', async () => {
  const source = fixtureSource();

  const id = await ensureImportHost(source);
  made.push(id);
  const created = await accountRow(id);
  assert.deepEqual(
    [created.email, created.username, created.account_type, created.granted_account_type],
    [source.host.email, source.host.username, 'business', 'business'],
  );

  assert.equal(await ensureImportHost(source), id, 'the second run made another account');

  // An admin may rename an account to its own name in another case (routes/admin.js).
  await pool.query('UPDATE users SET username = ? WHERE id = ?', [source.host.username.toUpperCase(), id]);
  assert.equal(await ensureImportHost(source), id, 'the account renamed in another case was not taken over');
});

test('the seed refuses an account whose address only looks like a venue host address, and exits 1', async () => {
  const host = seed.PERMANENT[0].host;
  const [, address] = lookalikes(seedHostAddress(host.username))[0];
  const squatter = await insertAccount({ email: address, username: `squat${uniqueStamp()}` });
  // The other hosts' rows as they were, so a run that went on can be undone exactly.
  const hostAddresses = seed.PERMANENT.map((entry) => seedHostAddress(entry.host.username));
  const [existing] = await pool.query('SELECT id FROM users WHERE email IN (?)', [hostAddresses]);
  const existingIds = new Set(existing.map((row) => row.id));

  try {
    assert.equal((await first('SELECT id FROM users WHERE email = ?', [seedHostAddress(host.username)]))?.id, squatter);
    const before = await accountRow(squatter);

    const env = { ...process.env };
    delete env.ADMIN_EMAIL;
    delete env.ADMIN_PASSWORD;
    const run = spawnSync(process.execPath, ['src/seed.js'], { cwd: SERVER_DIR, env, encoding: 'utf8', timeout: 120_000 });
    const out = `${run.stdout}\n${run.stderr}`;

    assert.equal(run.status, 1, out);
    assert.match(run.stderr, /SystemAccountConflict/);
    assert.equal(out.includes(address), false, 'the lookalike address was printed');
    assert.equal(out.includes(before.username), false, "the account's username was printed");
    assert.deepEqual(await accountRow(squatter), before, 'the account was changed');
    assert.equal(await eventCount(squatter), 0, 'the seed wrote events for the account');
  } finally {
    // A run that took the account over created the other hosts and their events: remove them.
    const [rows] = await pool.query('SELECT id FROM users WHERE email IN (?)', [hostAddresses]);
    await deleteTestUsers(pool, rows.map((row) => row.id).filter((id) => !existingIds.has(id) && id !== squatter));
  }
});

test("the seed's host function refuses lookalikes and takes over only its exact account", async () => {
  assert.equal(typeof seed.ensureVenueHost, 'function', 'seed.js exports ensureVenueHost');
  const username = `fixturevenue${uniqueStamp()}`;
  const entry = { name: 'Fixture Venue', username };

  for (const [label, address] of lookalikes(seedHostAddress(username))) {
    const squatter = await insertAccount({ email: address, username: `squat${uniqueStamp()}` });
    try {
      const before = await accountRow(squatter);
      await assert.rejects(seed.ensureVenueHost(entry), isConflict, label);
      assert.deepEqual(await accountRow(squatter), before, label);
    } finally {
      await deleteTestUsers(pool, [squatter]);
    }
  }

  const id = await seed.ensureVenueHost(entry);
  made.push(id);
  const created = await accountRow(id);
  assert.deepEqual([created.email, created.username, created.account_type], [seedHostAddress(username), username, 'business']);
  assert.equal(await seed.ensureVenueHost(entry), id, 'the second run made another account');
});
