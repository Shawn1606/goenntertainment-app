import 'dotenv/config';
import { ensureSchema, pool } from './db.js';
import { createApp } from './app.js';
import { retentionConfig, startupProblems, tokenLifetimeMinutes } from './config.js';
import { moderationStatus } from './moderation.js';
import { runRetentionPrune } from './retention.js';
import { backfillActiveDays } from './streak.js';
import { pruneHistory } from './routes/activities.js';
import { migrateLegacyPrivateFiles } from './storage.js';
import { sweepExpiredStories } from './stories.js';
import { logError, logInfo } from './log.js';

/**
 * How long a process whose database step failed may take to end on its own (milliseconds). It
 * normally ends at once, after its pool is closed; should anything still hold it open, it is
 * ended hard after this time, so the container restarts instead of hanging without a server.
 */
const FAILED_SETUP_EXIT_MS = 10_000;

// The one startup gate (config.js): names of missing or invalid settings, never their values.
// Nothing is started then, and the process ends on its own with exit code 1 (no hard exit, so
// the message is written out in full).
const problems = startupProblems(process.env);
if (problems.length > 0) {
  logError('Required settings missing or invalid', problems.join('; '));
  process.exitCode = 1;
} else {
  start();
}

/**
 * The database step, before the server listens (F-33). A server that listens on a half-built
 * database answers with errors that look like application bugs, and a setup error that is only
 * logged hides the cause. Returns false when a step failed (the error is logged).
 */
async function prepareDatabase() {
  try {
    // Fehlende Tabellen nachziehen (z. B. activity_history) und den Verlauf einmal
    // aufraeumen. Danach stuendlich alte (>7 Tage) Verlaufs-Eintraege loeschen.
    await ensureSchema();
    await pruneHistory();
    await sweepExpiredStories();
    // Konten, die es vor der Serie schon gab, bekommen ihre aktiven Tage
    // einmalig aus den vorhandenen Spuren nachgetragen – sonst startet jede:r
    // bei 0, obwohl die App seit Wochen benutzt wird.
    const filled = await backfillActiveDays();
    if (filled > 0) logInfo(`Aktive Tage nachgetragen: ${filled}`);
    return true;
  } catch (err) {
    logError('Database setup failed; the server does not start (exit code 1)', err);
    return false;
  }
}

async function start() {
  // Order: settings (above) -> database step -> private files -> listen -> hourly jobs. The port
  // opens only after the database step succeeded; a failed step ends the process with exit code
  // 1, so the container restarts and its health check never passes on a broken database.
  if (!(await prepareDatabase())) {
    process.exitCode = 1;
    setTimeout(() => process.exit(1), FAILED_SETUP_EXIT_MS).unref();
    await pool.end().catch((err) => logError('Closing the database pool failed', err));
    return;
  }

  // Evidence and story images an older version wrote into the public tree move to private
  // storage before anything is served (F-11, storage.js). A failure is logged, not fatal: the
  // public /storage route refuses those folders by path in any case.
  try {
    const moved = await migrateLegacyPrivateFiles();
    if (moved > 0) logInfo(`Moved ${moved} private file(s) out of public storage`);
  } catch (err) {
    logError('Moving private files out of public storage failed', err);
  }

  const app = createApp();
  // Retention (F-16): the gate above checked the settings. Null = none set (only allowed outside
  // production): then nothing is pruned.
  const retention = retentionConfig(process.env);
  const prune = retention ? { ...retention, tokenLifetimeMinutes: tokenLifetimeMinutes(process.env) } : null;

  const port = Number(process.env.PORT ?? 8000);
  // Auf '::' lauschen (Dual-Stack: IPv6 + IPv4). Wichtig unter Windows: `localhost`
  // loest zuerst auf ::1 (IPv6) auf – bei reinem 0.0.0.0-Binding laeuft jede Anfrage
  // erst in einen IPv6-Fehlversuch (~200 ms Strafe) und faellt dann auf 127.0.0.1
  // zurueck. Mit '::' antwortet ::1 sofort; LAN-IPv4 (Handy) funktioniert weiterhin.
  app.listen(port, '::', async () => {
    logInfo(`Goenntertainment-Backend laeuft auf http://localhost:${port} (IPv4+IPv6)`);
    logInfo(moderationStatus());
    // The retention prune is a clean-up job, not part of the database step: its first run starts
    // once the server listens, then it runs hourly with the other jobs (it logs its own errors).
    if (prune) await runRetentionPrune(prune);
    else logInfo('Retention prune off: no retention settings (outside production only)');
    setInterval(() => {
      pruneHistory().catch((err) => logError('Verlauf-Aufraeumen fehlgeschlagen', err));
      // Expired stories and their files (stories.js; never throws).
      sweepExpiredStories();
      if (prune) runRetentionPrune(prune);
    }, 60 * 60 * 1000).unref();
  });
}
