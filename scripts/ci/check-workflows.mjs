#!/usr/bin/env node
// Workflow policy check (F-27, F-26). actionlint checks syntax, expressions and the
// shell scripts; this checks the repository's own rules for .github/workflows:
//   1. a top-level `permissions:` block in every workflow, and no write permission anywhere;
//   2. every remote action pinned by a full 40-hex commit SHA followed by a version comment
//      (`@<sha> # v1.2.3`), so people and Dependabot can read it; `docker://` actions need an
//      `@sha256:` digest; local `./` actions are fine;
//   3. no `pull_request_target` trigger (it runs with a write token and the repository's secrets);
//   4. every job sets `timeout-minutes`;
//   5. no literal value for a secret-looking name (…PASSWORD, …PWD, …SECRET, …TOKEN, …_KEY) unless it
//      is empty, an expression, or visibly fake (contains "not-a-secret");
//   6. every actions/checkout step sets `persist-credentials: false` (no token left in .git/config);
//   7. zero workflow files is a failure, not a pass.
// With `--ci-env <file>` rule 5 also applies to every KEY=VALUE line of that env file, which
// must be labelled ci-only in its header.
//
// The parser is line-based on purpose (no dependency) and fails closed: a `uses:` it cannot
// read is a problem. Contents of block scalars (`run: |`, `options: >-`) are not YAML and are
// skipped, so a credential typed into a shell command is not caught here: keep credentials in
// `env:` keys, where rule 5 sees them.
//
//   node scripts/ci/check-workflows.mjs [dir=.github/workflows] [--ci-env deploy/ci.env]
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const MARKER = 'not-a-secret';
const SECRET_NAME = /^([A-Za-z0-9_-]*(?:password|passwd|[_-]pwd|secret|token|[_-]key))$/i;
const SHA_REF = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_./-]+)?@[0-9a-f]{40}$/;
const VERSION_COMMENT = /^v?\d+(?:\.\d+)*\S*$/;
const LOCAL_REF = /^\.\/\S+$/;
const DOCKER_REF = /^docker:\/\/\S+@sha256:[0-9a-f]{64}$/;

const indentOf = (line) => line.length - line.trimStart().length;

/** Reads a YAML scalar after `key:`; returns its value without quotes and trailing comment. */
export function scalarValue(rest) {
  const s = rest.trim();
  if (s.startsWith('"') || s.startsWith("'")) {
    const q = s[0];
    let out = '';
    for (let i = 1; i < s.length; i += 1) {
      if (s[i] === q) {
        if (q === "'" && s[i + 1] === "'") { out += "'"; i += 1; continue; }
        return { value: out, quoted: true };
      }
      if (q === '"' && s[i] === '\\') { out += s[i + 1] ?? ''; i += 1; continue; }
      out += s[i];
    }
    return { value: out, quoted: true, unterminated: true };
  }
  const m = /(^|\s)#/.exec(s);
  return { value: (m ? s.slice(0, m.index) : s).trim(), quoted: false };
}

/** A value is acceptable for a secret-looking name if it is empty, an expression, or marked fake. */
export function isAcceptableSecretValue(value) {
  const v = value.trim();
  if (v === '') return true;
  if (/^\$\{\{[^}]*\}\}$/.test(v)) return true;
  return v.includes(MARKER);
}

/**
 * Marks the lines that are YAML structure (not comments, not block-scalar content).
 * Returns an array of { i, line } for those lines.
 */
