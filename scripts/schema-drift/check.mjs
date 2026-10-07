#!/usr/bin/env node
// Schema drift check (F-33): server/schema.sql is the source of truth; every other
// place that defines the schema is executed for real against a throwaway MySQL
// database and read back from information_schema, then compared with the reference.
//
//   node scripts/schema-drift/check.mjs [--allowlist <path>] [--ratchet <git-ref>]
//                                       [--print-candidates] [--keep]
//
// Exit codes: 0 = no difference outside the allow-list and nothing refused;
// 1 = the repository fails the check; 2 = the check could not run.
// README.md explains the environment, the rules and how to react to a failure.
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import {
  addColumnOrderProblems,
  candidateSkeleton,
  diffSnapshots,
  evaluateAllowlist,
  keyKind,
  parseAllowlist,
  ratchetVerdict,
  scanForSchemaCopies,
  scopeDifferences,
  statementHead,
  summarizeDiscovery,
  zeroDenominatorRefusals,
} from './compare.mjs';
import { DATABASES, DDL_SCAN, LARAVEL, NODE_PASSES, REFERENCE, allDatabaseNames } from './copies.mjs';
import {
  CannotRun,
  connect,
  connectionConfig,
  dropDatabase,
  loadSchemaFile,
  prepareAlterPass,
  prepareCreatePass,
  recreateDatabase,
  runLaravelMigrations,
  serverInfo,
  snapshot,
  snapshotCounts,
  unmodelledObjects,
} from './mysql.mjs';
import { REPO, discover, loadNodeCopies, runOnConnection } from './node-copies.mjs';

const ALLOWLIST_PATH = 'scripts/schema-drift/allowlist.json';
const CHECK_PATH = 'scripts/schema-drift/check.mjs';

const USAGE = `usage: node scripts/schema-drift/check.mjs [--allowlist <path>] [--ratchet <git-ref>] [--print-candidates] [--keep]
  --allowlist <path>    allow-list to evaluate (default ${ALLOWLIST_PATH})
  --ratchet <git-ref>   fail on any allow-list entry the commit <git-ref> does not have (CI: the base branch)
  --print-candidates    print today's differences as an allow-list skeleton (JSON on stdout, report on stderr)
  --keep                keep the throwaway databases for inspection
environment: SCHEMA_DRIFT_DB_USER and SCHEMA_DRIFT_DB_PASSWORD (required), SCHEMA_DRIFT_DB_HOST
  (default 127.0.0.1), SCHEMA_DRIFT_DB_PORT (default 3306), SCHEMA_DRIFT_PHP (default php)`;

