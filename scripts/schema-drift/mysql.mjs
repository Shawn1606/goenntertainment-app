// MySQL side of the schema drift check: connections, throwaway databases, loading the
// reference, preparing the overlay passes, running the Laravel migrations and reading
// a database back from information_schema. Every information_schema read binds the
// schema name; identifiers (which cannot be bound) come only from the check's own
// constants, information_schema or the registered copies, and are validated first.
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

/** Thrown when the check cannot run (exit code 2), as opposed to a failing repository. */
export class CannotRun extends Error {}

let driver = null;

/** mysql2 is not a root dependency; use the server's copy (npm ci --prefix server). */
export function loadDriver() {
  if (driver) return driver;
  try {
    const require = createRequire(new URL('../../server/package.json', import.meta.url));
    driver = require('mysql2/promise');
  } catch {
    throw new CannotRun('mysql2 is not installed: run `npm ci --prefix server` first');
  }
  return driver;
}

export function ident(name) {
  if (typeof name !== 'string' || !/^[A-Za-z0-9_]+$/.test(name)) {
    throw new Error(`schema-drift: refusing identifier ${JSON.stringify(name)}`);
  }
  return `\`${name}\``;
}

/** Connection settings from the environment (README "Environment"). */
export function connectionConfig(env) {
  const missing = ['SCHEMA_DRIFT_DB_USER', 'SCHEMA_DRIFT_DB_PASSWORD'].filter((name) => env[name] === undefined);
  if (missing.length > 0) {
    throw new CannotRun(`missing environment: ${missing.join(', ')} (see scripts/schema-drift/README.md)`);
  }
  const port = Number(env.SCHEMA_DRIFT_DB_PORT || 3306);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new CannotRun('SCHEMA_DRIFT_DB_PORT is not a port number');
  }
  return {
    host: env.SCHEMA_DRIFT_DB_HOST || '127.0.0.1',
    port,
    user: env.SCHEMA_DRIFT_DB_USER,
    password: env.SCHEMA_DRIFT_DB_PASSWORD,
  };
}

export async function connect(config, database, { multipleStatements = false } = {}) {
  const mysql = loadDriver();
  return mysql.createConnection({ ...config, database, multipleStatements });
}

export async function serverInfo(conn) {
  const [[row]] = await conn.query('SELECT VERSION() AS version, @@collation_server AS collation');
  return row;
}

export async function dropDatabase(conn, name) {
  await conn.query(`DROP DATABASE IF EXISTS ${ident(name)}`);
}

/** A fresh, empty database with the server's default character set and collation. */
export async function recreateDatabase(conn, name) {
  await dropDatabase(conn, name);
  await conn.query(`CREATE DATABASE ${ident(name)}`);
}

/** Loads server/schema.sql exactly as it is (one multi-statement batch). */
export async function loadSchemaFile(config, database, sql) {
  const conn = await connect(config, database, { multipleStatements: true });
  try {
    await conn.query(sql);
  } finally {
    await conn.end();
  }
}

/** create pass: drop every table the copy creates, so its CREATE TABLE statements run. */
export async function prepareCreatePass(config, database, tables) {
  const conn = await connect(config, database);
  try {
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const table of tables) await conn.query(`DROP TABLE IF EXISTS ${ident(table)}`);
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  } finally {
    await conn.end();
  }
}

/**
 * alter pass: drop every column the copy adds with ADD COLUMN (and the foreign keys of
 * that table that use it), so the copy's guarded ALTERs run on the reference's tables.
 * A column the reference lacks stays absent (the copy adds an extra column).
 */
export async function prepareAlterPass(config, database, addColumns) {
  const conn = await connect(config, database);
  try {
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const { table, column } of addColumns) {
      const [present] = await conn.query(
        'SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?',
        [database, table, column],
      );
      if (present.length === 0) continue;
      const [fks] = await conn.query(
        `SELECT DISTINCT CONSTRAINT_NAME AS name FROM information_schema.KEY_COLUMN_USAGE
          WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL`,
        [database, table, column],
      );
      for (const { name } of fks) {
        await conn.query(`ALTER TABLE ${ident(table)} DROP FOREIGN KEY ${ident(name)}`);
      }
      await conn.query(`ALTER TABLE ${ident(table)} DROP COLUMN ${ident(column)}`);
    }
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  } finally {
    await conn.end();
  }
}

