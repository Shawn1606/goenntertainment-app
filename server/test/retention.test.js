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
 * which no setting used here reaches. Files are another matter: the prune also removes aged
 * evidence files that no row shows, and src/storage.js finds the private root through the working
 * directory. So the command runs in a folder of this test (PRUNE_DIR) and every file it may remove
 * lies there, never in the checkout's own storage-private.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ensureSchema, first, pool } from '../src/db.js';
import { PRIVATE_ROOT, removeStored, resolveStored, rootFor } from '../src/storage.js';
import { TOKENABLE_TYPE, createUser, deleteTestUsers } from './support/fixtures.js';

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The working directory of the command, and so the parent of its private root (see above). */
const PRUNE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'goenn-retention-'));

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
const cleanup = { tokens: [], challenges: [], resetEmails: [], cacheKeys: [], reports: [], callDaysAgo: [] };

const stamp = () => crypto.randomBytes(6).toString('hex');
// Evidence lives in the private root (src/storage.js); the prune runs with cwd PRUNE_DIR, so the
// files are written and checked under PRUNE_DIR/storage-private whatever this process's cwd is.
const storagePath = (relative) => path.join(PRUNE_DIR, 'storage-private', relative);

/** A small evidence file, where the moderation and the admin panel store them (private root). */
function evidenceFile() {
  assert.equal(rootFor('evidence'), PRIVATE_ROOT, 'evidence is stored in the private root');
  fs.mkdirSync(storagePath('evidence'), { recursive: true });
  const relative = `evidence/zret-test-${stamp()}.png`;
  fs.writeFileSync(storagePath(relative), Buffer.from('test-only image bytes'));
  return relative;
}

const fileExists = (relative) => fs.existsSync(storagePath(relative));

async function insert(sql, params) {
  const [result] = await pool.query(sql, params);
  return result.insertId;
}

/** `npm run prune` with `env` on top of the test process's environment (database settings). */
function runPrune(env) {
  return spawnSync(process.execPath, [path.join(SERVER_DIR, 'src', 'prune.js')], {
    cwd: PRUNE_DIR,
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
    for (const ago of cleanup.callDaysAgo) {
      await pool.query('DELETE FROM moderation_call_counts WHERE day = UTC_DATE() - INTERVAL ? DAY', [ago]);
    }
    await deleteTestUsers(pool, createdUserIds);
  } finally {
    // Every file and folder of this test, whatever the prune left of them.
    fs.rmSync(PRUNE_DIR, { recursive: true, force: true });
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

test('npm run prune removes the AI moderation call counts of days before yesterday and keeps the rest', async () => {
  // One row per UTC day, counts only (src/moderation.js, F-07). The rows of today and yesterday
  // are made without changing a count the budget may hold; the older rows are this test's own.
  const daysAgo = { today: 0, yesterday: 1, twoDays: 2, longAgo: 400 };
  for (const ago of Object.values(daysAgo)) {
    await pool.query('INSERT IGNORE INTO moderation_call_counts (day, calls) VALUES (UTC_DATE() - INTERVAL ? DAY, 0)', [ago]);
  }
  cleanup.callDaysAgo.push(daysAgo.twoDays, daysAgo.longAgo);

  const r = runPrune(SETTINGS);

  const present = (ago) => exists('SELECT day FROM moderation_call_counts WHERE day = UTC_DATE() - INTERVAL ? DAY', [ago]);
  assert.equal(await present(daysAgo.longAgo), false, 'the count of 400 days ago is still there');
  assert.equal(await present(daysAgo.twoDays), false, 'the count of two days ago is still there');
  assert.equal(await present(daysAgo.yesterday), true, "yesterday's count was deleted");
  assert.equal(await present(daysAgo.today), true, "today's count was deleted: the budget would start again");

  assert.equal(r.status, 0, `exit code ${r.status}\n${r.stderr}`);
  const counts = printedCounts(r.stdout);
  assert.ok(counts.moderationCallDays >= 2, `moderationCallDays: printed ${counts.moderationCallDays}, this test alone seeded 2`);
});

/** A name storeImage() gives (src/storage.js STORED_NAME): 40 hex characters and an extension. */
const storedName = () => `evidence/${crypto.randomBytes(20).toString('hex')}.png`;

/** An evidence file with a stored name whose modification time lies `daysAgo` days back. */
function agedEvidenceFile(daysAgo) {
  fs.mkdirSync(storagePath('evidence'), { recursive: true });
  const relative = storedName();
  fs.writeFileSync(storagePath(relative), Buffer.from('test-only image bytes'));
  const when = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  fs.utimesSync(storagePath(relative), when, when);
  return relative;
}

test('npm run prune removes aged evidence files that no row shows, and counts failed removals', async () => {
  const owner = (await createUser('zretorphan', { created: createdUserIds })).user;

  // EVIDENCE_RETENTION_DAYS = 30. An earlier run cleared the row of `orphan` and stopped before it
  // removed the file (or its removal failed): no row selects that path again.
  const files = {
    orphan: agedEvidenceFile(40),
    // Stored a moment ago, its row not written yet (the moderation stores the image first).
    young: agedEvidenceFile(0),
    // An old file that a young ban evidence row still shows.
    referenced: agedEvidenceFile(40),
  };
  await banEvidence(owner.id, files.referenced, 0);
  // A removal that fails: the image of an aged ban evidence row is a folder, which unlink refuses.
  const stuck = storedName();
  fs.mkdirSync(storagePath(stuck), { recursive: true });
  await banEvidence(owner.id, stuck, 40);

  const r = runPrune(SETTINGS);

  assert.equal(fileExists(files.orphan), false, 'an aged evidence file that no row shows is still there');
  assert.equal(fileExists(files.young), true, 'a young evidence file without a row was removed');
  assert.equal(fileExists(files.referenced), true, 'an aged evidence file that a row still shows was removed');
  assert.equal(fileExists(stuck), true, 'control: the folder cannot be removed');

  assert.equal(r.status, 0, `exit code ${r.status}\n${r.stderr}`);
  const counts = printedCounts(r.stdout);
  assert.ok(counts.filesRemoved >= 1, `filesRemoved: printed ${counts.filesRemoved}, the orphan alone is 1`);
  assert.ok(counts.filesFailed >= 1, `filesFailed: printed ${counts.filesFailed}, the folder alone is 1`);
  for (const name of [files.orphan, stuck]) {
    assert.ok(!r.stdout.includes(name) && !r.stderr.includes(name), 'the output must hold counts only');
  }
});

test('removing a stored file tells a file that is already gone apart from a removal that failed', async () => {
  // In this process, so in its own private root (src/storage.js); the file and folder are removed here.
  const relative = storedName();
  const target = resolveStored(relative);
  assert.ok(target, 'a stored evidence name resolves to a file');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, Buffer.from('test-only image bytes'));
  assert.equal(await removeStored(relative), 'removed');
  assert.equal(await removeStored(relative), 'gone', 'a file that is already gone is no failure');
  fs.mkdirSync(target);
  try {
    assert.equal(await removeStored(relative), 'failed', 'a removal the file system refuses must be told apart');
  } finally {
    fs.rmdirSync(target);
  }
  assert.equal(await removeStored('elsewhere/x.png'), 'invalid', 'a value outside the upload folders names no file');
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
