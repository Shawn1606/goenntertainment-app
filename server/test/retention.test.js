/**
 * The retention prune (F-16), through its command `npm run prune` (src/prune.js), against the real
 * database: what is older than each retention setting goes, what is younger stays, and files go
 * only when no row shows them any more. The server runs the same prune (src/retention.js) at start
 * and every hour; that part and the settings gate are in startup-settings.test.js and
 * config.test.js.
 *
 * The command runs as its own process, as an operator would start it, so this file needs no server
 * module beyond the database pool for setting up and checking. Each test seeds rows clearly on
 * either side of a setting and checks those rows (by id) BEFORE it looks at the exit code: without a
 * working prune the aged rows are simply still there.
 *
 * The prune deletes by age across the whole database. Other test files write only rows of today,
 * which no setting used here reaches.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ensureSchema, first, pool } from '../src/db.js';
import { PRIVATE_ROOT, rootFor } from '../src/storage.js';
import { TOKENABLE_TYPE, createUser, deleteTestUsers } from './support/fixtures.js';

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Test-only retention settings for the command; not a retention decision. */
const SETTINGS = {
  EVIDENCE_RETENTION_DAYS: '30',
  MODERATION_REPORT_RETENTION_DAYS: '60',
  TOKEN_RETENTION_DAYS: '2',
  USAGE_RETENTION_DAYS: '120',
};

/** Default token lifetime in minutes (SANCTUM_EXPIRATION unset, src/config.js). */
const LIFETIME_MINUTES = 43200;

/** Seconds an expired cache row stays (src/retention.js CACHE_EXPIRED_GRACE_SECONDS). */
const CACHE_GRACE_SECONDS = 24 * 60 * 60;

const createdUserIds = [];
const createdFiles = [];
const cleanup = { tokens: [], challenges: [], resetEmails: [], cacheKeys: [], reports: [] };

const stamp = () => crypto.randomBytes(6).toString('hex');
// Evidence lives in the private root (src/storage.js); the prune runs with cwd SERVER_DIR, so the
// files are written and checked under SERVER_DIR/storage-private whatever this process's cwd is.
const storagePath = (relative) => path.join(SERVER_DIR, 'storage-private', relative);

/** A small evidence file, where the moderation and the admin panel store them (private root). */
function evidenceFile() {
  assert.equal(rootFor('evidence'), PRIVATE_ROOT, 'evidence is stored in the private root');
  fs.mkdirSync(storagePath('evidence'), { recursive: true });
  const relative = `evidence/zret-test-${stamp()}.png`;
  fs.writeFileSync(storagePath(relative), Buffer.from('test-only image bytes'));
  createdFiles.push(relative);
  return relative;
}

const fileExists = (relative) => fs.existsSync(storagePath(relative));

async function insert(sql, params) {
  const [result] = await pool.query(sql, params);
  return result.insertId;
}

/** `npm run prune` with `env` on top of the test process's environment (database settings). */
function runPrune(env) {
  return spawnSync(process.execPath, ['src/prune.js'], {
    cwd: SERVER_DIR,
    env: { ...process.env, SANCTUM_EXPIRATION: '', ...env },
    encoding: 'utf8',
    timeout: 60_000,
  });
}

/** The counts of the command's "Retention prune: key=n ..." line. */
function printedCounts(stdout) {
  const line = stdout.split('\n').find((l) => l.startsWith('Retention prune: '));
  assert.ok(line, `no count line in the output:\n${stdout}`);
  return Object.fromEntries([...line.matchAll(/(\w+)=(\d+)/g)].map((m) => [m[1], Number(m[2])]));
}

before(async () => {
  await ensureSchema();
});

after(async () => {
  try {
    if (cleanup.tokens.length) await pool.query('DELETE FROM personal_access_tokens WHERE id IN (?)', [cleanup.tokens]);
    if (cleanup.challenges.length) await pool.query('DELETE FROM two_factor_challenges WHERE id IN (?)', [cleanup.challenges]);
    if (cleanup.resetEmails.length) await pool.query('DELETE FROM password_reset_tokens WHERE email IN (?)', [cleanup.resetEmails]);
    if (cleanup.cacheKeys.length) {
      await pool.query('DELETE FROM cache WHERE `key` IN (?)', [cleanup.cacheKeys]);
      await pool.query('DELETE FROM cache_locks WHERE `key` IN (?)', [cleanup.cacheKeys]);
    }
    if (cleanup.reports.length) await pool.query('DELETE FROM moderation_reports WHERE id IN (?)', [cleanup.reports]);
    await deleteTestUsers(pool, createdUserIds);
    for (const file of createdFiles) {
      try {
        fs.unlinkSync(storagePath(file));
      } catch {
        /* removed by the prune - which is what the tests check */
      }
    }
  } finally {
    await pool.end();
  }
});

