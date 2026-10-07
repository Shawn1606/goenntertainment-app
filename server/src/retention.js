/**
 * The retention prune (F-16): deletes data that is no longer needed once it is older than the
 * operator's retention settings (config.js RETENTION_SETTINGS; their values are an operator
 * decision, the code has no defaults).
 *
 * Who runs it:
 *   - the server, at start and then every hour, but only when the settings are there (index.js;
 *     production does not start without them, development without them prunes nothing);
 *   - `npm run prune` (src/prune.js), once, on demand.
 *
 * What goes (every row comparison uses the database's clock, the file sweep the file times; day
 * counts are bound parameters):
 *   tokens               sign-in tokens TOKEN_RETENTION_DAYS after they stopped being valid: after
 *                        expires_at, or after the token lifetime (SANCTUM_EXPIRATION, the rule of
 *                        auth.js) counted from created_at - whichever the row says first;
 *   twoFactorChallenges  two-factor, deletion-grant and reset challenges TOKEN_RETENTION_DAYS after
 *                        expires_at;
 *   resetLinks           rows of the former reset links (password_reset_tokens, valid for an hour
 *                        at most) TOKEN_RETENTION_DAYS after they were written;
 *   cacheRows, cacheLocks  rows of Laravel's database cache and its locks that expired more than
 *                        CACHE_EXPIRED_GRACE_SECONDS ago (Laravel never deletes them itself; an
 *                        expired row is unused, so this needs no retention decision);
 *   moderationCallDays   rows of the AI moderation call counter (moderation_call_counts,
 *                        moderation.js) for UTC days before yesterday: counts only, unused once
 *                        their day is over, so this needs no retention decision either;
 *   activityViews        event views older than USAGE_RETENTION_DAYS (this lowers the view count of
 *                        old events and the business insights for them);
 *   activeDays           active days older than USAGE_RETENTION_DAYS (at least the streak window);
 *   evidenceImages       the image of a ban evidence row or an AI moderation report older than
 *                        EVIDENCE_RETENTION_DAYS (the row stays, image_path becomes NULL);
 *   moderationReports    AI moderation reports older than MODERATION_REPORT_RETENTION_DAYS (the
 *                        report copies the checked text and image);
 *   filesRemoved         the image files of the two steps before that no other row still shows
 *                        (account-deletion.js removeUnreferencedFiles), removed after each batch;
 *                        then every evidence file older than EVIDENCE_RETENTION_DAYS that no row
 *                        shows (the sweep, sweepEvidenceFiles below);
 *   filesFailed          removals of those files that the file system refused (a file that is
 *                        already gone is no failure); the sweep tries them again on the next run.
 * Rows without the timestamp a step compares (NULL) are left alone: their age is unknown.
 *
 * The result holds counts only - never ids, names, paths or texts - and is what the log line shows.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

import { referencedAmong, removeUnreferencedFiles } from './account-deletion.js';
import { pool } from './db.js';
import { logError, logInfo } from './log.js';
import { PRIVATE_ROOT, removeStored, STORED_NAME } from './storage.js';

/** Rows per statement: a large backlog is deleted in steps, so no statement locks for long. */
const BATCH = 1000;

/**
 * Expired cache rows stay this long before the prune deletes them (one day). Laravel treats an
 * expired row as missing and overwrites it; the grace keeps the prune away from rows Laravel may be
 * reusing right now (a rate-limit window that starts again).
 */
export const CACHE_EXPIRED_GRACE_SECONDS = 24 * 60 * 60;

/**
 * The AI moderation call counter keeps today's and yesterday's rows (one day back). The budget
 * only ever reads today's row; the day of grace keeps it whatever the difference between the
 * clocks of this process (which picks the day, moderation.js) and the database (which prunes).
 */
export const MODERATION_CALL_DAYS_KEPT = 1;

/** The tables whose image_path holds evidence images (EVIDENCE_RETENTION_DAYS). */
const EVIDENCE_TABLES = ['ban_evidence', 'moderation_reports'];

/** The folder of the evidence images (src/storage.js: private root, 'evidence/<name>'). */
const EVIDENCE_FOLDER = 'evidence';

