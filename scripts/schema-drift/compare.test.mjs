// Unit tests of the schema drift check's pure logic (no MySQL, no server modules).
//   node --test "scripts/schema-drift/*.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  addColumnOrderProblems,
  candidateSkeleton,
  classify,
  diffSnapshots,
  evaluateAllowlist,
  parseAllowlist,
  ratchetAdded,
  ratchetVerdict,
  scanForSchemaCopies,
  scopeDifferences,
  zeroDenominatorRefusals,
} from './compare.mjs';
import { DDL_SCAN, LARAVEL, NODE_COPIES, REFERENCE, allDatabaseNames } from './copies.mjs';

// --- synthetic snapshots -------------------------------------------------------------

function col(name, over = {}) {
  return {
    name,
    type: 'int',
    nullable: 'NO',
    default: null,
    extra: '',
    charset: null,
    collation: null,
    generation: '',
    ...over,
  };
}

function table(columns, over = {}) {
  return { engine: 'InnoDB', collation: 'utf8mb4_unicode_ci', columns, indexes: {}, fks: {}, checks: {}, ...over };
}

function snap(tables) {
  return { tables, others: { views: [], triggers: [], routines: [], events: [] } };
}

const diff = (ref, copy, referenceOnly = 'missing') =>
  diffSnapshots(snap(ref), snap(copy), { prefix: 'x/create', referenceOnly }).differences;

// --- snapshot comparison ---------------------------------------------------------------

test('reports a column that only the copy has', () => {
  assert.deepEqual(diff({ t: table([col('id')]) }, { t: table([col('id'), col('probe')]) }), [
    'x/create column-extra t.probe',
  ]);
});

test('reports a column that only the reference has', () => {
  assert.deepEqual(diff({ t: table([col('id'), col('probe')]) }, { t: table([col('id')]) }), [
    'x/create column-missing t.probe',
  ]);
});

test("reports each changed column attribute once (type, nullable, default NULL vs '', extra, charset, collation)", () => {
  const ref = col('c', { type: 'varchar(512)', nullable: 'YES', default: null, extra: '', charset: 'utf8mb4', collation: 'utf8mb4_unicode_ci' });
  const copy = col('c', {
    type: 'varchar(500)',
    nullable: 'NO',
    default: '',
    extra: 'DEFAULT_GENERATED',
    charset: 'latin1',
    collation: 'latin1_swedish_ci',
  });
  assert.deepEqual(diff({ t: table([ref]) }, { t: table([copy]) }), [
    'x/create column-attr t.c charset ref="utf8mb4" copy="latin1"',
    'x/create column-attr t.c collation ref="utf8mb4_unicode_ci" copy="latin1_swedish_ci"',
    'x/create column-attr t.c default ref=null copy=""',
    'x/create column-attr t.c extra ref="" copy="DEFAULT_GENERATED"',
    'x/create column-attr t.c nullable ref="YES" copy="NO"',
    'x/create column-attr t.c type ref="varchar(512)" copy="varchar(500)"',
  ]);
  assert.deepEqual(diff({ t: table([ref]) }, { t: table([{ ...ref }]) }), [], 'identical columns are no difference');
});

test('compares only the relative order of shared columns, one difference per table', () => {
  const ref = { t: table([col('a'), col('b'), col('c')]) };
  assert.deepEqual(diff(ref, { t: table([col('b'), col('a'), col('c'), col('x')]) }), [
    'x/create column-extra t.x',
    'x/create column-order t ref=["a","b","c"] copy=["b","a","c"]',
  ]);
  // A missing or extra column alone does not shift the order of the others.
  assert.deepEqual(diff(ref, { t: table([col('a'), col('c')]) }), ['x/create column-missing t.b']);
  assert.deepEqual(diff(ref, { t: table([col('x'), col('a'), col('b'), col('c')]) }), ['x/create column-extra t.x']);
});