/* ------------------------------------------------------------------ seeding */

/** A token row; `expires` and `created` are fixed SQL fragments of this file, never input. */
async function token(userId, expires, created) {
  const id = await insert(
    `INSERT INTO personal_access_tokens (tokenable_type, tokenable_id, name, token, abilities, expires_at, created_at, updated_at)
     VALUES (?, ?, 'retention-test', ?, '["*"]', ${expires}, ${created}, NOW())`,
    [TOKENABLE_TYPE, userId, crypto.randomBytes(32).toString('hex')],
  );
  cleanup.tokens.push(id);
  return id;
}

async function challenge(userId, expires) {
  const id = await insert(
    `INSERT INTO two_factor_challenges (user_id, token_hash, method, purpose, attempts, expires_at, created_at)
     VALUES (?, ?, 'email', 'login', 0, ${expires}, NOW())`,
    [userId, crypto.randomBytes(32).toString('hex')],
  );
  cleanup.challenges.push(id);
  return id;
}

async function resetLink(created) {
  const email = `zret-${stamp()}@example.invalid`;
  await pool.query(`INSERT INTO password_reset_tokens (email, token, created_at) VALUES (?, 'test-only-hash', ${created})`, [email]);
  cleanup.resetEmails.push(email);
  return email;
}

async function cacheRow(table, secondsFromNow) {
  const key = `zret-test:${stamp()}`;
  const other = table === 'cache' ? 'value' : 'owner';
  await pool.query(`INSERT INTO ${table} (\`key\`, ${other}, expiration) VALUES (?, 'test-only', UNIX_TIMESTAMP() + ?)`, [
    key,
    secondsFromNow,
  ]);
  cleanup.cacheKeys.push(key);
  return key;
}

async function banEvidence(userId, imagePath, daysAgo) {
  return insert(
    `INSERT INTO ban_evidence (user_id, admin_id, source, action, reason, banned_until, image_path, created_at)
     VALUES (?, NULL, 'admin', 'timeout', 'retention test', NULL, ?, NOW() - INTERVAL ? DAY)`,
    [userId, imagePath, daysAgo],
  );
}

async function moderationReport(userId, imagePath, daysAgo) {
  const id = await insert(
    `INSERT INTO moderation_reports (user_id, context, verdict, severity, action, title, body, image_path, created_at)
     VALUES (?, 'post', 'ok', 0, 'none', NULL, 'retention test text', ?, NOW() - INTERVAL ? DAY)`,
    [userId, imagePath, daysAgo],
  );
  cleanup.reports.push(id);
  return id;
}

const exists = async (sql, params) => (await first(sql, params)) !== null;

/* -------------------------------------------------------------------- tests */