/** Evidence files the sweep checks against the database per query. */
const SWEEP_CHUNK = 500;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The keys of the result, in the order the log line shows them. */
export const PRUNE_COUNTS = Object.freeze([
  'tokens',
  'twoFactorChallenges',
  'resetLinks',
  'cacheRows',
  'cacheLocks',
  'moderationCallDays',
  'activityViews',
  'activeDays',
  'evidenceImages',
  'moderationReports',
  'filesRemoved',
  'filesFailed',
]);

/** Adds the outcome of one storage.js removeStored() call to `files` ({ removed, failed }). */
function countRemoval(files, outcome) {
  if (outcome === 'removed') files.removed += 1;
  else if (outcome === 'failed') files.failed += 1;
}

/** Runs `DELETE ... WHERE <condition> LIMIT BATCH` until fewer rows go; returns the total. */
async function deleteInBatches(statement, params) {
  let total = 0;
  for (;;) {
    const [result] = await pool.query(`${statement} LIMIT ?`, [...params, BATCH]);
    total += result.affectedRows;
    if (result.affectedRows < BATCH) return total;
  }
}

/**
 * Selects rows batch by batch (`SELECT id, image_path AS p ... LIMIT BATCH`), hands the ids to
 * `apply`, then removes the batch's image files that no row shows any more and adds the outcome
 * to `files`; returns the number of rows handled.
 *
 * The files go right after their batch, not once at the end of the run: a run that stops half
 * way (a restart, a database error) has left at most one batch's files behind, and the sweep of
 * the next run removes those. A file another row still shows stays (removeUnreferencedFiles
 * checks after the row change); the step that clears that row removes it later.
 */
async function eachBatch(select, params, apply, files) {
  let total = 0;
  for (;;) {
    const [rows] = await pool.query(`${select} ORDER BY id LIMIT ?`, [...params, BATCH]);
    if (rows.length === 0) return total;
    await apply(rows.map((row) => row.id));
    const removal = await removeUnreferencedFiles(rows.map((row) => row.p).filter(Boolean));
    files.removed += removal.removed;
    files.failed += removal.failed;
    total += rows.length;
    if (rows.length < BATCH) return total;
  }
}

/**
 * The sweep: removes the evidence files that are older than the evidence retention and that no
 * row shows. Rows alone cannot find them any more: once a step has cleared a row's image_path (or
 * deleted the row), no later run selects that path again. That leaves files behind when a run
 * stopped between the row change and the removal, when a removal failed, or when a row was never
 * written for a stored image.
 *
 * Only names storeImage() gives (STORED_NAME) and only plain files are considered. A file is
 * old when its modification time (the file system's clock, compared with this process's clock)
 * lies more than `evidenceDays` back: a younger one may belong to a row that is still being
 * written (the moderation stores the image before the report), and an evidence file is never
 * changed after it was stored.
 */
async function sweepEvidenceFiles(evidenceDays, files) {
  const dir = path.join(PRIVATE_ROOT, EVIDENCE_FOLDER);
  let names;
  try {
    names = await fs.readdir(dir);
  } catch (err) {
    if (err?.code === 'ENOENT') return; // nothing was ever stored
    throw err;
  }
  const cutoff = Date.now() - evidenceDays * DAY_MS;
  const aged = [];
  for (const name of names) {
    if (!STORED_NAME.test(name)) continue;
    try {
      const info = await fs.lstat(path.join(dir, name));
      if (info.isFile() && info.mtimeMs < cutoff) aged.push(`${EVIDENCE_FOLDER}/${name}`);
    } catch {
      // Removed in the meantime: nothing to do.
    }
  }
  for (let i = 0; i < aged.length; i += SWEEP_CHUNK) {
    const chunk = aged.slice(i, i + SWEEP_CHUNK);
    const referenced = await referencedAmong(chunk);
    for (const value of chunk) {
      if (!referenced.has(value)) countRemoval(files, await removeStored(value));
    }
  }
}

/**
 * Deletes what the retention settings say is no longer needed. `config` comes from
 * config.js retentionConfig(), plus `tokenLifetimeMinutes` (config.js tokenLifetimeMinutes).
 * Returns the counts (PRUNE_COUNTS).
 */