test('keys index, foreign key and check differences by name with their attribute', () => {
  const ref = table([col('id'), col('u')], {
    indexes: {
      PRIMARY: { unique: true, columns: ['id'], type: 'BTREE', visible: 'YES' },
      t_u_idx: { unique: false, columns: ['u'], type: 'BTREE', visible: 'YES' },
      t_gone_idx: { unique: false, columns: ['u'], type: 'BTREE', visible: 'YES' },
    },
    fks: { t_u_fk: { columns: ['u'], ref_table: 'users', ref_columns: ['id'], on_delete: 'CASCADE', on_update: 'NO ACTION' } },
    checks: { t_chk: { clause: '(`u` > 0)', enforced: 'YES' } },
  });
  const copy = table([col('id'), col('u')], {
    indexes: {
      PRIMARY: { unique: true, columns: ['id'], type: 'BTREE', visible: 'YES' },
      t_u_idx: { unique: true, columns: ['u', 'id'], type: 'BTREE', visible: 'YES' },
      t_new_idx: { unique: false, columns: ['id'], type: 'BTREE', visible: 'YES' },
    },
    fks: { t_u_fk: { columns: ['u'], ref_table: 'users', ref_columns: ['id'], on_delete: 'SET NULL', on_update: 'NO ACTION' } },
    checks: {},
  });
  assert.deepEqual(diff({ t: ref }, { t: copy }), [
    'x/create check-missing t.t_chk',
    'x/create fk-attr t.t_u_fk on_delete ref="CASCADE" copy="SET NULL"',
    'x/create index-attr t.t_u_idx columns ref=["u"] copy=["u","id"]',
    'x/create index-attr t.t_u_idx unique ref=false copy=true',
    'x/create index-extra t.t_new_idx',
    'x/create index-missing t.t_gone_idx',
  ]);
});

test('complete scope reports table-not-defined; partial scope ignores reference-only tables', () => {
  const referenceTables = ['a', 'b', 'users'];
  assert.deepEqual(scopeDifferences({ prefix: 'db.js/create', complete: true, referenceTables, createSet: ['b'] }), [
    'db.js/create table-not-defined a',
    'db.js/create table-not-defined users',
  ]);
  assert.deepEqual(scopeDifferences({ prefix: 'seed.js/create', complete: false, referenceTables, createSet: ['b'] }), []);
  const ref = { a: table([col('id')]), b: table([col('id')]) };
  const copy = { b: table([col('id')]) };
  assert.deepEqual(diff(ref, copy, 'missing'), ['x/create table-missing a'], 'a Node pass loses a table');
  const laravel = diffSnapshots(snap(ref), snap(copy), { prefix: 'laravel/migrate', referenceOnly: 'ignore' });
  assert.deepEqual(laravel.differences, []);
  assert.deepEqual(laravel.referenceOnlyTables, ['a']);
  assert.equal(laravel.counts.tables, 1);
  assert.throws(() => diffSnapshots(snap(ref), snap(copy), { prefix: 'p', referenceOnly: 'maybe' }));
});

test('extra table key carries its column list', () => {
  const differences = diff({}, { migrations: table([col('id'), col('migration'), col('batch')]) });
  assert.deepEqual(differences, ['x/create table-extra migrations(id,migration,batch)']);
  // A column added to an extra table is a new key, so the allow-list cannot hide it.
  assert.notDeepEqual(diff({}, { migrations: table([col('id'), col('migration'), col('batch'), col('probe')]) }), differences);
});

test('counts what a comparison examined', () => {
  const t = table([col('id'), col('u')], {
    indexes: { PRIMARY: { unique: true, columns: ['id'], type: 'BTREE', visible: 'YES' } },
    fks: { f: { columns: ['u'], ref_table: 'users', ref_columns: ['id'], on_delete: 'CASCADE', on_update: 'NO ACTION' } },
  });
  const result = diffSnapshots(snap({ t, only_ref: table([col('id')]) }), snap({ t }), { prefix: 'p', referenceOnly: 'ignore' });
  assert.deepEqual(result.counts, { tables: 1, columns: 2, indexes: 1, fks: 1, objects: 5 });
});

// --- allow-list ------------------------------------------------------------------------

const REASON = 'a reason that explains the accepted difference';