test('npm run prune removes what is older than each retention setting and keeps the rest', async () => {
  const owner = (await createUser('zretowner', { created: createdUserIds })).user;
  const viewerOld = (await createUser('zretviewa', { created: createdUserIds })).user;
  const viewerNew = (await createUser('zretviewb', { created: createdUserIds })).user;
  const eventId = await insert(
    `INSERT INTO activities (user_id, title, description, location, starts_at, created_at, updated_at)
     VALUES (?, 'Retention test', 'Testbeschreibung', 'Teststrasse 1', NOW() + INTERVAL 1 DAY, NOW(), NOW())`,
    [owner.id],
  );

  // TOKEN_RETENTION_DAYS = 2: gone two days after a token stopped being valid.
  const tokens = {
    expiredLongAgo: await token(owner.id, 'NOW() - INTERVAL 3 DAY', 'NOW() - INTERVAL 4 DAY'),
    expiredRecently: await token(owner.id, 'NOW() - INTERVAL 1 DAY', 'NOW() - INTERVAL 2 DAY'),
    beyondLifetimeLongAgo: await token(owner.id, 'NULL', `NOW() - INTERVAL ${LIFETIME_MINUTES} MINUTE - INTERVAL 3 DAY`),
    beyondLifetimeRecently: await token(owner.id, 'NOW() + INTERVAL 1 DAY', `NOW() - INTERVAL ${LIFETIME_MINUTES} MINUTE - INTERVAL 1 DAY`),
    valid: await token(owner.id, 'NOW() + INTERVAL 1 DAY', 'NOW()'),
  };
  const challenges = {
    expiredLongAgo: await challenge(owner.id, 'NOW() - INTERVAL 3 DAY'),
    expiredRecently: await challenge(owner.id, 'NOW() - INTERVAL 1 DAY'),
    open: await challenge(owner.id, 'NOW() + INTERVAL 10 MINUTE'),
  };
  const resets = { old: await resetLink('NOW() - INTERVAL 3 DAY'), fresh: await resetLink('NOW()') };
  const cache = {
    expiredLongAgo: await cacheRow('cache', -2 * CACHE_GRACE_SECONDS),
    expiredRecently: await cacheRow('cache', -60),
    live: await cacheRow('cache', 3600),
  };
  const locks = { expiredLongAgo: await cacheRow('cache_locks', -2 * CACHE_GRACE_SECONDS), live: await cacheRow('cache_locks', 3600) };

  // USAGE_RETENTION_DAYS = 120 (the streak window): the 120th day back stays, the 121st goes.
  await pool.query(
    `INSERT INTO activity_views (activity_id, user_id, created_at)
     VALUES (?, ?, NOW() - INTERVAL 200 DAY), (?, ?, NOW() - INTERVAL 10 DAY)`,
    [eventId, viewerOld.id, eventId, viewerNew.id],
  );
  await pool.query(
    `INSERT INTO user_active_days (user_id, day)
     VALUES (?, CURDATE() - INTERVAL 121 DAY), (?, CURDATE() - INTERVAL 120 DAY), (?, CURDATE())`,
    [owner.id, owner.id, owner.id],
  );

  // EVIDENCE_RETENTION_DAYS = 30 (images), MODERATION_REPORT_RETENTION_DAYS = 60 (whole reports).
  const files = {
    banOld: evidenceFile(),
    shared: evidenceFile(),
    banNew: evidenceFile(),
    reportOld: evidenceFile(),
    reportVeryOld: evidenceFile(),
    reportNew: evidenceFile(),
  };
  const bans = {
    old: await banEvidence(owner.id, files.banOld, 40),
    oldShared: await banEvidence(owner.id, files.shared, 40),
    newShared: await banEvidence(owner.id, files.shared, 0),
    new: await banEvidence(owner.id, files.banNew, 0),
  };
  const reports = {
    old: await moderationReport(owner.id, files.reportOld, 40),
    veryOld: await moderationReport(owner.id, files.reportVeryOld, 70),
    new: await moderationReport(owner.id, files.reportNew, 0),
  };

  const r = runPrune(SETTINGS);

  // The database first: without a working prune every aged row is simply still there.
  const tokenStays = async (id) => exists('SELECT id FROM personal_access_tokens WHERE id = ?', [id]);
  assert.equal(await tokenStays(tokens.expiredLongAgo), false, 'a token expired three days ago is still there');
  assert.equal(await tokenStays(tokens.beyondLifetimeLongAgo), false, 'a token past its lifetime by three days is still there');
  assert.equal(await tokenStays(tokens.expiredRecently), true, 'a token expired one day ago was deleted');
  assert.equal(await tokenStays(tokens.beyondLifetimeRecently), true, 'a token past its lifetime by one day was deleted');
  assert.equal(await tokenStays(tokens.valid), true, 'a valid token was deleted');

  const challengeStays = async (id) => exists('SELECT id FROM two_factor_challenges WHERE id = ?', [id]);
  assert.equal(await challengeStays(challenges.expiredLongAgo), false, 'a challenge expired three days ago is still there');
  assert.equal(await challengeStays(challenges.expiredRecently), true);
  assert.equal(await challengeStays(challenges.open), true, 'an open challenge was deleted');

  const resetStays = async (email) => exists('SELECT email FROM password_reset_tokens WHERE email = ?', [email]);
  assert.equal(await resetStays(resets.old), false, 'a three days old reset link row is still there');
  assert.equal(await resetStays(resets.fresh), true);

  const cacheStays = async (table, key) => exists(`SELECT \`key\` FROM ${table} WHERE \`key\` = ?`, [key]);
  assert.equal(await cacheStays('cache', cache.expiredLongAgo), false, 'a cache row expired two days ago is still there');
  assert.equal(await cacheStays('cache', cache.expiredRecently), true, 'a cache row expired a minute ago was deleted');
  assert.equal(await cacheStays('cache', cache.live), true, 'a live cache row was deleted');
  assert.equal(await cacheStays('cache_locks', locks.expiredLongAgo), false, 'a lock expired two days ago is still there');
  assert.equal(await cacheStays('cache_locks', locks.live), true, 'a live lock was deleted');

  const [views] = await pool.query('SELECT user_id FROM activity_views WHERE activity_id = ?', [eventId]);
  assert.deepEqual(views.map((row) => row.user_id), [viewerNew.id], 'only the view of ten days ago may stay');
  const [days] = await pool.query(
    'SELECT DATEDIFF(CURDATE(), day) AS ago FROM user_active_days WHERE user_id = ? ORDER BY day',
    [owner.id],
  );
  assert.deepEqual(days.map((row) => Number(row.ago)), [120, 0], 'the 121st day back must go, the 120th stay');

  const banImage = async (id) => (await first('SELECT image_path FROM ban_evidence WHERE id = ?', [id]))?.image_path;
  assert.equal(await banImage(bans.old), null, 'the image of a 40 days old ban evidence row is still set');
  assert.equal(await banImage(bans.oldShared), null);
  assert.equal(await banImage(bans.newShared), files.shared);
  assert.equal(await banImage(bans.new), files.banNew);
  assert.ok(await exists('SELECT id FROM ban_evidence WHERE id = ?', [bans.old]), 'the ban evidence row itself must stay');

  const report = (id) => first('SELECT id, image_path FROM moderation_reports WHERE id = ?', [id]);
  assert.deepEqual(await report(reports.old), { id: reports.old, image_path: null }, 'a 40 days old report keeps its row, not its image');
  assert.equal(await report(reports.veryOld), null, 'a 70 days old moderation report is still there');
  assert.deepEqual(await report(reports.new), { id: reports.new, image_path: files.reportNew });

  for (const gone of [files.banOld, files.reportOld, files.reportVeryOld]) {
    assert.equal(fileExists(gone), false, `${gone} is still there`);
  }
  assert.equal(fileExists(files.shared), true, 'a file a younger ban evidence row still shows was deleted');
  assert.equal(fileExists(files.banNew), true);
  assert.equal(fileExists(files.reportNew), true);

  // Then the command itself: success, and counts (at least what this test seeded) - nothing else.
  assert.equal(r.status, 0, `exit code ${r.status}\n${r.stderr}`);
  const counts = printedCounts(r.stdout);
  const seeded = {
    tokens: 2,
    twoFactorChallenges: 1,
    resetLinks: 1,
    cacheRows: 1,
    cacheLocks: 1,
    activityViews: 1,
    activeDays: 1,
    evidenceImages: 4,
    moderationReports: 1,
    filesRemoved: 3,
  };
  for (const [key, min] of Object.entries(seeded)) {
    assert.ok(counts[key] >= min, `${key}: printed ${counts[key]}, this test alone seeded ${min}`);
  }
  for (const secretish of [resets.old, files.banOld]) {
    assert.ok(!r.stdout.includes(secretish) && !r.stderr.includes(secretish), 'the output must hold counts only');
  }
});

test('npm run prune names every missing or invalid setting and deletes nothing', async () => {
  const aged = await cacheRow('cache', -2 * CACHE_GRACE_SECONDS);
  const invalid = 'abc-test-only';

  const r = runPrune({
    EVIDENCE_RETENTION_DAYS: '',
    MODERATION_REPORT_RETENTION_DAYS: '30',
    TOKEN_RETENTION_DAYS: invalid,
    USAGE_RETENTION_DAYS: '30',
  });

  assert.equal(r.status, 1, `expected exit code 1, got ${r.status}`);
  for (const key of ['EVIDENCE_RETENTION_DAYS', 'TOKEN_RETENTION_DAYS', 'USAGE_RETENTION_DAYS']) {
    assert.match(r.stderr, new RegExp(key), `${key} is not named`);
  }
  assert.doesNotMatch(r.stderr, /MODERATION_REPORT_RETENTION_DAYS/, 'a valid setting was named');
  assert.ok(!r.stderr.includes(invalid) && !r.stdout.includes(invalid), 'the value must never be printed');
  assert.doesNotMatch(r.stdout, /Retention prune:/);
  assert.ok(await exists('SELECT `key` FROM cache WHERE `key` = ?', [aged]), 'something was pruned without valid settings');
});
