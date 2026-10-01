// Runs the Node schema copies in isolation. The copies share db.js's module-level pool,
// so the check replaces that pool's entry points:
//   - guard:     outside a pass every call counts and throws (importing a copy must run nothing);
//   - recorder:  discovery executes nothing and answers every probe with zero rows
//                ("absent"), so every guarded branch is taken and recorded;
//   - router:    a real pass sends every statement to one connection on the pass's database.
// Contract for a copy (README.md): use pool.query only, read "no rows" as "absent",
// run no query on import.
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { format } from 'node:util';
import { classify } from './compare.mjs';
import { NODE_COPIES } from './copies.mjs';

export const REPO = fileURLToPath(new URL('../../', import.meta.url));

const POOL_ENTRY_POINTS = ['query', 'execute', 'getConnection'];

function installGuard(pool) {
  const guard = { hits: 0, calls: {} };
  guard.functions = Object.fromEntries(
    POOL_ENTRY_POINTS.map((name) => [
      name,
      function guardedPoolCall() {
        guard.hits += 1;
        throw new Error(`schema-drift: pool.${name}() called outside a pass`);
      },
    ]),
  );
  guard.reset = () => {
    for (const name of POOL_ENTRY_POINTS) pool[name] = guard.functions[name];
  };
  guard.reset();
  return guard;
}

/**
 * Imports db.js and every registered Node copy with the pool guarded. Returns the
 * callable copies and the problems found (a missing export, queries run on import).
 */
export async function loadNodeCopies({ repo = REPO, copies = NODE_COPIES } = {}) {
  // The server modules build their own pool at import time. Point it at a host that
  // cannot resolve, so nothing a copy does can ever reach a real database by accident.
  // dotenv never overrides variables that are already set.
  process.env.DB_HOST = 'schema-drift.invalid';
  process.env.DB_PORT = '3306';
  process.env.DB_USERNAME = 'schema_drift_unused';
  process.env.DB_PASSWORD = '';
  process.env.DB_DATABASE = 'schema_drift_unused';
  const { pool } = await import(pathToFileURL(join(repo, 'server/src/db.js')).href);
  const guard = installGuard(pool);
  const loaded = [];
  const problems = [];
  for (const copy of copies) {
    const before = guard.hits;
    let mod;
    try {
      mod = await import(pathToFileURL(join(repo, copy.path)).href);
    } catch (err) {
      problems.push(`${copy.id}: importing ${copy.path} failed: ${err.message}`);
      continue;
    }
    // Let work the module started on import reach its first query.
    await new Promise((resolve) => setImmediate(resolve));
    if (guard.hits > before) {
      problems.push(
        `${copy.id}: importing ${copy.path} ran ${guard.hits - before} quer${guard.hits - before === 1 ? 'y' : 'ies'} (code runs on import, e.g. the seed's main())`,
      );
    }
    if (typeof mod[copy.exportName] !== 'function') {
      problems.push(`${copy.id}: ${copy.path} does not export ${copy.exportName}()`);
      continue;
    }
    loaded.push({ ...copy, fn: mod[copy.exportName] });
  }
  return { pool, guard, loaded, problems };
}

async function withCapturedConsole(id, log, fn) {
  const saved = { log: console.log, info: console.info, warn: console.warn, error: console.error };
  const forward = (...args) => log(`  [${id}] ${format(...args)}`);
  console.log = forward;
  console.info = forward;
  console.warn = forward;
  console.error = forward;
  try {
    return await fn();
  } finally {
    Object.assign(console, saved);
  }
}

const statementText = (sql) => (typeof sql === 'string' ? sql : sql?.sql);

/** Discovery: runs the copy against a recording pool that executes nothing. */
export async function discover(env, copy, log = () => {}) {
  const { pool, guard } = env;
  const statements = [];
  pool.query = async (sql) => {
    const st = classify(statementText(sql));
    statements.push(st);
    return st.type === 'probe' ? [[], []] : [{ affectedRows: 0, insertId: 0, warningStatus: 0 }, undefined];
  };
  try {
    await withCapturedConsole(copy.id, log, () => copy.fn());
    return { statements, error: null };
  } catch (err) {
    return { statements, error: err };
  } finally {
    guard.reset();
  }
}

/** A real pass: every pool.query of the copy goes to `connection`. */
export async function runOnConnection(env, copy, connection, log = () => {}, label = copy.id) {
  const { pool, guard } = env;
  let lastStatement = null;
  let sent = 0;
  pool.query = (sql, values) => {
    lastStatement = statementText(sql);
    sent += 1;
    return connection.query(sql, values);
  };
  try {
    await withCapturedConsole(label, log, () => copy.fn());
    return { sent, error: null, lastStatement };
  } catch (err) {
    return { sent, error: err, lastStatement };
  } finally {
    guard.reset();
  }
}