function indexPart(row) {
  let part = row.column_name ?? `(${row.expression})`;
  if (row.sub_part !== null && row.sub_part !== undefined) part += `(${row.sub_part})`;
  if (row.collation === 'D') part += ' DESC';
  return part;
}

/**
 * Reads one database back from information_schema: base tables with their columns,
 * indexes, foreign keys and CHECK constraints, plus the objects the check does not model
 * (views, triggers, routines, events), which must not exist.
 */
export async function snapshot(conn, database) {
  const tables = {};
  const others = { views: [], triggers: [], routines: [], events: [] };

  const [tableRows] = await conn.query(
    `SELECT TABLE_NAME AS name, TABLE_TYPE AS type, ENGINE AS engine, TABLE_COLLATION AS collation
       FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME`,
    [database],
  );
  for (const t of tableRows) {
    if (t.type === 'BASE TABLE') {
      tables[t.name] = { engine: t.engine, collation: t.collation, columns: [], indexes: {}, fks: {}, checks: {} };
    } else {
      others.views.push(t.name);
    }
  }

  const [columnRows] = await conn.query(
    `SELECT TABLE_NAME AS t, COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable,
            COLUMN_DEFAULT AS dflt, EXTRA AS extra, CHARACTER_SET_NAME AS charset,
            COLLATION_NAME AS collation, GENERATION_EXPRESSION AS generation
       FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION`,
    [database],
  );
  for (const c of columnRows) {
    if (!tables[c.t]) continue;
    tables[c.t].columns.push({
      name: c.name,
      type: c.type,
      nullable: c.nullable,
      default: c.dflt,
      extra: c.extra,
      charset: c.charset,
      collation: c.collation,
      generation: c.generation,
    });
  }

  const [indexRows] = await conn.query(
    `SELECT TABLE_NAME AS t, INDEX_NAME AS name, NON_UNIQUE AS non_unique, COLUMN_NAME AS column_name,
            SUB_PART AS sub_part, COLLATION AS collation, INDEX_TYPE AS index_type,
            IS_VISIBLE AS visible, EXPRESSION AS expression
       FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ?
      ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
    [database],
  );
  for (const r of indexRows) {
    if (!tables[r.t]) continue;
    const idx = (tables[r.t].indexes[r.name] ??= {
      unique: Number(r.non_unique) === 0,
      columns: [],
      type: r.index_type,
      visible: r.visible,
    });
    idx.columns.push(indexPart(r));
  }

  const [fkRows] = await conn.query(
    `SELECT rc.TABLE_NAME AS t, rc.CONSTRAINT_NAME AS name, rc.UPDATE_RULE AS on_update,
            rc.DELETE_RULE AS on_delete, k.COLUMN_NAME AS column_name,
            k.REFERENCED_TABLE_SCHEMA AS ref_schema, k.REFERENCED_TABLE_NAME AS ref_table,
            k.REFERENCED_COLUMN_NAME AS ref_column
       FROM information_schema.REFERENTIAL_CONSTRAINTS rc
       JOIN information_schema.KEY_COLUMN_USAGE k
         ON k.CONSTRAINT_SCHEMA = rc.CONSTRAINT_SCHEMA
        AND k.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
        AND k.TABLE_NAME = rc.TABLE_NAME
      WHERE rc.CONSTRAINT_SCHEMA = ?
      ORDER BY rc.TABLE_NAME, rc.CONSTRAINT_NAME, k.ORDINAL_POSITION`,
    [database],
  );
  for (const r of fkRows) {
    if (!tables[r.t]) continue;
    const fk = (tables[r.t].fks[r.name] ??= {
      columns: [],
      // A reference into another database would be a difference of its own.
      ref_table: r.ref_schema === database ? r.ref_table : `${r.ref_schema}.${r.ref_table}`,
      ref_columns: [],
      on_delete: r.on_delete,
      on_update: r.on_update,
    });
    fk.columns.push(r.column_name);
    fk.ref_columns.push(r.ref_column);
  }

  const [checkRows] = await conn.query(
    `SELECT tc.TABLE_NAME AS t, tc.CONSTRAINT_NAME AS name, cc.CHECK_CLAUSE AS clause, tc.ENFORCED AS enforced
       FROM information_schema.TABLE_CONSTRAINTS tc
       JOIN information_schema.CHECK_CONSTRAINTS cc
         ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
      WHERE tc.CONSTRAINT_SCHEMA = ? AND tc.CONSTRAINT_TYPE = 'CHECK'
      ORDER BY tc.TABLE_NAME, tc.CONSTRAINT_NAME`,
    [database],
  );
  for (const r of checkRows) {
    if (!tables[r.t]) continue;
    tables[r.t].checks[r.name] = { clause: r.clause, enforced: r.enforced };
  }

  const [triggers] = await conn.query(
    'SELECT TRIGGER_NAME AS name FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ?',
    [database],
  );
  const [routines] = await conn.query(
    'SELECT ROUTINE_NAME AS name FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ?',
    [database],
  );
  const [events] = await conn.query(
    'SELECT EVENT_NAME AS name FROM information_schema.EVENTS WHERE EVENT_SCHEMA = ?',
    [database],
  );
  others.triggers = triggers.map((r) => r.name);
  others.routines = routines.map((r) => r.name);
  others.events = events.map((r) => r.name);
  return { tables, others };
}

export function snapshotCounts(snap) {
  const tables = Object.values(snap.tables);
  return {
    tables: tables.length,
    columns: tables.reduce((n, t) => n + t.columns.length, 0),
    indexes: tables.reduce((n, t) => n + Object.keys(t.indexes).length, 0),
    fks: tables.reduce((n, t) => n + Object.keys(t.fks).length, 0),
    checks: tables.reduce((n, t) => n + Object.keys(t.checks).length, 0),
  };
}

/** Objects in a database the check does not model; any of them fails the check. */
export function unmodelledObjects(snap) {
  return Object.entries(snap.others).flatMap(([kind, names]) => names.map((n) => `${kind.slice(0, -1)} ${n}`));
}

/** Keys of api/.env the Laravel mysql connection reads beyond the ones the check sets. */
const LARAVEL_ENV_NOTES = ['DB_CHARSET', 'DB_COLLATION', 'MYSQL_ATTR_SSL_CA'];

/**
 * Runs the Laravel migrations for real against `database`. Preflight failures (php,
 * pdo_mysql or api/vendor missing) mean the check cannot run: never a skip.
 */
export function runLaravelMigrations({ repo, appDir, config, database, php, log, readEnvFileKeys }) {
  const cwd = join(repo, appDir);
  if (!existsSync(join(cwd, 'vendor', 'autoload.php'))) {
    throw new CannotRun(`${appDir}/vendor is missing: run \`composer install\` in ${appDir}/ first`);
  }
  const probe = spawnSync(php, ['-r', "exit(extension_loaded('pdo_mysql') ? 0 : 3);"], { encoding: 'utf8' });
  if (probe.error) throw new CannotRun(`cannot run ${php}: ${probe.error.code ?? probe.error.message}`);
  if (probe.status === 3) throw new CannotRun(`${php} has no pdo_mysql extension (SCHEMA_DRIFT_PHP selects another binary)`);
  if (probe.status !== 0) throw new CannotRun(`${php} -r failed with exit code ${probe.status}`);

  const localKeys = readEnvFileKeys(join(cwd, '.env')).filter((k) => LARAVEL_ENV_NOTES.includes(k));
  if (localKeys.length > 0) {
    log(`  [laravel] note: ${appDir}/.env sets ${localKeys.join(', ')}; CI has no ${appDir}/.env, so CI may differ`);
  }

  const env = {
    ...process.env,
    APP_ENV: 'testing',
    // A cached configuration (`php artisan config:cache`) would ignore the variables
    // below; a path that does not exist makes Laravel read the live configuration.
    APP_CONFIG_CACHE: join(tmpdir(), `schema-drift-no-config-${randomBytes(8).toString('hex')}.php`),
    LOG_CHANNEL: 'stderr',
    DB_CONNECTION: 'mysql',
    // Real environment variables win over api/.env; empty values neutralise a URL or
    // socket a local .env may set.
    DB_URL: '',
    DB_SOCKET: '',
    DB_HOST: config.host,
    DB_PORT: String(config.port),
    DB_DATABASE: database,
    DB_USERNAME: config.user,
    DB_PASSWORD: config.password,
  };
  const result = spawnSync(php, ['artisan', 'migrate', '--database=mysql', '--force', '--no-interaction', '--no-ansi'], {
    cwd,
    env,
    encoding: 'utf8',
    timeout: 5 * 60 * 1000,
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== '');
  for (const line of output) log(`  [laravel] ${line.trim()}`);
  if (result.error) throw new CannotRun(`php artisan migrate could not run: ${result.error.code ?? result.error.message}`);
  return { status: result.status };
}
