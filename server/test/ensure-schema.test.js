/**
 * ensureSchema() retrofits columns one guarded ALTER at a time. Several of them
 * place the new column `AFTER` another column that ensureSchema() itself adds.
 * On a database that lacks both, the ALTER that names the missing column fails
 * (ER_BAD_FIELD_ERROR) and every later step of ensureSchema() never runs.
 *
 * This test needs no database: it runs ensureSchema() against a recording pool
 * that answers every probe with "no rows" (column absent), so every guarded
 * branch is taken in the order a database lacking all of them would see.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { ensureSchema, pool } from '../src/db.js';

async function recordStatements() {
  const original = pool.query;
  const statements = [];
  pool.query = async (sql) => {
    const text = String(typeof sql === 'string' ? sql : sql.sql)
      .replace(/\s+/g, ' ')
      .trim();
    statements.push(text);
    return /^(SELECT|SHOW)\b/i.test(text) ? [[], []] : [{ affectedRows: 0 }, undefined];
  };
  try {
    await ensureSchema();
  } finally {
    pool.query = original;
  }
  return statements;
}

const ADD_COLUMN = /^ALTER\s+TABLE\s+`?(\w+)`?\s+ADD\s+COLUMN\s+`?(\w+)`?\s.*?(?:\s+AFTER\s+`?(\w+)`?)?$/i;

test('ensureSchema adds every column before it places another column AFTER it', async () => {
  const adds = (await recordStatements())
    .map((statement) => ADD_COLUMN.exec(statement))
    .filter(Boolean)
    .map(([, table, column, after]) => ({ table, column, after: after ?? null }));
  const position = (table, column) => adds.findIndex((a) => a.table === table && a.column === column);

  // Denominators: what this test examined.
  const ownAfters = adds.filter((a) => a.after !== null && position(a.table, a.after) !== -1);
  assert.ok(adds.length > 0, 'ensureSchema() recorded no ADD COLUMN at all');
  assert.ok(ownAfters.length > 0, 'no ADD COLUMN positions itself after a column ensureSchema() adds');

  const problems = ownAfters
    .filter((a) => position(a.table, a.after) > position(a.table, a.column))
    .map((a) => `${a.table}.${a.column} is added AFTER ${a.after}, which ensureSchema() only adds later`);
  assert.deepEqual(problems, [], `${adds.length} ADD COLUMN statements, ${ownAfters.length} positioned after an own column`);

  // The case found by the schema drift check (F-33).
  assert.ok(position('activities', 'boosted_until') < position('activities', 'is_permanent'));
});
