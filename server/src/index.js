import 'dotenv/config';
import { ensureSchema } from './db.js';
import { createApp } from './app.js';
import { startupProblems } from './config.js';
import { moderationStatus } from './moderation.js';
import { backfillActiveDays } from './streak.js';
import { pruneHistory } from './routes/activities.js';
import { logError, logInfo } from './log.js';

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

function start() {
  const app = createApp();

  const port = Number(process.env.PORT ?? 8000);
  // Auf '::' lauschen (Dual-Stack: IPv6 + IPv4). Wichtig unter Windows: `localhost`
  // loest zuerst auf ::1 (IPv6) auf – bei reinem 0.0.0.0-Binding laeuft jede Anfrage
  // erst in einen IPv6-Fehlversuch (~200 ms Strafe) und faellt dann auf 127.0.0.1
  // zurueck. Mit '::' antwortet ::1 sofort; LAN-IPv4 (Handy) funktioniert weiterhin.
  app.listen(port, '::', async () => {
    logInfo(`Goenntertainment-Backend laeuft auf http://localhost:${port} (IPv4+IPv6)`);
    logInfo(moderationStatus());
    // Fehlende Tabellen nachziehen (z. B. activity_history) und den Verlauf einmal
    // aufraeumen. Danach stuendlich alte (>7 Tage) Verlaufs-Eintraege loeschen.
    try {
      await ensureSchema();
      await pruneHistory();
      // Konten, die es vor der Serie schon gab, bekommen ihre aktiven Tage
      // einmalig aus den vorhandenen Spuren nachgetragen – sonst startet jede:r
      // bei 0, obwohl die App seit Wochen benutzt wird.
      const filled = await backfillActiveDays();
      if (filled > 0) logInfo(`Aktive Tage nachgetragen: ${filled}`);
    } catch (err) {
      logError('Schema/Verlauf-Setup fehlgeschlagen', err);
    }
    setInterval(() => {
      pruneHistory().catch((err) => logError('Verlauf-Aufraeumen fehlgeschlagen', err));
    }, 60 * 60 * 1000).unref();
  });
}