test('allow-list: unexpected fails, stale fails, exact match passes', () => {
  const differences = ['db.js/create table-not-defined users', 'laravel/migrate table-extra migrations(id,migration,batch)'];
  assert.deepEqual(evaluateAllowlist(differences, [...differences]), { unexpected: [], stale: [], allowed: 2 });
  assert.deepEqual(evaluateAllowlist(differences, [differences[0]]).unexpected, [differences[1]]);
  const stale = 'db.js/create table-not-defined drift_probe_table';
  assert.deepEqual(evaluateAllowlist(differences, [...differences, stale]).stale, [stale]);
});

test('allow-list validation rejects empty or TODO reasons, duplicate entries, unknown fields, apply-error entries', () => {
  const entry = 'db.js/create table-not-defined users';
  const ok = parseAllowlist({ about: 'x', groups: [{ reason: REASON, entries: [entry] }] });
  assert.deepEqual(ok, { entries: [entry], errors: [] });

  const errorsOf = (doc) => parseAllowlist(doc).errors;
  assert.match(errorsOf({ groups: [{ reason: '', entries: [entry] }] }).join('\n'), /reason/);
  assert.match(errorsOf({ groups: [{ reason: 'too short', entries: [entry] }] }).join('\n'), /at least 20/);
  assert.match(errorsOf({ groups: [{ reason: `TODO ${REASON}`, entries: [entry] }] }).join('\n'), /TODO/);
  assert.match(errorsOf({ groups: [{ reason: REASON, entries: [entry, entry] }] }).join('\n'), /duplicate/);
  assert.match(
    errorsOf({ groups: [{ reason: REASON, entries: [entry] }, { reason: REASON, entries: [entry] }] }).join('\n'),
    /duplicate/,
  );
  assert.match(errorsOf({ groups: [], extra: 1 }).join('\n'), /unknown top-level field "extra"/);
  assert.match(errorsOf({ groups: [{ reason: REASON, entries: [entry], why: 'x' }] }).join('\n'), /unknown field "why"/);
  assert.match(errorsOf({ groups: [{ reason: REASON, entries: [] }] }).join('\n'), /non-empty/);
  assert.match(errorsOf({ groups: [{ reason: REASON, entries: ['not a key'] }] }).join('\n'), /not a difference key/);
  assert.match(
    errorsOf({ groups: [{ reason: REASON, entries: ['db.js/alter apply-error 1054 ALTER TABLE activities'] }] }).join('\n'),
    /apply errors can never be allow-listed/,
  );
  assert.match(errorsOf([]).join('\n'), /JSON object/);
  assert.match(errorsOf({ about: 'x' }).join('\n'), /"groups" must be an array/);

  // The skeleton printed by --print-candidates cannot be committed as it is.
  const skeleton = candidateSkeleton([entry, 'db.js/alter apply-error 1054 ALTER TABLE activities']);
  assert.equal(skeleton.groups.length, 1, 'apply errors are left out of the skeleton');
  assert.match(errorsOf(skeleton).join('\n'), /TODO/);
});

test('the committed allow-list is valid, and every entry has a reason', () => {
  const doc = JSON.parse(readFileSync(new URL('./allowlist.json', import.meta.url), 'utf8'));
  const { entries, errors } = parseAllowlist(doc);
  assert.deepEqual(errors, []);
  assert.ok(entries.length > 0, 'the allow-list has no entries');
});

test('ratchet fails on an added entry and passes on a removed one', () => {
  const base = ['a/create table-not-defined x', 'a/create table-not-defined y'];
  assert.deepEqual(ratchetAdded(base.slice(0, 1), base), [], 'removing an entry is allowed');
  assert.deepEqual(ratchetAdded([...base, 'a/create table-not-defined z'], base), ['a/create table-not-defined z']);

  const doc = { groups: [{ reason: REASON, entries: base }] };
  assert.deepEqual(ratchetVerdict(base, { hasAllowlist: true, hasCheck: true, doc }), {
    status: 'compared',
    added: [],
    baseCount: 2,
  });
  assert.deepEqual(ratchetVerdict([...base, 'a/create table-not-defined z'], { hasAllowlist: true, hasCheck: true, doc }).added, [
    'a/create table-not-defined z',
  ]);
});

