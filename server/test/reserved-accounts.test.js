/**
 * The usernames and e-mail domains the system creates accounts with are reserved
 * (shared/reserved-accounts.json, F-05), and the list stays complete: every username the seed or
 * the importer creates, and every domain they use, is on it. Laravel's half:
 * api/tests/Feature/ReservedAccountsTest.php; the admin rename: admin-rename-reserved.test.js.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { pool } from '../src/db.js';
import {
  RESERVED_ACCOUNTS,
  isReservedEmail,
  isReservedUsername,
  loadReservedAccounts,
} from '../src/reserved-accounts.js';
import { ADMIN_USERNAME, PERMANENT, seededUsernames } from '../src/seed.js';
import { SOURCES } from '../src/import/sources.js';

// Importing the seed opens no connection (its main() runs only as a CLI); end the pool anyway.
after(() => pool.end());

test('every username the seed or the importer creates is reserved', () => {
  const created = [...seededUsernames(), ...SOURCES.map((source) => source.host.username)];

  // Denominator: the admin, the venue hosts and the import hosts.
  assert.equal(created.length, 1 + PERMANENT.length + SOURCES.length);
  assert.ok(created.includes(ADMIN_USERNAME));
  assert.deepEqual(created.filter((name) => !isReservedUsername(name)), [], `${created.length} usernames checked`);
});

test('every e-mail domain the seed or the importer uses is reserved', () => {
  const seedSource = fs.readFileSync(new URL('../src/seed.js', import.meta.url), 'utf8');
  const seedDomains = [...seedSource.matchAll(/@([a-z0-9.-]+\.[a-z]{2,})`/g)].map((m) => m[1]);
  const addresses = [...seedDomains.map((d) => `host@${d}`), ...SOURCES.map((source) => source.host.email)];

  assert.ok(seedDomains.length >= 1, 'the venue-host address pattern of seed.js was not found');
  assert.deepEqual(addresses.filter((address) => !isReservedEmail(address)), [], `${addresses.length} addresses checked`);
});

test('the checks ignore case and cover subdomains, and nothing else', () => {
  assert.equal(isReservedUsername('admin'), true);
  assert.equal(isReservedUsername('ADMIN'), true);
  assert.equal(isReservedUsername(' Admin '), true);
  assert.equal(isReservedUsername('administrator'), false);
  assert.equal(isReservedUsername('admin2'), false);
  assert.equal(isReservedUsername(null), false);

  const [domain] = RESERVED_ACCOUNTS.emailDomains;
  assert.equal(isReservedEmail(`someone@${domain}`), true);
  assert.equal(isReservedEmail(`someone@${domain.toUpperCase()}`), true);
  assert.equal(isReservedEmail(`someone@sub.${domain}`), true);
  assert.equal(isReservedEmail(`someone@not${domain}`), false);
  assert.equal(isReservedEmail('someone@example.invalid'), false);
  assert.equal(isReservedEmail(undefined), false);
});

test('the list is read from shared/; a missing or empty list stops the server', () => {
  assert.ok(RESERVED_ACCOUNTS.usernames.length >= 5);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reserved-accounts-'));
  try {
    assert.throws(() => loadReservedAccounts(path.join(dir, 'missing.json')), /ENOENT/);
    const empty = path.join(dir, 'empty.json');
    fs.writeFileSync(empty, JSON.stringify({ usernames: [], email_domains: ['x.invalid'] }));
    assert.throws(() => loadReservedAccounts(empty), /non-empty 'usernames' and 'email_domains'/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Node and Laravel read the same file', () => {
  const php = fs.readFileSync(new URL('../../api/app/Support/ReservedAccounts.php', import.meta.url), 'utf8');
  assert.match(php, /'\/shared\/reserved-accounts\.json'/);
});
