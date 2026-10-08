/**
 * The accounts the system creates for itself - the seed's venue hosts and the importer's hosts
 * (src/system-accounts.js) - are accounts nobody signs in to. Their password is the bcrypt hash of
 * a secret from node:crypto that nobody ever sees: it is not printed and not kept. A password built
 * from Math.random is not unguessable: that generator is not made for secrets, and its state can
 * be worked out from its output.
 *
 * The first test only reads the source files. The others need MySQL with server/schema.sql; they
 * make hosts under stamped fixture names, except the seed run, which needs a database without the
 * seed's venue hosts (as test/system-hosts.test.js does) and removes the accounts it created.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import bcrypt from 'bcryptjs';

import { hashPassword } from '../src/auth.js';
import { ensureSchema, first, pool } from '../src/db.js';
import { ensureVenueHost as ensureImportHost } from '../src/import/store.js';
import * as seed from '../src/seed.js';
import { deleteTestUsers, uniqueStamp } from './support/fixtures.js';

const SERVER_DIR = path.resolve(import.meta.dirname, '..');
const SRC = path.join(SERVER_DIR, 'src');
const RECORD_RANDOM = pathToFileURL(path.join(SERVER_DIR, 'test', 'support', 'record-random.js')).href;
const SYSTEM_DOMAIN = 'goenntertainment.local';

/** The address the seed gives a venue host (seed.js ensureVenueHost builds the same one). */
const seedHostAddress = (username) => `dauerangebot+${username}@${SYSTEM_DOMAIN}`;

/** A bcrypt hash: $2a$, $2b$ or $2y$, a two-digit cost, then 22 characters of salt and 31 of digest. */
const BCRYPT_HASH = /^\$2[aby]\$\d\d\$[./A-Za-z0-9]{53}$/;
/** The start of a bcrypt hash anywhere in a text. */
const BCRYPT_IN_TEXT = /\$2[aby]\$\d\d\$/;
/** The least random bytes a system account's secret has (256 bits). */
const SECRET_BYTES = 32;

/** Every account this file made, removed at the end (with their events and tokens). */
const made = [];

/** Every .js file under src/, as a path relative to it. */
function sourceFiles(dir = SRC, rel = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...sourceFiles(path.join(dir, entry.name), relPath));
    else if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs')) out.push(relPath);
  }
  return out;
}

const readSource = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

/** The ways a secret of random bytes can be written as a password text. */
const spellings = (bytes) => ['base64url', 'base64', 'hex'].map((encoding) => bytes.toString(encoding));

/** Is `hash` the bcrypt hash of one of these secrets, in one of their spellings? */
async function hashOfOneOf(hash, secrets) {
  for (const bytes of secrets) {
    for (const text of spellings(bytes)) {
      if (await bcrypt.compare(text, hash)) return true;
    }
  }
  return false;
}

/** A test-only import source on the system domain, so nothing is created under a real host name. */
function fixtureSource() {
  const stamp = uniqueStamp();
  return {
    slug: `pwfixture${stamp}`,
    name: 'Fixture Host',
    host: { email: `import+pwfixture${stamp}@${SYSTEM_DOMAIN}`, username: `pwhost${stamp}` },
  };
}

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

