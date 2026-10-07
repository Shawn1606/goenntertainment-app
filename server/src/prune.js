/**
 * `npm run prune`: runs the retention prune once (retention.js) and prints what it deleted, as
 * counts only. An operator command; the server itself runs the same prune every hour when the
 * retention settings are set (index.js).
 *
 * All four retention settings are required here, in every environment (an explicit request to
 * delete must not run on half a configuration), and so is a valid SANCTUM_EXPIRATION if set.
 * Exit code 1 with the NAMES of the missing or invalid settings, or when the prune fails.
 *
 * Never imported by the server: importing this file would run a prune and close the pool
 * (test/logging.test.js checks that no server module imports it).
 */
import { retentionConfig, retentionSettingProblems, tokenLifetimeMinutes } from './config.js';
import { pool } from './db.js';
import { logError, logInfo } from './log.js';
import { describeCounts, pruneExpiredData } from './retention.js';

async function main() {
  const problems = retentionSettingProblems(process.env, { required: true });
  const lifetime = tokenLifetimeMinutes(process.env);
  if (lifetime === null) problems.push('SANCTUM_EXPIRATION (optional; when set, a positive whole number of minutes)');
  if (problems.length > 0) {
    logError('Retention settings missing or invalid, nothing pruned', problems.join('; '));
    return 1;
  }
  try {
    const counts = await pruneExpiredData({ ...retentionConfig(process.env), tokenLifetimeMinutes: lifetime });
    logInfo(`Retention prune: ${describeCounts(counts)}`);
    return 0;
  } catch (err) {
    logError('Retention prune failed', err);
    return 1;
  }
}

try {
  process.exitCode = await main();
} finally {
  await pool.end();
}
