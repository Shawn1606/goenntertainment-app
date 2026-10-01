# Schema drift check (F-33)

`server/schema.sql` is the source of truth for the database schema. Four other places define parts
of the same schema:

| Copy | What it does | Scope |
|---|---|---|
| `ensureSchema()` in `server/src/db.js` | runs on every Node start: `CREATE TABLE IF NOT EXISTS` and guarded `ADD COLUMN` | complete: it claims to own the schema |
| `ensureSchema()` in `server/src/seed.js` | retrofits a few columns and `ban_evidence` (`npm run seed`) | partial |
| `ensureImportSchema()` in `server/src/import/store.js` | creates the importer's `imported_events` | partial |
| the Laravel migrations in `api/database/migrations` | stock skeleton (`users`, `password_reset_tokens`, framework tables) | partial |

The check fails when any of them disagrees with `server/schema.sql` in a way that is not listed, with a
reason, in `allowlist.json`. The allow-list may only shrink.

## Run it

Needs Node 22.18 or newer, `npm ci --prefix server` (the check uses the server's `mysql2` and imports the
server modules), `composer install` in `api/`, a `php` with `pdo_mysql`, `git`, and an **empty, throwaway**
MySQL 8.4 server with a user that may create and drop databases.

```sh
node --test "scripts/schema-drift/*.test.mjs"     # unit tests, no MySQL
node scripts/schema-drift/check.mjs                # the check
```

Environment:

| Variable | Default | Meaning |
|---|---|---|
| `SCHEMA_DRIFT_DB_USER` | required | MySQL user with CREATE/DROP DATABASE |
| `SCHEMA_DRIFT_DB_PASSWORD` | required (may be empty) | its password |
| `SCHEMA_DRIFT_DB_HOST` | `127.0.0.1` | |
| `SCHEMA_DRIFT_DB_PORT` | `3306` | |
| `SCHEMA_DRIFT_PHP` | `php` | PHP binary for `artisan migrate` |

