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

/* ------------------------------------------------------- machine-specific tooling (F-24) */

/** Script files: the only place a logon autostart can be installed from. Docs may mention one. */
const SCRIPT_FILE = /\.(ps1|psm1|psd1|bat|cmd|vbs|sh)$/i;

export const AUTOSTART_CLASSES = [
  {
    cls: 'autostart-startup-folder',
    re: /GetFolderPath\(\s*['"]?(Common)?Startup|shell:(common )?startup|Start Menu\\Programs\\Startup/i,
  },
  { cls: 'autostart-run-key', re: /CurrentVersion\\Run(Once)?\b/i },
  { cls: 'autostart-scheduled-task', re: /\bschtasks(\.exe)?\s+\/create\b|\bRegister-ScheduledTask\b/i },
].map((c) => ({ ...c, applies: (p) => SCRIPT_FILE.test(p) }));

export function checkAutostart(ctx) {
  const { findings, examined } = scanLines(ctx.files, AUTOSTART_CLASSES);
  return report('autostart', examined, findings);
}

/** Agent configuration in the repository: slash commands, sub-agents, shared settings. */
const AGENT_FILE = /^\.claude\/(commands|agents)\/.+\.md$/;
const AGENT_SETTINGS = '.claude/settings.json';

const SHELL_INTERPRETER = /^(powershell|pwsh|cmd|bash|sh|zsh|node|npm|npx|python3?)(\.exe)?(\s|:|$)/i;
const WRITE_TOOL = /^(Write|Edit|MultiEdit|NotebookEdit)$/;

/** Splits `A, B(x, y), C` on commas outside parentheses. */
export function splitRules(value) {
  const rules = [];
  let depth = 0;
  let current = '';
  for (const ch of value) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      rules.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim() !== '') rules.push(current.trim());
  return rules;
}

/** Finding classes for one permission rule such as `Bash(curl:*)` or `Write`. */
export function ruleClasses(rule) {
  const m = /^([A-Za-z]+)(?:\((.*)\))?$/.exec(rule.trim());
  if (!m) return [];
  const [, tool, arg] = m;
  const classes = [];
  if (tool === 'Bash') {
    if (arg === undefined || arg.trim() === '' || arg.includes('*')) classes.push('agent-shell-wildcard');
    if (arg !== undefined && SHELL_INTERPRETER.test(arg.trim())) classes.push('agent-shell-interpreter');
  }
  if (WRITE_TOOL.test(tool) && (arg === undefined || arg.trim() === '' || arg.includes('*'))) {
    classes.push('agent-unscoped-write');
  }
  return classes;
}

/**
 * Pre-approved tools of agent commands and shared settings: only exact, read-only shell commands,
 * no write access without a path, and no command the model may run on its own.
 * Returns findings and the number of files plus rules examined.
 */
export function scanAgentPermissions(files) {
  const findings = [];
  let examined = 0;
  for (const file of files) {
    const lines = file.text.split(/\r?\n/);
    if (AGENT_FILE.test(file.path)) {
      examined += 1;
      if (lines[0]?.trim() !== '---') continue;
      const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
      if (end < 0) continue;
      let allowed = null;
      let modelInvocationOff = false;
      for (let i = 1; i < end; i += 1) {
        const m = /^([A-Za-z-]+):\s*(.*)$/.exec(lines[i]);
        if (!m) continue;
        if (m[1] === 'allowed-tools') allowed = { value: m[2], line: i + 1 };
        if (m[1] === 'disable-model-invocation' && m[2].trim() === 'true') modelInvocationOff = true;
      }
      if (!allowed || allowed.value.trim() === '') continue;
      for (const rule of splitRules(allowed.value)) {
        examined += 1;
        for (const cls of ruleClasses(rule)) findings.push({ cls, location: `${file.path}:${allowed.line}` });
      }
      if (file.path.startsWith('.claude/commands/') && !modelInvocationOff) {
        findings.push({ cls: 'agent-model-invocable', location: `${file.path}:1` });
      }
    } else if (file.path === AGENT_SETTINGS) {
      examined += 1;
      const allow = JSON.parse(file.text)?.permissions?.allow ?? [];
      for (const rule of allow) {
        examined += 1;
        const line = lines.findIndex((l) => l.includes(JSON.stringify(rule))) + 1;
        for (const cls of ruleClasses(rule)) findings.push({ cls, location: `${file.path}:${line}` });
      }
    }
  }
  return { findings, examined };
}

export function checkAgentPermissions(ctx) {
  const { findings, examined } = scanAgentPermissions(ctx.files);
  return report('agent-permissions', examined, findings);
}

/* ------------------------------------------------------------------------- secrets (F-35) */

const DOC_FILE = /\.(md|txt)$/i;
const EMAIL = '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}';

/**
 * Credential shapes that must never be in a tracked file. Deliberately narrow, so that every hit is
 * worth a look; broad "looks random" classes flood on lock files and fixtures. Not covered: a bare
 * password in prose without an address next to it.
 */
export const SECRET_CLASSES = [
  // An address, a slash, then the password: how a working login gets written down in notes.
  { cls: 'email-slash-password', re: new RegExp(`${EMAIL}\\s*\\/\\s*[^\\s/]{4,}`) },
  // An address, then a password label and a value - docs only; test fixtures legitimately pair them.
  {
    cls: 'email-password-label',
    re: new RegExp(`${EMAIL}.{0,40}\\b(passwor[dt]|kennwort|pw)\\b\\s*[:=]?\\s*\\S{4,}`, 'i'),
    applies: (p) => DOC_FILE.test(p),
  },
  { cls: 'private-key', re: /-----BEGIN ([A-Z0-9]+ )*PRIVATE KEY-----/ },
  { cls: 'anthropic-api-key', re: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { cls: 'github-token', re: /gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,}/ },
  { cls: 'aws-access-key-id', re: /(AKIA|ASIA)[0-9A-Z]{16}/ },
  { cls: 'stripe-live-key', re: /(sk|rk)_live_[A-Za-z0-9]{10,}/ },
  { cls: 'google-api-key', re: /AIza[0-9A-Za-z_-]{35}/ },
  { cls: 'slack-token', re: /xox[abprs]-[A-Za-z0-9-]{10,}/ },
  { cls: 'url-embedded-credentials', re: /[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/\s:@'"]+:[^/\s@'"]+@/ },
];

export function checkSecrets(ctx) {
  const { findings, examined } = scanLines(ctx.files, SECRET_CLASSES);
  return report('secrets', examined, findings);
}

/* ------------------------------------------------------------------------------ checks */

/** The checks the CLI runs, in order. Each takes a context and returns report(...). */
export const CHECKS = [checkIgnoreRules, checkAutostart, checkAgentPermissions, checkSecrets];

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
