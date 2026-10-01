#!/usr/bin/env node
/**
 * Repository checks: things no unit test of the app sees, checked over the files git tracks.
 *
 *   node scripts/ci/check-repo.mjs     exit 0 = no findings, 1 = findings, 2 = a check could not run
 *
 * Rules every check follows:
 *   - It reports how many items it examined and refuses a verdict when that number is zero:
 *     a check that saw nothing proves nothing.
 *   - A finding is printed as `<class><TAB><path>:<line>` only, never the matched text, so the
 *     output itself cannot leak what it found.
 *   - There is no allow-list. A false positive is fixed by rewording the file, not by exempting
 *     a path.
 *
 * Tests: scripts/ci/check-repo.test.mjs (run with the other tooling tests,
 * `node --test "scripts/ci/*.test.mjs"`).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** One check's result. Throws instead of returning a verdict over zero items. */
export function report(check, examined, findings) {
  if (!Number.isInteger(examined) || examined <= 0) {
    throw new Error(`${check}: examined ${examined} items - refusing to report a verdict`);
  }
  return { check, examined, findings };
}

/** Paths of all tracked files (index), relative to the repository root, with forward slashes. */
export function trackedFiles(root = REPO_ROOT) {
  const out = execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return out.split('\0').filter(Boolean);
}

/**
 * Tracked text files with their content. Binary files (a NUL byte in the first 8000 bytes, the
 * same test git uses) are counted but not read; files missing from the working tree are counted
 * as missing.
 */
export function readTracked(root = REPO_ROOT, paths = trackedFiles(root)) {
  const files = [];
  let binary = 0;
  let missing = 0;
  for (const p of paths) {
    let buf;
    try {
      buf = fs.readFileSync(path.join(root, p));
    } catch {
      missing += 1;
      continue;
    }
    if (buf.subarray(0, 8000).includes(0)) {
      binary += 1;
      continue;
    }
    files.push({ path: p, text: buf.toString('utf8') });
  }
  return { files, binary, missing };
}

/**
 * Line scanner shared by the text checks. `classes` = [{ cls, re, applies? }]; `applies(path)`
 * limits a class to some files. Returns the findings and the number of files at least one class
 * applied to (the denominator).
 */
export function scanLines(files, classes) {
  const findings = [];
  let examined = 0;
  for (const file of files) {
    const active = classes.filter((c) => !c.applies || c.applies(file.path));
    if (active.length === 0) continue;
    examined += 1;
    file.text.split(/\r?\n/).forEach((line, i) => {
      for (const c of active) {
        if (c.re.test(line)) findings.push({ cls: c.cls, location: `${file.path}:${i + 1}` });
      }
    });
  }
  return { findings, examined };
}

/**
 * What every check gets: the repository root, the tracked paths and the tracked text files.
 * Built once per run; tests build their own with planted files.
 */
export function repoContext(root = REPO_ROOT) {
  const paths = trackedFiles(root);
  const { files } = readTracked(root, paths);
  return { root, paths, files };
}

/* ------------------------------------------------------------------ ignore rules (F-46) */

/**
 * Sample paths the repository's own .gitignore files must ignore: env files with real settings,
 * database dumps, logs, and personal agent settings or nested worktrees. They need not exist.
 */
export const MUST_IGNORE = [
  '.env',
  'server/.env',
  'api/.env',
  'deploy/.env',
  'backup-2026-01-01.sql',
  'deploy/backup-2026-01-01.sql',
  'dump.sql.gz',
  'server.log',
  'server/logs/app.log',
  'logs/app.txt',
  '.claude/settings.local.json',
  '.claude/worktrees/some-worktree/file',
  'CLAUDE.local.md',
];

/** Sources and templates that no ignore rule may hide. */
export const MUST_NOT_IGNORE = [
  'server/schema.sql',
  '.env.example',
  'api/.env.example',
  'server/.env.example',
  'deploy/.env.example',
  'deploy/ci.env',
  '.claude/settings.json',
  '.claude/commands/wlan.md',
  'api/storage/logs/.gitignore',
];

/**
 * `git check-ignore` verdict per path: { path, source, line, pattern } with source '' when no rule
 * matches. --no-index: tracked paths are judged by the patterns too.
 */