test('ratchet bootstrap: only a base without both the check and the allow-list is a first introduction', () => {
  const entries = ['a/create table-not-defined x'];
  assert.equal(ratchetVerdict(entries, { hasAllowlist: false, hasCheck: false, doc: null }).status, 'first-introduction');
  const deleted = ratchetVerdict(entries, { hasAllowlist: false, hasCheck: true, doc: null });
  assert.equal(deleted.status, 'refused', 'deleting the list must not reset the ratchet');
  assert.equal(ratchetVerdict(entries, { hasAllowlist: true, hasCheck: true, doc: undefined }).status, 'refused');
});

test('refuses to report clean when a denominator is zero', () => {
  const good = {
    reference: { tables: 38, createStatements: 38 },
    copies: [{ id: 'db.js', defines: 43 }],
    laravel: { tables: 8 },
    comparedObjects: 1000,
    scan: { filesScanned: 300 },
  };
  assert.deepEqual(zeroDenominatorRefusals(good), []);
  const refusals = (over) => zeroDenominatorRefusals({ ...good, ...over }).join('\n');
  assert.match(refusals({ reference: { tables: 0, createStatements: 38 } }), /0 tables/);
  assert.match(refusals({ reference: null }), /0 tables/);
  assert.match(refusals({ reference: { tables: 37, createStatements: 38 } }), /did not load completely/);
  assert.match(refusals({ copies: [{ id: 'seed.js', defines: 0 }] }), /seed\.js defines nothing/);
  assert.match(refusals({ laravel: { tables: 0 } }), /Laravel migrations created 0 tables/);
  assert.match(refusals({ laravel: null }), /Laravel migrations created 0 tables/);
  assert.match(refusals({ comparedObjects: 0 }), /0 schema objects were compared/);
  assert.match(refusals({ scan: { filesScanned: 0 } }), /read 0 files/);
});

// --- statements --------------------------------------------------------------------------

test('classify(): create-table, single add-column, multi-clause alter, data, probe, session, unsupported, multi-statement', () => {
  const create = classify('\n  -- comment\n  CREATE TABLE IF NOT EXISTS `posts` (\n id INT, note VARCHAR(5) DEFAULT \';\'\n) ENGINE=InnoDB');
  assert.deepEqual([create.type, create.table], ['create-table', 'posts']);

  const add = classify('ALTER TABLE activities ADD COLUMN is_permanent TINYINT(1) NOT NULL DEFAULT 0 AFTER boosted_until');
  assert.deepEqual([add.type, add.table, add.column, add.after], ['add-column', 'activities', 'is_permanent', 'boosted_until']);
  const quoted = classify('ALTER TABLE activity_interest ADD COLUMN `rank` TINYINT UNSIGNED NOT NULL DEFAULT 0');
  assert.deepEqual([quoted.type, quoted.column, quoted.after], ['add-column', 'rank', null]);
  const multiline = classify("ALTER TABLE account_upgrade_requests\n   ADD COLUMN billing_period VARCHAR(10) NOT NULL DEFAULT 'monthly' AFTER requested_type");
  assert.deepEqual([multiline.type, multiline.column, multiline.after], ['add-column', 'billing_period', 'requested_type']);
  assert.equal(classify('ALTER TABLE t ADD c INT').type, 'add-column', 'COLUMN is optional');

  assert.equal(classify('ALTER TABLE t ADD COLUMN a INT, ADD COLUMN b INT').type, 'other-ddl');
  assert.equal(classify('ALTER TABLE t ADD INDEX t_a_idx (a, b)').type, 'other-ddl');
  assert.equal(classify('ALTER TABLE t MODIFY a BIGINT').type, 'other-ddl');
  assert.equal(classify('CREATE UNIQUE INDEX t_a_uq ON t (a)').type, 'other-ddl');
  assert.equal(classify('DROP INDEX t_a_uq ON t').type, 'other-ddl');

  assert.equal(classify("UPDATE users SET account_type = 'standard' WHERE account_type = 'personal'").type, 'data');
  assert.equal(classify('INSERT INTO t (a) VALUES ?').type, 'data');
  assert.equal(classify('SELECT 1 FROM information_schema.columns WHERE table_name = ?').type, 'probe');
  assert.equal(classify('SHOW TABLES').type, 'probe');
  assert.equal(classify('SET FOREIGN_KEY_CHECKS = 0').type, 'session');

  assert.equal(classify('DROP TABLE t').type, 'unsupported');
  assert.equal(classify('CREATE TABLE a (id INT); CREATE TABLE b (id INT)').type, 'unsupported');
  assert.equal(classify('CREATE TABLE a (id INT);').type, 'create-table', 'one trailing semicolon is one statement');
  assert.equal(classify('').type, 'unsupported');
  assert.equal(classify(undefined).type, 'unsupported');
});

