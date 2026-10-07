// Pure logic of the schema drift check (F-33): statement classification, snapshot
// comparison, allow-list validation and evaluation, ratchet, zero-denominator rules
// and the scan for unregistered schema copies. No I/O happens here, so every rule is
// unit-tested without MySQL (compare.test.mjs). README.md explains the rules.

const IDENT = String.raw`(?:\x60(?:[^\x60]|\x60\x60)+\x60|[A-Za-z0-9_$]+)`;

/** Removes the backquotes of a MySQL identifier. */
export function unquote(identifier) {
  if (identifier.startsWith('`') && identifier.endsWith('`')) {
    return identifier.slice(1, -1).replaceAll('``', '`');
  }
  return identifier;
}

/**
 * Walks SQL text outside string literals, quoted identifiers and comments and calls
 * visit(char, index, depth) for every top-level character. `depth` is the parenthesis
 * depth. Returning true from visit stops the walk.
 */
function walkSql(text, visit) {
  let depth = 0;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (c === "'" || c === '"' || c === '`') {
      i += 1;
      while (i < text.length) {
        if (text[i] === '\\' && c !== '`') {
          i += 2;
          continue;
        }
        if (text[i] === c) {
          if (text[i + 1] === c) {
            i += 2;
            continue;
          }
          break;
        }
        i += 1;
      }
      i += 1;
      continue;
    }
    if (c === '-' && next === '-' && (i + 2 >= text.length || /\s/.test(text[i + 2]))) {
      while (i < text.length && text[i] !== '\n') i += 1;
      continue;
    }
    if (c === '#') {
      while (i < text.length && text[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 2;
      continue;
    }
    if (c === '(') depth += 1;
    if (visit(c, i, depth)) return;
    if (c === ')') depth -= 1;
    i += 1;
  }
}

/** Strips leading whitespace and comments. */
export function stripLeadingComments(text) {
  let rest = text;
  for (;;) {
    const trimmed = rest.replace(/^\s+/, '');
    if (/^--(\s|$)/.test(trimmed) || trimmed.startsWith('#')) {
      const nl = trimmed.indexOf('\n');
      rest = nl === -1 ? '' : trimmed.slice(nl + 1);
    } else if (trimmed.startsWith('/*')) {
      const end = trimmed.indexOf('*/');
      rest = end === -1 ? '' : trimmed.slice(end + 2);
    } else {
      return trimmed;
    }
  }
}

function hasSecondStatement(text) {
  let found = false;
  walkSql(text, (c, i) => {
    if (c !== ';') return false;
    if (stripLeadingComments(text.slice(i + 1)).trim().replace(/^;+/, '').trim() !== '') {
      found = true;
      return true;
    }
    return false;
  });
  return found;
}

function hasTopLevelComma(text) {
  let found = false;
  walkSql(text, (c, _i, depth) => {
    if (c === ',' && depth === 0) {
      found = true;
      return true;
    }
    return false;
  });
  return found;
}

/** The first 80 characters of a statement on one line, for messages and keys. */
export function statementHead(text) {
  return stripLeadingComments(String(text)).replace(/\s+/g, ' ').trim().slice(0, 80);
}

const ADD_KEYWORDS = /^(INDEX|KEY|UNIQUE|PRIMARY|CONSTRAINT|FOREIGN|FULLTEXT|SPATIAL|CHECK|PARTITION)$/i;

/**
 * Classifies one statement a copy sends through pool.query(). Only the head is read;
 * nothing is parsed beyond what the passes need (README "Statement types").
 */
export function classify(text) {
  if (typeof text !== 'string') {
    return { type: 'unsupported', head: String(text), reason: 'not a string' };
  }
  const body = stripLeadingComments(text).trim();
  const head = statementHead(body);
  if (body === '') return { type: 'unsupported', head, reason: 'empty statement' };
  if (hasSecondStatement(body)) {
    return { type: 'unsupported', head, reason: 'several statements in one call' };
  }
  let m = new RegExp(String.raw`^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(${IDENT})`, 'i').exec(body);
  if (m) return { type: 'create-table', table: unquote(m[1]), head };

  m = new RegExp(String.raw`^ALTER\s+TABLE\s+(${IDENT})\s+([\s\S]*)$`, 'i').exec(body);
  if (m) {
    const table = unquote(m[1]);
    const rest = m[2].replace(/;\s*$/, '');
    if (!hasTopLevelComma(rest)) {
      const add = new RegExp(String.raw`^ADD\s+(COLUMN\s+)?(${IDENT})\s+([\s\S]*)$`, 'i').exec(rest);
      if (add && (add[1] || !ADD_KEYWORDS.test(add[2]))) {
        const after = new RegExp(String.raw`\bAFTER\s+(${IDENT})\s*$`, 'i').exec(add[3]);
        return {
          type: 'add-column',
          table,
          column: unquote(add[2]),
          after: after ? unquote(after[1]) : null,
          first: /\bFIRST\s*$/i.test(add[3]),
          head,
        };
      }
    }
    return { type: 'other-ddl', table, head };
  }

  m = new RegExp(String.raw`^CREATE\s+(?:UNIQUE\s+|FULLTEXT\s+|SPATIAL\s+)?INDEX\s+${IDENT}\s+ON\s+(${IDENT})`, 'i').exec(body);
  if (m) return { type: 'other-ddl', table: unquote(m[1]), head };
  m = new RegExp(String.raw`^DROP\s+INDEX\s+${IDENT}\s+ON\s+(${IDENT})`, 'i').exec(body);
  if (m) return { type: 'other-ddl', table: unquote(m[1]), head };

  if (/^(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(body)) return { type: 'data', head };
  if (/^(SELECT|SHOW)\b/i.test(body)) return { type: 'probe', head };
  if (/^SET\b/i.test(body)) return { type: 'session', head };
  return { type: 'unsupported', head, reason: 'statement type not modelled' };
}

export const STATEMENT_TYPES = ['create-table', 'add-column', 'other-ddl', 'data', 'probe', 'session', 'unsupported'];

/** Counts, create-set and add-column list of one copy's recorded statements. */
export function summarizeDiscovery(statements) {
  const counts = Object.fromEntries(STATEMENT_TYPES.map((t) => [t, 0]));
  const createSet = [];
  const addColumns = [];
  for (const st of statements) {
    counts[st.type] += 1;
    if (st.type === 'create-table' && !createSet.includes(st.table)) createSet.push(st.table);
    if (st.type === 'add-column') addColumns.push({ table: st.table, column: st.column, after: st.after });
  }
  return { total: statements.length, counts, createSet, addColumns };
}

/**
 * ADD COLUMN statements that position a column AFTER another column the same copy
 * only adds later. On a database that lacks both, MySQL rejects the first one
 * (ER_BAD_FIELD_ERROR) and every later step of the copy never runs.
 */
export function addColumnOrderProblems(statements) {
  const adds = statements.filter((st) => st.type === 'add-column');
  const problems = [];
  adds.forEach((st, index) => {
    if (!st.after) return;
    const later = adds.findIndex((o, j) => j > index && o.table === st.table && o.column === st.after);
    if (later !== -1) {
      problems.push(
        `${st.table}.${st.column} is added AFTER ${st.after}, but ${st.table}.${st.after} is only added later`,
      );
    }
  });
  return problems;
}

// ---------------------------------------------------------------------------------
// Snapshot comparison
// ---------------------------------------------------------------------------------

export const COLUMN_ATTRS = ['type', 'nullable', 'default', 'extra', 'charset', 'collation', 'generation'];
export const INDEX_ATTRS = ['unique', 'columns', 'type', 'visible'];
export const FK_ATTRS = ['columns', 'ref_table', 'ref_columns', 'on_delete', 'on_update'];
export const CHECK_ATTRS = ['clause', 'enforced'];

const j = (value) => JSON.stringify(value === undefined ? null : value);

function diffNamed(out, prefix, table, kind, attrs, refMap, copyMap) {
  for (const name of Object.keys(refMap).sort()) {
    if (!(name in copyMap)) out.push(`${prefix} ${kind}-missing ${table}.${name}`);
  }
  for (const name of Object.keys(copyMap).sort()) {
    if (!(name in refMap)) {
      out.push(`${prefix} ${kind}-extra ${table}.${name}`);
      continue;
    }
    for (const attr of attrs) {
      const a = j(refMap[name][attr]);
      const b = j(copyMap[name][attr]);
      if (a !== b) out.push(`${prefix} ${kind}-attr ${table}.${name} ${attr} ref=${a} copy=${b}`);
    }
  }
}

function diffTable(out, prefix, name, ref, copy) {
  for (const attr of ['engine', 'collation']) {
    if (j(ref[attr]) !== j(copy[attr])) {
      out.push(`${prefix} table-attr ${name} ${attr} ref=${j(ref[attr])} copy=${j(copy[attr])}`);
    }
  }
  const refCols = new Map(ref.columns.map((c) => [c.name, c]));
  const copyCols = new Map(copy.columns.map((c) => [c.name, c]));
  for (const c of ref.columns) {
    if (!copyCols.has(c.name)) out.push(`${prefix} column-missing ${name}.${c.name}`);
  }
  for (const c of copy.columns) {
    if (!refCols.has(c.name)) {
      out.push(`${prefix} column-extra ${name}.${c.name}`);
      continue;
    }
    const r = refCols.get(c.name);
    for (const attr of COLUMN_ATTRS) {
      if (j(r[attr]) !== j(c[attr])) {
        out.push(`${prefix} column-attr ${name}.${c.name} ${attr} ref=${j(r[attr])} copy=${j(c[attr])}`);
      }
    }
  }
  const refOrder = ref.columns.filter((c) => copyCols.has(c.name)).map((c) => c.name);
  const copyOrder = copy.columns.filter((c) => refCols.has(c.name)).map((c) => c.name);
  if (j(refOrder) !== j(copyOrder)) {
    out.push(`${prefix} column-order ${name} ref=${j(refOrder)} copy=${j(copyOrder)}`);
  }
  diffNamed(out, prefix, name, 'index', INDEX_ATTRS, ref.indexes, copy.indexes);
  diffNamed(out, prefix, name, 'fk', FK_ATTRS, ref.fks, copy.fks);
  diffNamed(out, prefix, name, 'check', CHECK_ATTRS, ref.checks, copy.checks);
}

/** Objects of one table that a comparison examines (table + columns + indexes + fks + checks). */
export function tableObjectCount(table) {
  return (
    1 +
    table.columns.length +
    Object.keys(table.indexes).length +
    Object.keys(table.fks).length +
    Object.keys(table.checks).length
  );
}

/**
 * Compares a copy's database with the reference database.
 *
 * referenceOnly: 'missing' reports a reference table the copy's database lacks as
 * table-missing (Node copies: the database started as schema.sql, so a lost table is
 * the copy's doing); 'ignore' only counts it (Laravel: a partial schema by design).
 * Returns the sorted difference keys plus the denominators of the comparison.
 */
export function diffSnapshots(ref, copy, { prefix, referenceOnly }) {
  if (referenceOnly !== 'missing' && referenceOnly !== 'ignore') {
    throw new Error(`diffSnapshots: referenceOnly must be 'missing' or 'ignore'`);
  }
  const out = [];
  const shared = [];
  const referenceOnlyTables = [];
  for (const name of Object.keys(ref.tables).sort()) {
    if (name in copy.tables) {
      shared.push(name);
    } else {
      referenceOnlyTables.push(name);
      if (referenceOnly === 'missing') out.push(`${prefix} table-missing ${name}`);
    }
  }
  const copyOnlyTables = Object.keys(copy.tables)
    .filter((name) => !(name in ref.tables))
    .sort();
  for (const name of copyOnlyTables) {
    out.push(`${prefix} table-extra ${name}(${copy.tables[name].columns.map((c) => c.name).join(',')})`);
  }
  let objects = 0;
  let columns = 0;
  let indexes = 0;
  let fks = 0;
  for (const name of shared) {
    diffTable(out, prefix, name, ref.tables[name], copy.tables[name]);
    const t = ref.tables[name];
    objects += tableObjectCount(t);
    columns += t.columns.length;
    indexes += Object.keys(t.indexes).length;
    fks += Object.keys(t.fks).length;
  }
  return {
    differences: out.sort(),
    counts: { tables: shared.length, columns, indexes, fks, objects },
    referenceOnlyTables,
    copyOnlyTables,
  };
}

/**
 * Scope rule: a copy registered as complete must define every reference table.
 * Returns one table-not-defined key per reference table outside the copy's create-set.
 */
export function scopeDifferences({ prefix, complete, referenceTables, createSet }) {
  if (!complete) return [];
  return referenceTables
    .filter((t) => !createSet.includes(t))
    .sort()
    .map((t) => `${prefix} table-not-defined ${t}`);
}

// ---------------------------------------------------------------------------------
// Allow-list
// ---------------------------------------------------------------------------------

export const KEY_KINDS = [
  'table-not-defined',
  'table-missing',
  'table-extra',
  'table-attr',
  'column-missing',
  'column-extra',
  'column-attr',
  'column-order',
  'index-missing',
  'index-extra',
  'index-attr',
  'fk-missing',
  'fk-extra',
  'fk-attr',
  'check-missing',
  'check-extra',
  'check-attr',
  'apply-error',
];
const KEY_SHAPE = new RegExp(String.raw`^\S+/(noop|create|alter|migrate) (${KEY_KINDS.join('|')}) \S.*$`);

/** The kind of a difference key ("column-missing" etc.) or null. */
export function keyKind(key) {
  const m = KEY_SHAPE.exec(key);
  return m ? m[2] : null;
}

/**
 * Validates an allow-list document. Returns { entries, errors }; the check fails on
 * any error (an invalid list never counts as "all allowed").
 */
export function parseAllowlist(doc) {
  const errors = [];
  const entries = [];
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    return { entries, errors: ['the allow-list must be a JSON object'] };
  }
  for (const key of Object.keys(doc)) {
    if (key !== 'about' && key !== 'groups') errors.push(`unknown top-level field "${key}"`);
  }
  if (doc.about !== undefined && typeof doc.about !== 'string') errors.push('"about" must be a string');
  if (!Array.isArray(doc.groups)) {
    errors.push('"groups" must be an array');
    return { entries, errors };
  }
  const seen = new Set();
  doc.groups.forEach((group, gi) => {
    const where = `group ${gi + 1}`;
    if (group === null || typeof group !== 'object' || Array.isArray(group)) {
      errors.push(`${where}: must be an object with "reason" and "entries"`);
      return;
    }
    for (const key of Object.keys(group)) {
      if (key !== 'reason' && key !== 'entries') errors.push(`${where}: unknown field "${key}"`);
    }
    const reason = typeof group.reason === 'string' ? group.reason.trim() : '';
    if (reason.length < 20) errors.push(`${where}: "reason" must explain the difference (at least 20 characters)`);
    if (/^TODO\b/i.test(reason)) errors.push(`${where}: "reason" still starts with TODO`);
    if (!Array.isArray(group.entries) || group.entries.length === 0) {
      errors.push(`${where}: "entries" must be a non-empty array`);
      return;
    }
    for (const entry of group.entries) {
      if (typeof entry !== 'string' || keyKind(entry) === null) {
        errors.push(`${where}: not a difference key: ${JSON.stringify(entry)}`);
        continue;
      }
      if (keyKind(entry) === 'apply-error') {
        errors.push(`${where}: apply errors can never be allow-listed: ${entry}`);
        continue;
      }
      if (seen.has(entry)) {
        errors.push(`${where}: duplicate entry: ${entry}`);
        continue;
      }
      seen.add(entry);
      entries.push(entry);
    }
  });
  return { entries, errors };
}

/** Differences not in the allow-list (unexpected) and entries matching nothing (stale). */
export function evaluateAllowlist(differences, entries) {
  const diffSet = new Set(differences);
  const entrySet = new Set(entries);
  return {
    unexpected: [...diffSet].filter((d) => !entrySet.has(d)).sort(),
    stale: [...entrySet].filter((e) => !diffSet.has(e)).sort(),
    allowed: [...diffSet].filter((d) => entrySet.has(d)).length,
  };
}

/** Entries the current list has and the base list lacks. The list may only shrink. */
export function ratchetAdded(entries, baseEntries) {
  const base = new Set(baseEntries);
  return [...new Set(entries)].filter((e) => !base.has(e)).sort();
}

/** Entries of a base allow-list, read leniently (the base passed its own CI run). */
export function baseEntriesOf(doc) {
  if (!doc || !Array.isArray(doc.groups)) throw new Error('the base allow-list has no "groups" array');
  return doc.groups.flatMap((g) => (Array.isArray(g?.entries) ? g.entries.filter((e) => typeof e === 'string') : []));
}

/**
 * The ratchet's verdict from what the base commit has.
 * base = { hasAllowlist, hasCheck, doc } (doc: the parsed base allow-list, undefined if unreadable).
 *
 * Bootstrap: a base without the allow-list AND without the check is the commit before
 * the check was introduced, so there is nothing to ratchet against ("first-introduction").
 * A base that has the check but no allow-list is refused: deleting the list in one
 * change and re-adding it with more entries in the next must not reset the ratchet.
 */
export function ratchetVerdict(entries, base) {
  if (!base.hasAllowlist) {
    if (base.hasCheck) {
      return {
        status: 'refused',
        reason: 'the base commit has the drift check but no allow-list, so the list cannot be compared',
        added: [],
        baseCount: 0,
      };
    }
    return { status: 'first-introduction', added: [], baseCount: 0 };
  }
  let baseEntries;
  try {
    baseEntries = baseEntriesOf(base.doc);
  } catch (err) {
    return { status: 'refused', reason: `the base allow-list is unreadable: ${err.message}`, added: [], baseCount: 0 };
  }
  return { status: 'compared', added: ratchetAdded(entries, baseEntries), baseCount: new Set(baseEntries).size };
}

/** A groups skeleton for a new allow-list; every reason starts with TODO on purpose. */
export function candidateSkeleton(differences) {
  const groups = new Map();
  for (const d of differences) {
    const kind = keyKind(d);
    if (kind === 'apply-error') continue;
    const label = `${d.split(' ')[0]} ${kind}`;
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(d);
  }
  return {
    about:
      'Known differences between server/schema.sql and its copies (F-33). May only shrink: the check fails on a difference not listed here, on an entry that no longer matches a difference, and (with --ratchet) on an entry the base commit\'s copy of this file does not have.',
    groups: [...groups].map(([label, entries]) => ({ reason: `TODO: explain why ${label} is accepted`, entries })),
  };
}

// ---------------------------------------------------------------------------------
// Zero denominators
// ---------------------------------------------------------------------------------

/**
 * Reasons to refuse a clean verdict because something examined nothing.
 * summary = { reference: { tables, createStatements }, copies: [{ id, defines }],
 *             laravel: { tables } | null, comparedObjects, scan: { filesScanned } }
 */
export function zeroDenominatorRefusals(summary) {
  const out = [];
  const { reference, copies, laravel, comparedObjects, scan } = summary;
  if (!reference || reference.tables === 0) {
    out.push('the reference server/schema.sql produced 0 tables');
  } else if (reference.tables !== reference.createStatements) {
    out.push(
      `the reference did not load completely: ${reference.tables} tables for ${reference.createStatements} CREATE TABLE statements in the file`,
    );
  }
  for (const copy of copies) {
    if (copy.defines === 0) {
      out.push(`${copy.id} defines nothing (0 CREATE TABLE, 0 ADD COLUMN): discovery failed or the copy was emptied; update scripts/schema-drift/copies.mjs`);
    }
  }
  if (!laravel || laravel.tables === 0) {
    out.push('the Laravel migrations created 0 tables besides the migrations ledger');
  }
  if (!comparedObjects) out.push('0 schema objects were compared');
  if (!scan || scan.filesScanned === 0) out.push('the scan for unregistered schema copies read 0 files');
  return out;
}

// ---------------------------------------------------------------------------------
// Unregistered schema copies
// ---------------------------------------------------------------------------------

export const DDL_PATTERNS = [
  /\b(CREATE|ALTER|DROP|RENAME)\s+TABLE\b/g,
  /\bCREATE\s+(UNIQUE\s+)?INDEX\b/g,
  /Schema::(create|table|drop|dropIfExists|rename)\s*\(/g,
];

/** 1-based line numbers of every DDL match in a file's text. */
export function ddlLines(text) {
  const lines = new Set();
  for (const pattern of DDL_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags);
    let m;
    while ((m = re.exec(text)) !== null) {
      lines.add(text.slice(0, m.index).split('\n').length);
    }
  }
  return [...lines].sort((a, b) => a - b);
}

/**
 * Scans code files for schema definitions. files = [{ path, text }] with repository-
 * relative forward-slash paths; registry = { extensions, ignorePrefixes, registered:
 * [{ path } | { pattern }] }. A file with DDL that is not registered is a new,
 * unchecked schema copy; a registration that matches no file with DDL is stale.
 */
export function scanForSchemaCopies(files, registry) {
  const inScope = files.filter(
    (f) =>
      registry.extensions.some((ext) => f.path.endsWith(ext)) &&
      !registry.ignorePrefixes.some((prefix) => f.path.startsWith(prefix)),
  );
  const isRegistered = (p) =>
    registry.registered.some((r) => (r.path !== undefined ? r.path === p : r.pattern.test(p)));
  const withDdl = [];
  const unregistered = [];
  const unregisteredFiles = [];
  for (const f of inScope) {
    const lines = ddlLines(f.text);
    if (lines.length === 0) continue;
    withDdl.push(f.path);
    if (!isRegistered(f.path)) {
      unregisteredFiles.push(f.path);
      unregistered.push(...lines.map((line) => `${f.path}:${line}`));
    }
  }
  const staleRegistrations = registry.registered
    .filter((r) => !withDdl.some((p) => (r.path !== undefined ? r.path === p : r.pattern.test(p))))
    .map((r) => (r.path !== undefined ? r.path : String(r.pattern)));
  return {
    filesScanned: inScope.length,
    withDdl: withDdl.sort(),
    registeredWithDdl: withDdl.filter(isRegistered).length,
    unregistered,
    unregisteredFiles: unregisteredFiles.sort(),
    staleRegistrations,
  };
}