function structuralLines(lines) {
  const out = [];
  let scalarIndent = -1; // >= 0 while inside a block scalar started on a line with this indent
  lines.forEach((line, i) => {
    if (scalarIndent >= 0) {
      if (line.trim() === '' || indentOf(line) > scalarIndent) return;
      scalarIndent = -1;
    }
    if (line.trim() === '' || line.trimStart().startsWith('#')) return;
    out.push({ i, line });
    const kv = /^\s*(?:-\s+)?[^\s#][^:]*:\s+(.*)$/.exec(line);
    if (kv && /^[|>][-+0-9]*$/.test(scalarValue(kv[1]).value)) scalarIndent = indentOf(line);
  });
  return out;
}

export function checkWorkflow(name, text) {
  const problems = [];
  const lines = String(text).split(/\r?\n/);
  const code = structuralLines(lines);
  let uses = 0;

  // Rule 1: top-level permissions, and no write access anywhere.
  if (!code.some(({ line }) => /^permissions:/.test(line))) problems.push(`${name}: no top-level permissions block`);
  code.forEach(({ i, line }, k) => {
    const m = /^(\s*)permissions:\s*(.*)$/.exec(line);
    if (!m) return;
    const value = scalarValue(m[2]).value;
    if (/\bwrite(-all)?\b/.test(value)) problems.push(`${name}:${i + 1}: write permission (${value})`);
    if (value !== '') return;
    for (const next of code.slice(k + 1)) {
      if (indentOf(next.line) <= m[1].length) break;
      const scope = /^\s*([\w-]+):\s*(.*)$/.exec(next.line);
      if (scope && scalarValue(scope[2]).value === 'write') problems.push(`${name}:${next.i + 1}: write permission (${scope[1]}: write)`);
    }
  });

  // Rule 3: no pull_request_target anywhere in the YAML structure.
  if (code.some(({ line }) => /\bpull_request_target\b/.test(scalarValue(line).value))) {
    problems.push(`${name}: pull_request_target is not allowed`);
  }

  // Rule 4: jobs are the keys indented by two spaces under `jobs:`.
  const jobsAt = code.findIndex(({ line }) => /^jobs:\s*$/.test(scalarValue(line).value));
  const jobs = [];
  if (jobsAt < 0) {
    problems.push(`${name}: no jobs: block found`);
  } else {
    for (const { line } of code.slice(jobsAt + 1)) {
      if (indentOf(line) === 0) break;
      const job = /^ {2}([\w-]+):\s*(?:#.*)?$/.exec(line);
      if (job) jobs.push({ id: job[1], body: [] });
      else if (jobs.length) jobs[jobs.length - 1].body.push(line);
    }
    if (jobs.length === 0) problems.push(`${name}: no jobs found under jobs: (expected two-space indentation)`);
  }
  for (const job of jobs) {
    if (!job.body.some((l) => /^ {4}timeout-minutes:\s*\S/.test(l))) problems.push(`${name}: job "${job.id}" has no timeout-minutes`);
  }

  code.forEach(({ i, line }, k) => {
    // Rule 2: action pins. Any structural line mentioning `uses:` must be a readable, pinned reference.
    if (/\buses:/.test(line)) {
      uses += 1;
      const m = /^\s*(?:-\s+)?uses:\s+(\S+)(?:\s+#\s*(\S.*?))?\s*$/.exec(line);
      const ref = m?.[1] ?? '';
      if (!m) {
        problems.push(`${name}:${i + 1}: cannot read this uses: line (write it as "uses: owner/repo@<sha> # vX.Y.Z"): ${line.trim()}`);
      } else if (SHA_REF.test(ref)) {
        if (!m[2] || !VERSION_COMMENT.test(m[2].trim())) problems.push(`${name}:${i + 1}: SHA pin without a version comment (# vX.Y.Z): ${ref}`);
      } else if (!LOCAL_REF.test(ref) && !DOCKER_REF.test(ref)) {
        problems.push(`${name}:${i + 1}: action not pinned by commit SHA: ${ref}`);
      }
      // Rule 6: checkout must not keep the token in .git/config.
      if (/^actions\/checkout@/.test(ref)) {
        // The step starts at the nearest "- " item at a smaller indent (or on this line).
        let start = k;
        if (!/^\s*-\s/.test(line)) {
          start = k - 1;
          while (start >= 0 && !(/^\s*-\s/.test(code[start].line) && indentOf(code[start].line) < indentOf(line))) start -= 1;
        }
        let persists = false;
        if (start >= 0) {
          const stepIndent = indentOf(code[start].line);
          for (let j = start + 1; j < code.length; j += 1) {
            if (indentOf(code[j].line) <= stepIndent) break;
            const pc = /^\s*persist-credentials:\s*(.*)$/.exec(code[j].line);
            if (pc && scalarValue(pc[1]).value === 'false') persists = true;
          }
        }
        if (!persists) problems.push(`${name}:${i + 1}: actions/checkout without persist-credentials: false`);
      }
    }
    // Rule 5: secret-looking names with a literal value.
    const kv = /^\s*(?:-\s+)?([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (kv && SECRET_NAME.test(kv[1])) {
      const { value } = scalarValue(kv[2]);
      if (!isAcceptableSecretValue(value)) {
        problems.push(`${name}:${i + 1}: literal value for ${kv[1]} (use an expression, or a visibly fake value containing "${MARKER}")`);
      }
    }
  });
  return { jobs: jobs.length, uses, problems };
}

/** Rule 5 for a dotenv-style ci-only file, plus its label. */
export function checkCiEnv(name, text) {
  const problems = [];
  const lines = String(text).split(/\r?\n/);
  const header = lines.slice(0, 5).filter((l) => l.trimStart().startsWith('#')).join('\n');
  if (!/ci-only/i.test(header)) problems.push(`${name}: the first lines must label the file as CI-ONLY`);
  let settings = 0;
  lines.forEach((line, i) => {
    const t = line.trim();
    if (t === '' || t.startsWith('#')) return;
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(t);
    if (!m) {
      problems.push(`${name}:${i + 1}: cannot read this line as KEY=VALUE`);
      return;
    }
    settings += 1;
    const raw = m[2].trim();
    const value = /^(['"]).*\1$/.test(raw) ? raw.slice(1, -1) : raw;
    if (SECRET_NAME.test(m[1]) && !isAcceptableSecretValue(value)) {
      problems.push(`${name}:${i + 1}: literal value for ${m[1]} without the "${MARKER}" marker`);
    }
  });
  if (settings === 0) problems.push(`${name}: no settings found; refusing to report clean`);
  return { settings, problems };
}

export function checkDir(dir, { ciEnv } = {}) {
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).sort() : [];
  let jobs = 0;
  let uses = 0;
  const problems = [];
  for (const f of files) {
    const r = checkWorkflow(f, readFileSync(join(dir, f), 'utf8'));
    jobs += r.jobs;
    uses += r.uses;
    problems.push(...r.problems);
  }
  if (files.length === 0) problems.push(`${dir}: no workflow files found; refusing to report clean`);
  let envSettings = null;
  if (ciEnv) {
    if (!existsSync(ciEnv)) {
      problems.push(`${ciEnv}: not found`);
    } else {
      const r = checkCiEnv(basename(ciEnv), readFileSync(ciEnv, 'utf8'));
      envSettings = r.settings;
      problems.push(...r.problems);
    }
  }
  return { files: files.length, jobs, uses, envSettings, problems };
}

export function run(argv) {
  const args = [...argv];
  const at = args.indexOf('--ci-env');
  const ciEnv = at >= 0 ? args[at + 1] : undefined;
  if (at >= 0) args.splice(at, 2);
  const dir = args[0] ?? '.github/workflows';
  const r = checkDir(dir, { ciEnv });
  const lines = [
    `workflow policy: examined ${r.files} files, ${r.jobs} jobs, ${r.uses} uses: lines${r.envSettings === null ? '' : `, ${r.envSettings} settings in ${ciEnv}`}`,
    ...r.problems.map((p) => `  - ${p}`),
    r.problems.length ? `FAIL: ${r.problems.length} problem(s)` : 'OK',
  ];
  return { code: r.problems.length ? 1 : 0, lines };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const { code, lines } = run(process.argv.slice(2));
  console.log(lines.join('\n'));
  process.exit(code);
}