test('flags an ADD COLUMN placed AFTER a column the same copy only adds later', () => {
  const statements = [
    'ALTER TABLE activities ADD COLUMN is_permanent TINYINT(1) NOT NULL DEFAULT 0 AFTER boosted_until',
    'ALTER TABLE activities ADD COLUMN boosted_until DATETIME NULL AFTER max_participants',
  ].map(classify);
  assert.deepEqual(addColumnOrderProblems(statements), [
    'activities.is_permanent is added AFTER boosted_until, but activities.boosted_until is only added later',
  ]);
  assert.deepEqual(addColumnOrderProblems([...statements].reverse()), []);
});

// --- registry and scan -------------------------------------------------------------------

test('the registry names the reference, the four copies and only fixed database names', () => {
  assert.equal(REFERENCE.path, 'server/schema.sql');
  assert.equal(LARAVEL.migrationsDir, 'api/database/migrations');
  assert.deepEqual(
    NODE_COPIES.map((c) => c.path),
    ['server/src/db.js', 'server/src/seed.js', 'server/src/import/store.js'],
  );
  const names = allDatabaseNames();
  assert.equal(names.length, 11);
  assert.equal(new Set(names).size, names.length);
  for (const name of names) assert.match(name, /^schema_drift_[a-z_]+$/);
});

test('DDL scan flags an unregistered file, accepts registered copies and ignores scripts/schema-drift/', () => {
  const files = [
    { path: 'server/schema.sql', text: 'CREATE TABLE IF NOT EXISTS users (id INT);' },
    { path: 'server/src/db.js', text: 'await pool.query(`CREATE TABLE IF NOT EXISTS a (id INT)`);' },
    { path: 'server/src/seed.js', text: "await pool.query('ALTER TABLE users ADD COLUMN x INT');" },
    { path: 'server/src/import/store.js', text: 'CREATE TABLE IF NOT EXISTS imported_events (id INT)' },
    { path: 'api/database/migrations/0001_create_users.php', text: "Schema::create('users', function () {});" },
    { path: 'server/src/routes/posts.js', text: '// nothing here\nconst a = 1;\nawait pool.query(`ALTER TABLE posts ADD COLUMN b INT`);' },
    { path: 'scripts/schema-drift/compare.test.mjs', text: 'CREATE TABLE drift_probe (id INT)' },
    { path: 'change/ai.md', text: 'CREATE TABLE in documentation' },
    { path: 'scripts/reset-project.js', text: '// Create index files' },
  ];
  const result = scanForSchemaCopies(files, DDL_SCAN);
  assert.deepEqual(result.unregistered, ['server/src/routes/posts.js:3']);
  assert.deepEqual(result.unregisteredFiles, ['server/src/routes/posts.js']);
  assert.equal(result.registeredWithDdl, 5);
  assert.equal(result.filesScanned, 7, '.md files are not code; scripts/schema-drift/ is ignored');
  assert.deepEqual(result.staleRegistrations, []);

  const withoutSeed = scanForSchemaCopies(files.filter((f) => f.path !== 'server/src/seed.js'), DDL_SCAN);
  assert.deepEqual(withoutSeed.staleRegistrations, ['server/src/seed.js'], 'a registered copy without DDL is stale');
});