function parseOptions(argv) {
  try {
    const { values } = parseArgs({
      args: argv,
      options: {
        allowlist: { type: 'string' },
        ratchet: { type: 'string' },
        'print-candidates': { type: 'boolean', default: false },
        keep: { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
      },
      strict: true,
      allowPositionals: false,
    });
    if (values.ratchet !== undefined && values.ratchet.trim() === '') {
      throw new Error('--ratchet needs a git ref');
    }
    if (values['print-candidates'] && values.ratchet !== undefined) {
      throw new Error('--print-candidates does not evaluate an allow-list; drop --ratchet');
    }
    return values;
  } catch (err) {
    throw new CannotRun(`${err.message}\n${USAGE}`);
  }
}

function git(args, { allowFailure = false } = {}) {
  try {
    return execFileSync('git', args, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    if (err.code === 'ENOENT') throw new CannotRun('git is not installed');
    if (allowFailure) return null;
    throw new CannotRun(`git ${args[0]} failed: ${(err.stderr || err.message).toString().trim()}`);
  }
}

/** Every tracked file plus untracked, non-ignored files: a local experiment counts too. */
function repositoryFiles() {
  const listed = git(['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
  const paths = [...new Set(listed.split('\0').filter(Boolean))];
  const files = [];
  for (const path of paths) {
    if (!DDL_SCAN.extensions.some((ext) => path.endsWith(ext))) continue;
    const abs = join(REPO, path);
    if (!existsSync(abs)) continue; // deleted in the working tree, not committed yet
    files.push({ path, text: readFileSync(abs, 'utf8') });
  }
  return files;
}

/** Keys (never values) of a dotenv file, so the Laravel step can say what a local .env changes. */
function readEnvFileKeys(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map((line) => /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line))
    .filter(Boolean)
    .map((m) => m[1]);
}

function readAllowlist(path, explicit) {
  if (!existsSync(path)) {
    if (explicit) throw new CannotRun(`--allowlist: ${path} does not exist`);
    return { entries: [], groups: 0, errors: [`the allow-list ${ALLOWLIST_PATH} is missing`] };
  }
  let doc;
  try {
    doc = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    return { entries: [], groups: 0, errors: [`the allow-list is not valid JSON: ${err.message}`] };
  }
  const { entries, errors } = parseAllowlist(doc);
  return { entries, groups: Array.isArray(doc?.groups) ? doc.groups.length : 0, errors };
}

function ratchetAgainst(ref, entries) {
  const sha = git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { allowFailure: true });
  if (!sha) throw new CannotRun(`--ratchet: ${ref} is not a commit in this repository (fetch-depth 0 in CI?)`);
  const commit = sha.trim();
  const has = (path) => git(['cat-file', '-e', `${commit}:${path}`], { allowFailure: true }) !== null;
  const base = { hasAllowlist: has(ALLOWLIST_PATH), hasCheck: has(CHECK_PATH), doc: null };
  if (base.hasAllowlist) {
    try {
      base.doc = JSON.parse(git(['show', `${commit}:${ALLOWLIST_PATH}`]));
    } catch (err) {
      if (err instanceof CannotRun) throw err;
      base.doc = undefined; // unreadable at base: ratchetVerdict refuses
    }
  }
  return { commit, ...ratchetVerdict(entries, base) };
}

function pad(text, width) {
  return text.length >= width ? `${text} ` : text + ' '.repeat(width - text.length);
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function describeCounts(c) {
  return [plural(c.tables, 'table'), plural(c.columns, 'column'), `${c.indexes} ${c.indexes === 1 ? 'index' : 'indexes'}`, plural(c.fks, 'foreign key')].join(', ');
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  const candidatesMode = options['print-candidates'];
  // In candidates mode stdout carries only the JSON skeleton.
  const write = candidatesMode ? (s) => process.stderr.write(s) : (s) => process.stdout.write(s);
  const log = (line = '') => write(`${line}\n`);

  // seed.js only skips its main() on import where import.meta.main exists (Node >= 22.18).
  if (typeof import.meta.main !== 'boolean') {
    throw new CannotRun(`Node ${process.version} has no import.meta.main; use Node 22.18 or newer`);
  }
  const config = connectionConfig(process.env);
  const php = process.env.SCHEMA_DRIFT_PHP || 'php';

  const failures = [];
  const differences = [];
  let comparedObjects = 0;

  // Allow-list first: a broken file fails fast and is reported even if MySQL is down.
  let allowlist = null;
  if (!candidatesMode) {
    const path = options.allowlist !== undefined ? resolve(options.allowlist) : join(REPO, ALLOWLIST_PATH);
    allowlist = readAllowlist(path, options.allowlist !== undefined);
    for (const error of allowlist.errors) failures.push(`allow-list: ${error}`);
  }
  // Resolve the ratchet before the long part, so a bad ref fails fast.
  const ratchet = options.ratchet === undefined ? null : ratchetAgainst(options.ratchet, allowlist.entries);

  let admin;
  try {
    admin = await connect(config, undefined);
  } catch (err) {
    throw new CannotRun(`cannot connect to MySQL at ${config.host}:${config.port}: ${err.code ?? err.message}`);
  }

  let scan = null;
  const discovered = [];
  let reference = null;
  let referenceUsable = false;
  let laravelTables = null;
  try {
    const info = await serverInfo(admin);
    log(`schema-drift: MySQL ${info.version}, server default collation ${info.collation}, Node ${process.version}`);

    // Unregistered schema copies (method: name every second copy).
    scan = scanForSchemaCopies(repositoryFiles(), DDL_SCAN);
    log(
      `copy registry: ${scan.filesScanned} code files scanned, ${scan.withDdl.length} contain DDL, ` +
        `${scan.registeredWithDdl} registered, ${scan.unregisteredFiles.length} unregistered`,
    );
    for (const where of scan.unregistered) {
      failures.push(`unregistered DDL in ${where} (register the copy in scripts/schema-drift/copies.mjs, or move the DDL)`);
    }
    for (const stale of scan.staleRegistrations) {
      failures.push(`registered copy ${stale} contains no DDL any more (update scripts/schema-drift/copies.mjs)`);
    }

    // Node copies: import with the pool guarded, then discovery (executes nothing,
    // so the copies' own console output is not shown here).
    const nodeEnv = await loadNodeCopies();
    for (const problem of nodeEnv.problems) failures.push(problem);
    for (const copy of nodeEnv.loaded) {
      const { statements, error } = await discover(nodeEnv, copy);
      const summary = summarizeDiscovery(statements);
      if (error) failures.push(`${copy.id}: discovery failed: ${error.message}`);
      for (const st of statements.filter((s) => s.type === 'unsupported')) {
        failures.push(`${copy.id}: unsupported statement (${st.reason}): ${st.head} (extend scripts/schema-drift)`);
      }
      for (const problem of addColumnOrderProblems(statements)) failures.push(`${copy.id}: ADD COLUMN order: ${problem}`);
      const c = summary.counts;
      log(
        `${pad(copy.id, 16)}discovery: ${summary.total} statements (${c['create-table']} create-table, ${c['add-column']} add-column, ` +
          `${c['other-ddl']} other-ddl, ${c.data} data, ${c.probe} probe, ${c.session} session, ${c.unsupported} unsupported)`,
      );
      discovered.push({ copy, summary, defines: summary.createSet.length + summary.addColumns.length });
    }

    for (const name of allDatabaseNames()) await dropDatabase(admin, name);

    // Reference.
    const schemaSql = readFileSync(join(REPO, REFERENCE.path), 'utf8');
    const createStatements = (schemaSql.match(/^CREATE TABLE/gm) ?? []).length;
    await recreateDatabase(admin, DATABASES.reference);
    let refSnap = null;
    try {
      await loadSchemaFile(config, DATABASES.reference, schemaSql);
      refSnap = await snapshot(admin, DATABASES.reference);
    } catch (err) {
      failures.push(`the reference ${REFERENCE.path} did not load: ${err.code ?? ''} ${err.message}`.replace(/\s+/g, ' '));
    }
    if (refSnap) {
      const counts = snapshotCounts(refSnap);
      reference = { tables: counts.tables, createStatements };
      log(`reference ${REFERENCE.path}: ${describeCounts(counts)}, ${counts.checks} checks (${createStatements} CREATE TABLE in the file)`);
      for (const object of unmodelledObjects(refSnap)) failures.push(`reference: ${object} is not modelled by the check`);
    }
    // Comparing against an empty or partly loaded reference would only produce noise.
    referenceUsable = reference !== null && reference.tables > 0 && reference.tables === reference.createStatements;
    if (!referenceUsable) {
      log('reference unusable: no copy is compared against it (see the refusals below)');
    } else {
      const referenceTables = Object.keys(refSnap.tables).sort();

      // Node copies: noop, create, alter.
      for (const { copy, summary } of discovered) {
        const scope = scopeDifferences({
          prefix: `${copy.id}/create`,
          complete: copy.complete,
          referenceTables,
          createSet: summary.createSet,
        });
        differences.push(...scope);
        const outside = referenceTables.filter((t) => !summary.createSet.includes(t));
        for (const pass of NODE_PASSES) {
          const prefix = `${copy.id}/${pass}`;
          if (pass === 'create' && summary.createSet.length === 0) {
            log(`${pad(copy.id, 16)}create: not applicable (0 CREATE TABLE statements)`);
            continue;
          }
          if (pass === 'alter' && summary.addColumns.length === 0) {
            log(`${pad(copy.id, 16)}alter:  not applicable (0 ADD COLUMN statements)`);
            continue;
          }
          const database = DATABASES.pass(copy, pass);
          await recreateDatabase(admin, database);
          await loadSchemaFile(config, database, schemaSql);
          if (pass === 'create') await prepareCreatePass(config, database, summary.createSet);
          if (pass === 'alter') await prepareAlterPass(config, database, summary.addColumns);
          const conn = await connect(config, database);
          let run;
          try {
            run = await runOnConnection(nodeEnv, copy, conn, log, `${copy.id} ${pass}`);
          } finally {
            await conn.end();
          }
          if (run.error) {
            const code = run.error.errno ?? run.error.code ?? run.error.name ?? 'error';
            differences.push(`${prefix} apply-error ${code} ${statementHead(run.lastStatement ?? '(no statement)')}`);
            log(`${pad(copy.id, 16)}${pass}: the copy failed after ${run.sent} statements: ${run.error.code ?? ''} ${run.error.message}`);
          }
          const snap = await snapshot(admin, database);
          for (const object of unmodelledObjects(snap)) failures.push(`${prefix}: ${object} is not modelled by the check`);
          const diff = diffSnapshots(refSnap, snap, { prefix, referenceOnly: 'missing' });
          differences.push(...diff.differences);
          comparedObjects += diff.counts.objects;
          let what = `${plural(run.sent, 'statement')} applied`;
          if (pass === 'create') what = `${plural(summary.createSet.length, 'table')} dropped and re-created by the copy`;
          if (pass === 'alter') what = `${plural(summary.addColumns.length, 'column')} dropped and re-added by the copy`;
          log(
            `${pad(copy.id, 16)}${pad(`${pass}:`, 8)}${what}; ${describeCounts(diff.counts)} compared; ` +
              `${plural(diff.differences.length, 'difference')}`,
          );
        }
        if (copy.complete) {
          log(`${pad(copy.id, 16)}scope:  complete; ${outside.length} reference tables it never creates${outside.length ? `: ${outside.join(', ')}` : ''}`);
        } else {
          log(`${pad(copy.id, 16)}scope:  partial; ${outside.length} reference tables outside its scope are not differences`);
        }
      }

      // Laravel migrations.
      await recreateDatabase(admin, DATABASES.laravel);
      const migrate = runLaravelMigrations({
        repo: REPO,
        appDir: LARAVEL.appDir,
        config,
        database: DATABASES.laravel,
        php,
        log,
        readEnvFileKeys,
      });
      const prefix = `${LARAVEL.id}/${LARAVEL.pass}`;
      if (migrate.status !== 0) differences.push(`${prefix} apply-error exit-${migrate.status} php artisan migrate`);
      const snap = await snapshot(admin, DATABASES.laravel);
      for (const object of unmodelledObjects(snap)) failures.push(`${prefix}: ${object} is not modelled by the check`);
      const diff = diffSnapshots(refSnap, snap, { prefix, referenceOnly: 'ignore' });
      differences.push(...diff.differences);
      comparedObjects += diff.counts.objects;
      const created = Object.keys(snap.tables).sort();
      laravelTables = created.filter((t) => t !== 'migrations').length;
      log(
        `${pad(LARAVEL.id, 16)}migrate: ${created.length} tables created (${laravelTables} besides the migrations ledger); ` +
          `shared with the reference: ${describeCounts(diff.counts)} compared; ${diff.copyOnlyTables.length} not in the reference` +
          `${diff.copyOnlyTables.length ? ` (${diff.copyOnlyTables.join(', ')})` : ''}; ${diff.differences.length} differences`,
      );
    }
  } finally {
    if (options.keep) {
      log(`kept databases: ${allDatabaseNames().join(', ')}`);
    } else {
      for (const name of allDatabaseNames()) await dropDatabase(admin, name).catch(() => {});
    }
    await admin.end().catch(() => {});
  }

  const allDifferences = [...new Set(differences)].sort();
  const applyErrors = allDifferences.filter((d) => keyKind(d) === 'apply-error');
  for (const d of applyErrors) failures.push(`apply error (never allow-listable): ${d}`);

  const refusals = zeroDenominatorRefusals({
    reference,
    copies: discovered.map(({ copy, defines }) => ({ id: copy.id, defines })),
    laravel: laravelTables === null ? null : { tables: laravelTables },
    comparedObjects,
    scan,
  });
  for (const refusal of refusals) failures.push(`refusing a clean verdict: ${refusal}`);

  if (candidatesMode) {
    process.stdout.write(`${JSON.stringify(candidateSkeleton(allDifferences), null, 2)}\n`);
    log(`differences: ${allDifferences.length} (${applyErrors.length} apply errors, not in the skeleton)`);
    return finish(log, failures);
  }

  // Without a usable reference nothing was compared, so unexpected and stale would be noise.
  const evaluation = referenceUsable
    ? evaluateAllowlist(allDifferences, allowlist.entries)
    : { unexpected: [], stale: [], allowed: 0 };
  const unexpected = evaluation.unexpected.filter((d) => keyKind(d) !== 'apply-error');
  for (const d of unexpected) failures.push(`unexpected difference: ${d}`);
  for (const e of evaluation.stale) failures.push(`stale allow-list entry (no such difference any more; delete it): ${e}`);
  let ratchetLine = 'ratchet: not requested';
  if (options.ratchet !== undefined) {
    const r = ratchet;
    const at = `${options.ratchet} (${r.commit.slice(0, 12)})`;
    if (r.status === 'first-introduction') {
      ratchetLine = `ratchet vs ${at}: no allow-list and no check there (first introduction); 0 entries at base, ${allowlist.entries.length} now`;
    } else if (r.status === 'refused') {
      ratchetLine = `ratchet vs ${at}: refused`;
      failures.push(`ratchet: ${r.reason}`);
    } else {
      ratchetLine = `ratchet vs ${at}: ${r.baseCount} entries at base, ${allowlist.entries.length} now, ${r.added.length} added`;
      for (const e of r.added) failures.push(`allow-list entry added since ${options.ratchet} (the list may only shrink): ${e}`);
    }
  }
  log(
    `differences: ${allDifferences.length} (allow-listed ${evaluation.allowed}, unexpected ${unexpected.length}, apply errors ${applyErrors.length}) | ` +
      `allow-list: ${allowlist.entries.length} entries in ${allowlist.groups} groups ` +
      `(${referenceUsable ? `stale ${evaluation.stale.length}` : 'not evaluated: no usable reference'}) | ${ratchetLine}`,
  );
  return finish(log, failures);
}

function finish(log, failures) {
  for (const failure of failures) log(`FAIL ${failure}`);
  log(failures.length === 0 ? 'schema-drift: OK' : `schema-drift: FAILED (${failures.length} problems)`);
  return failures.length === 0 ? 0 : 1;
}

let code;
try {
  code = await main();
} catch (err) {
  if (err instanceof CannotRun) {
    process.stderr.write(`schema-drift: cannot run: ${err.message}\n`);
  } else {
    process.stderr.write(`schema-drift: cannot run: unexpected error: ${err?.stack ?? err}\n`);
  }
  code = 2;
}
// Exit explicitly: an imported copy may have set process.exitCode or left handles open.
process.exit(code);