export function ignoreVerdicts(root, paths) {
  const r = spawnSync('git', ['-C', root, 'check-ignore', '--no-index', '-v', '-n', '-z', '--stdin'], {
    input: `${paths.join('\0')}\0`,
    encoding: 'utf8',
  });
  // 0 = at least one path ignored, 1 = none; anything else is an error, not a verdict.
  if (r.status !== 0 && r.status !== 1) throw new Error(`ignore-rules: git check-ignore failed (exit ${r.status})`);
  const fields = r.stdout.split('\0');
  const verdicts = [];
  for (let i = 0; i + 3 < fields.length; i += 4) {
    verdicts.push({ source: fields[i], line: fields[i + 1], pattern: fields[i + 2], path: fields[i + 3] });
  }
  if (verdicts.length !== paths.length) {
    throw new Error(`ignore-rules: ${verdicts.length} verdicts for ${paths.length} paths`);
  }
  return verdicts;
}

/** Tracked files that a tracked .gitignore matches (clone-local excludes do not count). */
export function ignoredTrackedFiles(root) {
  const out = execFileSync('git', ['-C', root, 'ls-files', '-z', '-c', '-i', '--exclude-per-directory=.gitignore'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.split('\0').filter(Boolean);
}

/**
 * Findings from the verdicts. A path counts as ignored by the repository only when the rule comes
 * from a tracked .gitignore and is not a negation: a clone-local .git/info/exclude or a global
 * excludes file must never make this check pass.
 */
export function ignoreFindings({ mustIgnore, mustNotIgnore, verdicts, tracked, ignoredTracked }) {
  const trackedSet = new Set(tracked);
  const byPath = new Map(verdicts.map((v) => [v.path, v]));
  const ignoredByRepo = (p) => {
    const v = byPath.get(p);
    return Boolean(
      v &&
        v.source !== '' &&
        trackedSet.has(v.source) &&
        path.posix.basename(v.source) === '.gitignore' &&
        !v.pattern.startsWith('!'),
    );
  };
  const findings = [];
  for (const p of mustIgnore) {
    if (!ignoredByRepo(p)) findings.push({ cls: 'gitignore-gap', location: p });
  }
  for (const p of mustNotIgnore) {
    if (ignoredByRepo(p)) findings.push({ cls: 'gitignore-hides-source', location: p });
  }
  for (const p of ignoredTracked) findings.push({ cls: 'tracked-file-ignored', location: p });
  return findings;
}

export function checkIgnoreRules(ctx) {
  const samples = [...MUST_IGNORE, ...MUST_NOT_IGNORE];
  const findings = ignoreFindings({
    mustIgnore: MUST_IGNORE,
    mustNotIgnore: MUST_NOT_IGNORE,
    verdicts: ignoreVerdicts(ctx.root, samples),
    tracked: ctx.paths,
    ignoredTracked: ignoredTrackedFiles(ctx.root),
  });
  return report('ignore-rules', samples.length + ctx.paths.length, findings);
}

/* ------------------------------------------------------------------------------ checks */

/** The checks the CLI runs, in order. Each takes a context and returns report(...). */
export const CHECKS = [checkIgnoreRules];

export function formatReport(r) {
  const head = `${r.check}\texamined ${r.examined}\tfindings ${r.findings.length}`;
  return [head, ...r.findings.map((f) => `  ${f.cls}\t${f.location}`)].join('\n');
}

export function main(root = REPO_ROOT) {
  if (CHECKS.length === 0) {
    console.error('check-repo: no checks registered - refusing to report a verdict');
    return 2;
  }
  let failed = 0;
  let ctx;
  try {
    ctx = repoContext(root);
  } catch (err) {
    console.error(`check-repo: cannot read the repository: ${err.message}`);
    return 2;
  }
  for (const check of CHECKS) {
    let r;
    try {
      r = check(ctx);
    } catch (err) {
      console.error(`check-repo: ${err.message}`);
      return 2;
    }
    console.log(formatReport(r));
    failed += r.findings.length;
  }
  console.log(`check-repo: ${CHECKS.length} checks, ${failed} findings`);
  return failed === 0 ? 0 : 1;
}

function isCli() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isCli()) process.exitCode = main();
