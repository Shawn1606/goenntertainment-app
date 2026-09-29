/**
 * Der Import-Lauf. Aufruf im Ordner server/:
 *
 *   npm run import              # Probelauf: zeigt nur, was passieren wuerde
 *   npm run import -- --live    # schreibt wirklich
 *   npm run import -- --live --source=noergelbuff
 *   npm run import -- --live --prune     # entfernt zusaetzlich Abgesagtes
 *   npm run import -- --verbose          # listet jedes Event mit Zeit und Interessen
 *
 * Der Probelauf ist die Voreinstellung und nicht der Live-Lauf: Ein Import
 * schreibt in dieselbe `activities`, in der die Nutzer:innen ihre eigenen Events
 * haben. Wer sich vertippt, soll das vorher sehen.
 */
import 'dotenv/config';
import { pool } from '../db.js';
import { SOURCES, UNAVAILABLE, sourceBySlug } from './sources.js';
import { normalizeEvent, isPast } from './normalize.js';
import { ensureImportSchema, ensureVenueHost, upsertEvent, removeVanished } from './store.js';
import { fetchTribeEvents } from './adapters/tribe.js';
import { fetchIcalEvents } from './adapters/ical.js';
import { fetchJsonLdEvents } from './adapters/jsonld.js';

const ADAPTERS = {
  tribe: fetchTribeEvents,
  ical: fetchIcalEvents,
  jsonld: fetchJsonLdEvents,
};

function parseArgs(argv) {
  const flags = new Set();
  let only = null;

  for (const arg of argv) {
    if (arg.startsWith('--source=')) only = arg.slice('--source='.length);
    else if (arg.startsWith('--')) flags.add(arg.slice(2));
  }

  return {
    live: flags.has('live'),
    prune: flags.has('prune'),
    verbose: flags.has('verbose'),
    only,
  };
}

/**
 * Holt und normalisiert eine Quelle, ohne zu schreiben.
 *
 * Getrennt vom Schreiben, damit ein Netz-Fehler bei Location 3 die Ergebnisse
 * von 1 und 2 nicht mitnimmt – jede Quelle steht fuer sich.
 */
async function collect(source) {
  const fetcher = ADAPTERS[source.adapter];
  if (!fetcher) throw new Error(`Unbekannter Adapter '${source.adapter}' bei ${source.slug}`);

  const raw = await fetcher(source);
  const events = [];
  let skippedPast = 0;
  let skippedIncomplete = 0;

  for (const item of raw) {
    const event = normalizeEvent(item, source);
    if (!event) {
      skippedIncomplete += 1;
      continue;
    }
    if (isPast(event.starts_at)) {
      skippedPast += 1;
      continue;
    }
    events.push(event);
  }

  return { events, skippedPast, skippedIncomplete };
}

/**
 * Zeigt, was aus einem Event geworden ist – die Zeile, an der man erkennt, ob
 * die Zeitzonen-Rechnung und die Interessen-Zuordnung stimmen.
 *
 * Die Startzeit steht in UTC in der DB; hier daneben in oertlicher Zeit, weil
 * "18:00 UTC" niemandem sagt, ob das Konzert um 20 Uhr beginnt.
 */
function describe(event) {
  const local = new Date(`${event.starts_at.replace(' ', 'T')}Z`).toLocaleString('de-DE', {
    timeZone: 'Europe/Berlin',
    dateStyle: 'short',
    timeStyle: 'short',
  });
  const interests = event.interestSlugs.length > 0 ? event.interestSlugs.join('/') : '—';
  return `    ${local} (${event.starts_at} UTC)  ${interests.padEnd(22)} ${event.title}`;
}