Options: `--allowlist <path>` (default `scripts/schema-drift/allowlist.json`), `--ratchet <git-ref>` (fail on
any allow-list entry that commit does not have; CI passes the base branch), `--print-candidates` (print
today's differences as an allow-list skeleton on stdout), `--keep` (keep the databases for inspection).
No option skips a copy, a pass or the Laravel step.

Exit codes: `0` no difference outside the allow-list and nothing refused; `1` the repository fails the
check; `2` the check could not run (MySQL unreachable, `php`/`pdo_mysql`/`api/vendor` missing, unknown git
ref, bad arguments). CI fails on both 1 and 2.

The check creates and drops only these databases (fixed names, never a pattern): `schema_drift_ref`,
`schema_drift_{dbjs,seed,import}_{noop,create,alter}` and `schema_drift_laravel`. They are created without
a character set clause, so the server default applies, as in CI and the deploy (`mysql:8.4` without flags:
`utf8mb4_0900_ai_ci`). A copy that forgets its table collation shows up as it would in production.

A local run against a throwaway container, bound to localhost only:

```sh
docker run -d --rm --name schema-drift-db -e MYSQL_ROOT_PASSWORD=local-only-not-a-secret -p 127.0.0.1:3307:3306 mysql:8.4
SCHEMA_DRIFT_DB_PORT=3307 SCHEMA_DRIFT_DB_USER=root SCHEMA_DRIFT_DB_PASSWORD=local-only-not-a-secret \
  node scripts/schema-drift/check.mjs
docker stop schema-drift-db
```

## How it works

Nothing is parsed by hand: every copy is executed for real against its own database and read back from
`information_schema`, so MySQL does the normalisation.

1. **Reference.** `server/schema.sql` is loaded into `schema_drift_ref`. Its table count must equal the
   number of `CREATE TABLE` lines in the file.
2. **Node copies: discovery.** The server modules are imported with the shared pool guarded (any query on
   import fails the check). Each copy's function then runs once against a recording pool that executes
   nothing and answers every probe with zero rows ("absent"), so every guarded branch is taken. Each
   statement is classified by its head: `create-table`, `add-column` (single clause), `other-ddl`, `data`,
   `probe`, `session`, or `unsupported` (fails the check). An `ADD COLUMN … AFTER x` that comes before the
   copy's own `ADD COLUMN x` fails too: on a database lacking both, MySQL rejects it.
3. **Node copies: passes**, each on a fresh load of `schema.sql`, each compared with the reference as a
   whole database:
   - `noop`: run the copy unchanged (the production start path). Nothing may change or fail.
   - `create`: drop every table the copy creates, run the copy: its `CREATE TABLE` statements must equal
     the reference.
   - `alter`: drop every column the copy adds (and its foreign keys), run the copy: each `ADD COLUMN` must
     equal the reference, including its position.
   An error while the copy runs is an `apply-error`; it is never allow-listable.
4. **Laravel.** `php artisan migrate` runs against `schema_drift_laravel` with the database settings
   passed as environment variables (they win over a local `api/.env`; a cached configuration is ignored).
   Tables both sides have are compared in full; Laravel-only tables are `table-extra`.
5. **Unregistered copies.** Every tracked or untracked, non-ignored file with a code extension (`.js .mjs
   .cjs .ts .tsx .sql .php`) outside `scripts/schema-drift/` is scanned for `CREATE/ALTER/DROP/RENAME
   TABLE`, `CREATE [UNIQUE] INDEX` and `Schema::create/table/drop/dropIfExists/rename(`. A hit in a file not
   registered in `copies.mjs` fails the check, and so does a registered file without DDL.
6. **Denominators.** Every step prints what it examined. The check refuses a clean verdict when the
   reference has 0 tables (or fewer than its `CREATE TABLE` lines; then nothing is compared against
   it), a copy defines nothing, Laravel creates no table, 0 objects were compared or the scan read 0
   files.

## What a difference is

Compared per base table: engine, collation; per column: `COLUMN_TYPE` as MySQL 8.4 reports it (so
`TINYINT(1)` and `TINYINT` differ), nullability, default (`NULL` and `''` differ), extra, character set,
collation, generation expression, and the relative order of the columns both sides have (one difference
per table); indexes by name (unique, columns with prefix length and direction, type, visibility);
foreign keys by constraint name (columns, referenced table and columns, ON DELETE/UPDATE); CHECK
constraints by name. Views, triggers, routines and events fail the check (not modelled). Never compared:
AUTO_INCREMENT counters, row counts, ROW_FORMAT, comments, data.

Each difference is one key, stored verbatim in the allow-list:

```
<copy>/<pass> table-not-defined <t>               complete copy never creates a reference table
<copy>/<pass> table-missing <t>                   table lost in a Node pass
<copy>/<pass> table-extra <t>(<col>,<col>,...)    table only the copy has (a new column is a new key)
<copy>/<pass> table-attr <t> <engine|collation> ref=<json> copy=<json>
<copy>/<pass> column-missing|column-extra <t>.<c>
<copy>/<pass> column-attr <t>.<c> <type|nullable|default|extra|charset|collation|generation> ref=<json> copy=<json>
<copy>/<pass> column-order <t> ref=<json list> copy=<json list>
<copy>/<pass> index-missing|index-extra <t>.<i>   index-attr <t>.<i> <unique|columns|type|visible> ref= copy=
<copy>/<pass> fk-missing|fk-extra <t>.<f>         fk-attr <t>.<f> <columns|ref_table|ref_columns|on_delete|on_update> ref= copy=
<copy>/<pass> check-missing|check-extra <t>.<k>   check-attr <t>.<k> <clause|enforced> ref= copy=
<copy>/<pass> apply-error <errno> <statement head>   never allow-listable
```

Copies: `db.js`, `seed.js`, `import/store.js`, `laravel`; passes `noop`, `create`, `alter`, `migrate`.
A change to a reference table that no copy defines (for example a column on `interests`) is not drift,
because nothing disagrees.

## The allow-list

`allowlist.json` holds groups of keys, each with a `reason` (at least 20 characters, not starting with
`TODO`). The check fails on a difference that is not listed (**unexpected**), on an entry that matches no
difference (**stale**: delete it), on an `apply-error` entry, and with `--ratchet <ref>` on any entry the
allow-list at `<ref>` does not have. Reasons may be edited freely; only entries are ratcheted. If `<ref>`
has neither the allow-list nor the check, the run is the check's first introduction and nothing is
ratcheted; if `<ref>` has the check but no allow-list, the ratchet refuses.

## When the check fails

- **unexpected difference**: make the copies agree with `server/schema.sql`. The allow-list cannot grow
  in CI.
- **stale entry**: a known difference was fixed. Delete the entry (the list shrinks).
- **apply-error**: the copy fails on a database it should handle; fix the copy.
- **unregistered DDL**: a new place defines schema. Register it in `copies.mjs` (and teach the check to
  run it) or move the DDL into a registered copy.
- **ADD COLUMN order**: move the statement that adds the referenced column first.

A schema change therefore goes into `server/schema.sql` **and** every copy that defines the table, in the
same commit:

- a new table: `CREATE TABLE IF NOT EXISTS` in `server/src/db.js` with the same definition;
- a new column: a guarded, single-clause `ALTER TABLE t ADD COLUMN c … AFTER <previous column>` in
  `ensureSchema()` of `db.js`, matching the position in `schema.sql`;
- a change to `users` or `password_reset_tokens`: also a Laravel migration (`->after(...)` for the
  position), because the Laravel copy defines those tables.

Then run the check.

## Contract for a Node copy

A registered Node copy exports an async function, sends one statement per `pool.query()` call through
`server/src/db.js`'s pool (never `execute()` or `getConnection()`), reads "no rows" from a probe as
"absent", and runs no query when its module is imported (`seed.js` runs its seed only when executed:
`import.meta.main`). A copy that breaks the contract fails the check loudly; it cannot pass silently.

## Limits (not checked)

- Upgrades from historical versions of `schema.sql`; only today's reference and today's copies are
  compared.
- Dependencies between copies: `db.js` places columns after `users.ban_reason` and
  `activities.max_participants`, which only `seed.js` and `schema.sql` create.
- `php artisan migrate` on top of a `schema.sql` database (it would fail on `users`; the deploy never does
  it).
- Multi-clause `ALTER TABLE`, `CREATE INDEX` and other `other-ddl` statements are only checked by the
  `noop` pass.
- DDL in lowercase, or in files with other extensions (`.sh`, `.yml`, `.md`), escapes the scan.
- Data statements run but their effect is not compared.
- Constants that repeat column lengths from `schema.sql` in route validation and in the app (for example
  message and comment length limits) are further copies this check does not see.