export async function pruneExpiredData({ evidenceDays, moderationReportDays, tokenDays, usageDays, tokenLifetimeMinutes }) {
  for (const [name, value] of Object.entries({ evidenceDays, moderationReportDays, tokenDays, usageDays, tokenLifetimeMinutes })) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`pruneExpiredData: ${name} must be a whole number of at least 1`);
  }
  const counts = Object.fromEntries(PRUNE_COUNTS.map((key) => [key, 0]));

  counts.tokens = await deleteInBatches(
    `DELETE FROM personal_access_tokens
      WHERE (expires_at IS NOT NULL AND expires_at < NOW() - INTERVAL ? DAY)
         OR (created_at IS NOT NULL AND created_at < NOW() - INTERVAL ? MINUTE - INTERVAL ? DAY)`,
    [tokenDays, tokenLifetimeMinutes, tokenDays],
  );
  counts.twoFactorChallenges = await deleteInBatches(
    'DELETE FROM two_factor_challenges WHERE expires_at < NOW() - INTERVAL ? DAY',
    [tokenDays],
  );
  counts.resetLinks = await deleteInBatches(
    'DELETE FROM password_reset_tokens WHERE created_at IS NOT NULL AND created_at < NOW() - INTERVAL ? DAY',
    [tokenDays],
  );
  counts.cacheRows = await deleteInBatches('DELETE FROM cache WHERE expiration < UNIX_TIMESTAMP() - ?', [
    CACHE_EXPIRED_GRACE_SECONDS,
  ]);
  counts.cacheLocks = await deleteInBatches('DELETE FROM cache_locks WHERE expiration < UNIX_TIMESTAMP() - ?', [
    CACHE_EXPIRED_GRACE_SECONDS,
  ]);
  counts.moderationCallDays = await deleteInBatches(
    'DELETE FROM moderation_call_counts WHERE day < UTC_DATE() - INTERVAL ? DAY',
    [MODERATION_CALL_DAYS_KEPT],
  );

  counts.activityViews = await deleteInBatches(
    'DELETE FROM activity_views WHERE created_at IS NOT NULL AND created_at < NOW() - INTERVAL ? DAY',
    [usageDays],
  );
  counts.activeDays = await deleteInBatches('DELETE FROM user_active_days WHERE day < CURDATE() - INTERVAL ? DAY', [
    usageDays,
  ]);

  // Images first, then whole reports; each batch's files go once no row shows them any more (a
  // younger ban evidence row may still show the same file). Then the sweep.
  const files = { removed: 0, failed: 0 };
  for (const table of EVIDENCE_TABLES) {
    counts.evidenceImages += await eachBatch(
      `SELECT id, image_path AS p FROM ${table}
        WHERE image_path IS NOT NULL AND created_at IS NOT NULL AND created_at < NOW() - INTERVAL ? DAY`,
      [evidenceDays],
      (ids) => pool.query(`UPDATE ${table} SET image_path = NULL WHERE id IN (?)`, [ids]),
      files,
    );
  }
  counts.moderationReports = await eachBatch(
    `SELECT id, image_path AS p FROM moderation_reports
      WHERE created_at IS NOT NULL AND created_at < NOW() - INTERVAL ? DAY`,
    [moderationReportDays],
    (ids) => pool.query('DELETE FROM moderation_reports WHERE id IN (?)', [ids]),
    files,
  );
  await sweepEvidenceFiles(evidenceDays, files);
  counts.filesRemoved = files.removed;
  counts.filesFailed = files.failed;

  return counts;
}

/** "tokens=0 twoFactorChallenges=2 ...": the counts for the log line, in PRUNE_COUNTS order. */
export function describeCounts(counts) {
  return PRUNE_COUNTS.map((key) => `${key}=${Number(counts[key] ?? 0)}`).join(' ');
}

/** True while a prune of this process runs: the hourly timer never starts a second one. */
let running = false;

/**
 * One prune run of the server (index.js): logs the counts, or the failure (log.js keeps SQL text
 * and driver messages out), and never throws. A run that is still busy is not started twice.
 */
export async function runRetentionPrune(config) {
  if (running) return;
  running = true;
  try {
    logInfo(`Retention prune: ${describeCounts(await pruneExpiredData(config))}`);
  } catch (err) {
    logError('Retention prune failed', err);
  } finally {
    running = false;
  }
}