async function importSource(source, { live, prune, verbose }) {
  const label = `${source.name} (${source.slug})`;
  process.stdout.write(`\n▸ ${label}\n`);

  let collected;
  try {
    collected = await collect(source);
  } catch (error) {
    process.stdout.write(`  ✗ Quelle nicht erreichbar: ${error.message}\n`);
    return { failed: true };
  }

  const { events, skippedPast, skippedIncomplete } = collected;
  process.stdout.write(
    `  ${events.length} kommende Events gelesen` +
      `${skippedPast > 0 ? `, ${skippedPast} vergangene übersprungen` : ''}` +
      `${skippedIncomplete > 0 ? `, ${skippedIncomplete} ohne Titel/Datum verworfen` : ''}\n`,
  );

  if (events.length === 0) return { created: 0, updated: 0, unchanged: 0, removed: 0, vanished: 0 };

  const hostId = live ? await ensureVenueHost(source) : 0;
  const tally = { created: 0, updated: 0, unchanged: 0, removed: 0, vanished: 0 };
  const seen = new Set();

  for (const event of events) {
    seen.add(event.externalId);
    const outcome = await upsertEvent(event, hostId, { dryRun: !live });
    tally[outcome] += 1;
    if (verbose) process.stdout.write(`${describe(event)}\n`);
  }

  if (prune) {
    tally.vanished = await removeVanished(source.slug, seen, { dryRun: !live });
  }

  process.stdout.write(
    `  ${tally.created} neu, ${tally.updated} geändert, ${tally.unchanged} unverändert` +
      `${tally.removed > 0 ? `, ${tally.removed} vom Admin entfernt (bleibt entfernt)` : ''}` +
      `${tally.vanished > 0 ? `, ${tally.vanished} aus der Quelle verschwunden` : ''}\n`,
  );

  return tally;
}

async function main() {
  const { live, prune, verbose, only } = parseArgs(process.argv.slice(2));

  const sources = only ? [sourceBySlug(only)].filter(Boolean) : SOURCES;
  if (only && sources.length === 0) {
    process.stdout.write(`Keine Quelle mit dem Slug '${only}'. Bekannt: ${SOURCES.map((s) => s.slug).join(', ')}\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    live
      ? '=== Event-Import: LIVE (schreibt in die Datenbank) ===\n'
      : '=== Event-Import: Probelauf (schreibt nichts, --live zum Ausführen) ===\n',
  );

  // Auch im Probelauf: Der Merkzettel ist es, der "neu" von "geaendert"
  // unterscheidet – ohne ihn koennte der Probelauf nichts vorhersagen. Eine
  // leere Zusatz-Tabelle anzulegen aendert nichts an den Daten der App.
  await ensureImportSchema();

  const total = { created: 0, updated: 0, unchanged: 0, removed: 0, vanished: 0 };
  const failed = [];

  for (const source of sources) {
    const result = await importSource(source, { live, prune, verbose });
    if (result.failed) {
      failed.push(source.name);
      continue;
    }
    for (const key of Object.keys(total)) total[key] += result[key] ?? 0;
  }

  process.stdout.write(
    `\n=== Summe: ${total.created} neu, ${total.updated} geändert, ${total.unchanged} unverändert` +
      `${total.vanished > 0 ? `, ${total.vanished} entfernt` : ''} ===\n`,
  );
  if (failed.length > 0) {
    process.stdout.write(`Nicht erreichbar: ${failed.join(', ')}\n`);
  }

  // Die Locations ohne Quelle mitschreiben – das ist die Liste, die den naechsten
  // Ausbau steuert, und sie gehoert vor die Augen und nicht in eine Datei.
  if (UNAVAILABLE.length > 0) {
    // Die mit einer konkreten Anfrage zuerst: Das ist die Liste, an der sich
    // Arbeit lohnt. Der Rest ist Dokumentation, damit niemand dasselbe nochmal
    // nachprueft.
    const actionable = UNAVAILABLE.filter((entry) => entry.ask);
    const rest = UNAVAILABLE.filter((entry) => !entry.ask);

    if (actionable.length > 0) {
      process.stdout.write('\nEine Anfrage weit entfernt:\n');
      for (const entry of actionable) {
        process.stdout.write(`  • ${entry.name}\n      ${entry.reason}\n      → ${entry.ask}\n`);
      }
    }

    if (rest.length > 0) {
      process.stdout.write('\nOhne maschinenlesbare Quelle:\n');
      for (const entry of rest) {
        process.stdout.write(`  • ${entry.name}: ${entry.reason}\n`);
      }
      process.stdout.write(
        '  → Diese Häuser um einen iCal-Link bitten (Adapter "ical" liest ihn ohne weiteren Code).\n',
      );
    }
  }
}

main()
  .catch((error) => {
    process.stderr.write(`\nImport abgebrochen: ${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