test('no server source that creates an account or hashes a password uses Math.random', () => {
  const files = sourceFiles();
  const makers = files.filter((rel) => /\bINSERT\s+INTO\s+users\b|\bhashPassword\s*\(/i.test(readSource(rel)));
  // Denominator: the seed (the admin and the venue hosts) and the importer (its hosts) create accounts.
  for (const rel of ['seed.js', 'import/store.js']) {
    assert.ok(makers.includes(rel), `src/${rel} is not among the sources that create accounts`);
  }

  const sites = [];
  for (const rel of makers) {
    readSource(rel)
      .split(/\r?\n/)
      .forEach((line, i) => {
        if (/\bMath\s*\.\s*random\b/.test(line)) sites.push(`src/${rel}:${i + 1}`);
      });
  }
  console.log(
    `${files.length} files under src/ scanned; ${makers.length} create accounts or hash passwords ` +
      `(${makers.join(', ')}); ${sites.length} Math.random sites in them`,
  );
  assert.deepEqual(sites, [], 'a system account takes its password from systemAccountPasswordHash() (src/system-accounts.js)');
});

test('a host account the seed or the importer creates gets the bcrypt hash of a fresh node:crypto secret, printing nothing', async (t) => {
  const venue = { name: 'Fixture Venue', username: `pwvenue${uniqueStamp()}` };
  const source = fixtureSource();
  const cost = bcrypt.getRounds(await hashPassword('fixture-not-a-secret'));

  const mathRandom = t.mock.method(Math, 'random');
  const randomBytes = t.mock.method(crypto, 'randomBytes');
  syncBuiltinESMExports();
  const printed = [];
  for (const method of ['log', 'info', 'warn', 'error', 'debug']) {
    t.mock.method(console, method, (...args) => printed.push(`console.${method}: ${args.join(' ')}`));
  }
  try {
    made.push(await seed.ensureVenueHost(venue));
    made.push(await ensureImportHost(source));
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
  const ids = made.slice(-2);

  assert.equal(mathRandom.mock.callCount(), 0, 'a host password was built from Math.random');
  assert.deepEqual(printed, [], 'creating a host account printed something');
  const secrets = randomBytes.mock.calls
    .map((call) => call.result)
    .filter((bytes) => Buffer.isBuffer(bytes) && bytes.length >= SECRET_BYTES);
  assert.ok(secrets.length >= ids.length, `${secrets.length} values of ${SECRET_BYTES}+ bytes from node:crypto for ${ids.length} new accounts`);

  for (const id of ids) {
    const { password } = await first('SELECT password FROM users WHERE id = ?', [id]);
    assert.match(password, BCRYPT_HASH);
    assert.equal(bcrypt.getRounds(password), cost, 'not the bcrypt cost every password gets (src/auth.js)');
    assert.ok(await hashOfOneOf(password, secrets), `account ${id}: the password is not the hash of a secret from node:crypto`);
  }
});

test('the seed prints nothing secret: no host password, no secret behind one, no hash', async () => {
  const addresses = seed.PERMANENT.map((entry) => seedHostAddress(entry.host.username));
  const [existing] = await pool.query('SELECT id FROM users WHERE email IN (?)', [addresses]);
  // Precondition: the run must create the hosts, or there is no secret to look for in its output.
  assert.equal(existing.length, 0, 'the seed hosts exist already; this test needs a database loaded from server/schema.sql only');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-random-'));
  const recordFile = path.join(dir, 'random-bytes.txt');
  fs.writeFileSync(recordFile, '');
  const env = { ...process.env, RECORD_RANDOM_BYTES: recordFile };
  delete env.ADMIN_EMAIL;
  delete env.ADMIN_PASSWORD;

  try {
    const run = spawnSync(process.execPath, ['--import', RECORD_RANDOM, 'src/seed.js'], {
      cwd: SERVER_DIR,
      env,
      encoding: 'utf8',
      timeout: 120_000,
    });
    const out = `${run.stdout}\n${run.stderr}`;
    assert.equal(run.status, 0, out);

    const [hosts] = await pool.query('SELECT id, password FROM users WHERE email IN (?)', [addresses]);
    assert.equal(hosts.length, seed.PERMANENT.length, 'the seed did not create one account per venue host');

    // What the run drew from node:crypto: the host secrets and the bcrypt salts. Shorter values
    // (bcryptjs draws one byte to see whether a random source exists) could match by chance.
    const recorded = fs
      .readFileSync(recordFile, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((hex) => Buffer.from(hex, 'hex'))
      .filter((bytes) => bytes.length >= 16);
    const secrets = recorded.filter((bytes) => bytes.length >= SECRET_BYTES);
    for (const host of hosts) {
      assert.ok(await hashOfOneOf(host.password, secrets), `host ${host.id}: the password is not the hash of a secret from node:crypto`);
    }

    const leaks = [];
    if (BCRYPT_IN_TEXT.test(out)) leaks.push('a bcrypt hash');
    for (const host of hosts) {
      if (out.includes(host.password.slice(7))) leaks.push(`the password hash of host ${host.id}`);
    }
    recorded.forEach((bytes, i) => {
      if (spellings(bytes).some((text) => out.includes(text))) leaks.push(`random value ${i + 1} of ${recorded.length}`);
    });
    console.log(`${hosts.length} host accounts created; ${recorded.length} random values and ${secrets.length} secrets looked for in ${out.length} characters of output`);
    assert.deepEqual(leaks, [], 'the seed printed a secret');
  } finally {
    const [rows] = await pool.query('SELECT id FROM users WHERE email IN (?)', [addresses]);
    await deleteTestUsers(pool, rows.map((row) => row.id));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
