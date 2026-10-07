// The dependency audit job in .github/workflows/ci.yml must stay blocking and must cover every
// lock file in the repository. scripts/ci/audit.mjs decides what is an open advisory; these tests
// check the job that runs it, so a `continue-on-error`, an `if:` that skips an audit step (for
// example on pull requests) or a lock file without an audit step cannot slip in unnoticed. The
// workflow is read line by line (no YAML dependency), like scripts/ci/check-workflows.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT } from './audit.mjs';

const WORKFLOW = join(REPO_ROOT, '.github', 'workflows', 'ci.yml');
const LOCK_FILES = { npm: 'package-lock.json', composer: 'composer.lock' };

/** Returns the lines of the `audit:` job (its header line included) with their 1-based numbers. */
function auditJobLines(text) {
  const lines = text.split(/\r?\n/);
  const jobs = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  if (jobs < 0) return [];
  const start = lines.findIndex((l, i) => i > jobs && /^ {2}audit:\s*$/.test(l));
  if (start < 0) return [];
  const out = [{ n: start + 1, line: lines[start] }];
  for (let i = start + 1; i < lines.length; i += 1) {
    // The job ends at the next job or top-level key (a comment line does not end it).
    if (/^ {0,2}\S/.test(lines[i]) && !lines[i].trimStart().startsWith('#')) break;
    out.push({ n: i + 1, line: lines[i] });
  }
  return out;
}

/**
 * The step conditions that never skip an audit step for a reason of their own: they only decide
 * whether it runs after an earlier step failed (`success()` is the default).
 */
const KEEPS_AUDITING = ['!cancelled()', 'always()', 'success()'];

