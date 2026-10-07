// Registry of the schema drift check (F-33): the reference, the four copies it is
// compared with, the databases the check may create, and the scan rules that find a
// schema copy nobody registered. Data only; README.md explains how to extend it.

/** The source of truth. */
export const REFERENCE = { path: 'server/schema.sql' };

/**
 * Node copies: modules whose exported function applies schema changes through
 * db.js's shared pool. `complete` = the copy claims to own the whole schema, so every
 * reference table it does not create is a difference (table-not-defined).
 */
export const NODE_COPIES = [
  {
    id: 'db.js',
    slug: 'dbjs',
    path: 'server/src/db.js',
    exportName: 'ensureSchema',
    // Runs on every server start and says it owns the schema (db.js ensureSchema() doc).
    complete: true,
  },
  {
    id: 'seed.js',
    slug: 'seed',
    path: 'server/src/seed.js',
    exportName: 'ensureSchema',
    // Retrofits a few columns and one table for databases older than those changes.
    complete: false,
  },
  {
    id: 'import/store.js',
    slug: 'import',
    path: 'server/src/import/store.js',
    exportName: 'ensureImportSchema',
    // Creates only the importer's own table.
    complete: false,
  },
];

export const NODE_PASSES = ['noop', 'create', 'alter'];

/** The stock Laravel migrations, run for real with `php artisan migrate`. */
export const LARAVEL = { id: 'laravel', pass: 'migrate', appDir: 'api', migrationsDir: 'api/database/migrations' };

/**
 * The only databases the check creates or drops. Fixed names, never a pattern, so a
 * run can never touch another database on the same server.
 */
export const DATABASES = {
  reference: 'schema_drift_ref',
  laravel: 'schema_drift_laravel',
  pass: (copy, pass) => `schema_drift_${copy.slug}_${pass}`,
};

export function allDatabaseNames() {
  return [
    DATABASES.reference,
    ...NODE_COPIES.flatMap((copy) => NODE_PASSES.map((pass) => DATABASES.pass(copy, pass))),
    DATABASES.laravel,
  ];
}

/** Files that define schema and are compared above. Any other file with DDL fails the check. */
export const DDL_SCAN = {
  extensions: ['.js', '.mjs', '.cjs', '.ts', '.tsx', '.sql', '.php'],
  // The check itself (its passes drop and re-add tables and columns on purpose).
  ignorePrefixes: ['scripts/schema-drift/'],
  registered: [
    { path: REFERENCE.path },
    ...NODE_COPIES.map((copy) => ({ path: copy.path })),
    { pattern: /^api\/database\/migrations\/[^/]+\.php$/ },
  ],
};