/** The condition of an `if:` line without quotes, `${{ }}` and a trailing comment. */
function condition(text) {
  return text
    .replace(/\s+#.*$/, '')
    .trim()
    .replace(/^(['"])(.*)\1$/, '$2')
    .replace(/^\$\{\{\s*(.*?)\s*\}\}$/, '$1');
}

/** Problems that make the job non-blocking or let it, or one of its steps, be skipped. */
function blockingProblems(jobLines) {
  if (jobLines.length === 0) return ['no `audit:` job under `jobs:`'];
  const problems = [];
  for (const { n, line } of jobLines) {
    if (line.trimStart().startsWith('#')) continue;
    if (/^\s*(?:-\s+)?continue-on-error\s*:/.test(line)) problems.push(`line ${n}: continue-on-error makes the audit non-blocking`);
    if (/^ {4}if\s*:/.test(line)) {
      problems.push(`line ${n}: a job-level if can skip the audit`);
      continue;
    }
    // Any other `if:` in the job: a step's (`if:` or `- if:`), whatever its indentation.
    const m = /^\s*(?:-\s+)?if\s*:\s*(.*?)\s*$/.exec(line);
    if (m && !KEEPS_AUDITING.includes(condition(m[1]))) {
      problems.push(`line ${n}: a step's if (${m[1]}) can skip a lock file's audit; only ${KEEPS_AUDITING.join(', ')} may stand there`);
    }
  }
  return problems;
}

/** The `node scripts/ci/audit.mjs <tool> <dir>` steps of the job, as lock-file paths from the root. */
function auditedLockFiles(jobLines) {
  const out = [];
  for (const { line } of jobLines) {
    const m = /^\s*(?:-\s+)?run:\s*node scripts\/ci\/audit\.mjs (npm|composer) (\S+)\s*$/.exec(line);
    if (!m) continue;
    const dir = m[2].replace(/^\.\/?/, '').replace(/\/$/, '');
    out.push(dir ? `${dir}/${LOCK_FILES[m[1]]}` : LOCK_FILES[m[1]]);
  }
  return out;
}

/** Every npm or composer lock file that git tracks in this repository. */
function trackedLockFiles() {
  const r = spawnSync('git', ['ls-files', '-z'], { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error || r.status !== 0) {
    throw new Error(`git ls-files failed (${r.error?.message ?? `exit ${r.status}`}); the lock files cannot be listed`);
  }
  const names = new Set(Object.values(LOCK_FILES));
  return r.stdout.split('\0').filter((p) => names.has(p.split('/').pop())).sort();
}

test('the dependency audit job is blocking: no continue-on-error and no if that can skip an audit', () => {
  const job = auditJobLines(readFileSync(WORKFLOW, 'utf8'));
  console.log(`audit job: ${job.length} lines examined`);
  assert.ok(job.length > 1, 'the audit job was not found or is empty; refusing to report it blocking');
  assert.deepEqual(blockingProblems(job), []);
});

test('the dependency audit job runs one step per lock file in the repository', () => {
  const audited = auditedLockFiles(auditJobLines(readFileSync(WORKFLOW, 'utf8')));
  const tracked = trackedLockFiles();
  console.log(`lock files: ${tracked.length} tracked (${tracked.join(', ')}), ${audited.length} audit steps`);
  assert.ok(tracked.length > 0, 'no tracked lock file found; refusing to report the audit complete');
  assert.deepEqual([...audited].sort(), tracked, 'every lock file needs exactly one audit step, and every step a lock file');
});

test('the checks fire: continue-on-error, a job-level if, a missing job and a lock file without a step', () => {
  const workflow = [
    'name: CI',
    'jobs:',
    '  audit:',
    '    runs-on: ubuntu-24.04',
    '    # continue-on-error: true  (a comment is not a setting)',
    '    continue-on-error: true',
    "    if: github.event_name == 'push'",
    '    steps:',
    '      - name: npm',
    '        run: node scripts/ci/audit.mjs npm .',
    '      - name: composer',
    '        continue-on-error: true',
    '        run: node scripts/ci/audit.mjs composer api',
    '  other:',
    '    continue-on-error: true',
    '    runs-on: ubuntu-24.04',
  ].join('\n');
  const job = auditJobLines(workflow);
  assert.equal(job.length, 11, 'the job ends where the next job starts');
  assert.deepEqual(blockingProblems(job), [
    'line 6: continue-on-error makes the audit non-blocking',
    'line 7: a job-level if can skip the audit',
    'line 12: continue-on-error makes the audit non-blocking',
  ]);
  const audited = auditedLockFiles(job);
  assert.deepEqual(audited, ['package-lock.json', 'api/composer.lock']);
  assert.notDeepEqual(audited.sort(), ['api/composer.lock', 'package-lock.json', 'server/package-lock.json'], 'a missing step is seen');
  assert.deepEqual(blockingProblems(auditJobLines('name: CI\njobs:\n  client:\n    runs-on: x\n')), ['no `audit:` job under `jobs:`']);
});

test("the checks fire: a step's if that can skip an audit, and not the conditions that only follow a failed step", () => {
  const workflow = [
    'jobs:',
    '  audit:',
    '    runs-on: ubuntu-24.04',
    '    steps:',
    '      - name: npm (package-lock.json)',
    "        if: github.event_name == 'push'",
    '        run: node scripts/ci/audit.mjs npm .',
    "      - if: ${{ !cancelled() && github.event_name == 'push' }}",
    '        run: node scripts/ci/audit.mjs npm server',
    '      - name: composer',
    '        if: ${{ !cancelled() }}  # still runs after a failed audit step',
    '        run: node scripts/ci/audit.mjs composer api',
    '      - if: always()',
    '        run: node scripts/ci/audit.mjs npm tools',
    '      - name: quoted',
    '        if: "${{ success() }}"',
    '        run: node scripts/ci/audit.mjs npm docs',
    '      # if: false  (a comment is not a condition)',
    '      - name: never',
    '        if: false',
    '        run: node scripts/ci/audit.mjs npm site',
  ].join('\n');
  const job = auditJobLines(workflow);
  assert.equal(job.length, 20);
  const only = `only ${KEEPS_AUDITING.join(', ')} may stand there`;
  assert.deepEqual(blockingProblems(job), [
    `line 6: a step's if (github.event_name == 'push') can skip a lock file's audit; ${only}`,
    `line 8: a step's if (\${{ !cancelled() && github.event_name == 'push' }}) can skip a lock file's audit; ${only}`,
    `line 20: a step's if (false) can skip a lock file's audit; ${only}`,
  ]);
});
