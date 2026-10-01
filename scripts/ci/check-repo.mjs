#!/usr/bin/env node
/**
 * Repository checks: things no unit test of the app sees, checked over the files git tracks.
 *
 *   node scripts/ci/check-repo.mjs     exit 0 = no findings, 1 = findings, 2 = a check could not run
 *
 * Checks: ignore-rules (F-46), autostart and agent-permissions (F-24), secrets (F-35), log-mailer
 * (development mail goes to the local mail catcher, never to a log).
 *
 * Output: first one line with what the text checks could not read (`check-repo: tracked N,
 * text T, not scanned: binary B, missing M`, then each missing path as
 * `  not-scanned-missing<TAB>path`), then one report per check, then the total.
 *
 * Rules every check follows:
 *   - It reports how many items it examined and refuses a verdict when that number is zero:
 *     a check that saw nothing proves nothing.
 *   - A finding is printed as `<class><TAB><location>` only (`path:line`, or just the path for a
 *     path-level finding), never the matched text, so the output itself cannot leak what it found.
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
 * The text of a file, or null when it is binary. UTF-16 is recognised by its byte-order mark only
 * (Windows PowerShell 5.1 writes UTF-16LE with a BOM by default), never guessed. Everything else
 * is read as UTF-8 unless a NUL byte appears in the first 8000 bytes, the same test git uses; a
 * decoded UTF-16 text is held to the same test over the same window (4000 code units).
 */
export function decodeText(buf) {
  let text;
  if (buf[0] === 0xff && buf[1] === 0xfe) {
    text = buf.subarray(2).toString('utf16le');
  } else if (buf[0] === 0xfe && buf[1] === 0xff) {
    text = new TextDecoder('utf-16be').decode(buf.subarray(2));
  } else {
    return buf.subarray(0, 8000).includes(0) ? null : buf.toString('utf8');
  }
  return text.slice(0, 4000).includes('\0') ? null : text;
}

/**
 * Tracked text files with their content, plus the paths that were not read: `binary` (see
 * decodeText) and `missing` (not in the working tree, or not a readable file).
 */
export function readTracked(root = REPO_ROOT, paths = trackedFiles(root)) {
  const files = [];
  const binary = [];
  const missing = [];
  for (const p of paths) {
    let buf;
    try {
      buf = fs.readFileSync(path.join(root, p));
    } catch {
      missing.push(p);
      continue;
    }
    const text = decodeText(buf);
    if (text === null) binary.push(p);
    else files.push({ path: p, text });
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
 * What every check gets: the repository root, the tracked paths, the tracked text files, and the
 * tracked paths that were not read (`binary`, `missing`). Built once per run; tests build their
 * own with planted files.
 */
export function repoContext(root = REPO_ROOT) {
  const paths = trackedFiles(root);
  const { files, binary, missing } = readTracked(root, paths);
  return { root, paths, files, binary, missing };
}

/**
 * The denominator of the text checks: how many tracked files were read and how many were not.
 * Missing files are listed by path; binary ones are only counted (images and sounds).
 */
export function formatNotScanned(ctx) {
  return [
    `check-repo: tracked ${ctx.paths.length}, text ${ctx.files.length}, not scanned: binary ${ctx.binary.length}, missing ${ctx.missing.length}`,
    ...ctx.missing.map((p) => `  not-scanned-missing\t${p}`),
  ].join('\n');
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
  // A script the reader could not decode (another encoding, or real binary content) cannot be
  // scanned here, nor reviewed in a diff: it is a finding of its own.
  const notText = ctx.binary.filter((p) => SCRIPT_FILE.test(p)).map((p) => ({ cls: 'script-not-text', location: p }));
  return report('autostart', examined + notText.length, [...findings, ...notText]);
}

/**
 * Agent configuration in the repository: slash commands, sub-agents and skills in any `.claude`
 * directory (nested ones load too), and the shared settings.
 */
const AGENT_FILE = /(^|\/)\.claude\/(commands|agents|skills)\/.+\.md$/;
/** Commands and skills the model may run on its own unless `disable-model-invocation` is set. */
const MODEL_INVOCABLE_FILE = /(^|\/)\.claude\/(commands|skills)\//;
/** The spellings of a true `disable-model-invocation`. */
const MODEL_INVOCATION_OFF = /^(true|yes|on|1)$/i;
const AGENT_SETTINGS = '.claude/settings.json';

const SHELL_INTERPRETER = /^(powershell|pwsh|cmd|bash|sh|zsh|node|npm|npx|python3?)(\.exe)?(\s|:|$)/i;
const WRITE_TOOL = /^(Write|Edit|MultiEdit|NotebookEdit)$/;
/**
 * One permission rule: a tool name with an optional `(argument)`. MCP tools are
 * `mcp__<server>__<tool>` or `mcp__<server>__*`, and server names may contain hyphens.
 */
const RULE = /^(mcp__[A-Za-z0-9_-]+\*?|[A-Za-z0-9_]+)(?:\((.*)\))?$/;
/** A top-level frontmatter key (at column 0, optionally quoted) and its inline value. */
const FRONTMATTER_KEY = /^(["']?)([A-Za-z][A-Za-z0-9_-]*)\1:\s*(.*)$/;
const LIST_ITEM = /^\s*-\s*(.+)$/;

/**
 * Splits `A, B(x, y) C` on commas and on whitespace outside parentheses. Empty pieces are
 * dropped; quotes and brackets are left in place, so a form it does not understand stays visible.
 */
export function splitRules(value) {
  const rules = [];
  let depth = 0;
  let current = '';
  for (const ch of value) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (depth <= 0 && (ch === ',' || /\s/.test(ch))) {
      if (current !== '') rules.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current !== '') rules.push(current);
  return rules;
}

/** Removes one pair of surrounding quotes (`"…"` or `'…'`). */
function unquote(value) {
  const v = value.trim();
  return v.length >= 2 && (v[0] === '"' || v[0] === "'") && v.at(-1) === v[0] ? v.slice(1, -1).trim() : v;
}

/** Removes one pair of surrounding brackets (a YAML flow list). */
function unbracket(value) {
  const v = value.trim();
  return v.startsWith('[') && v.endsWith(']') ? v.slice(1, -1).trim() : v;
}

/**
 * Reads the frontmatter of an agent file: every `allowed-tools` rule with its line, and whether
 * model invocation is switched off. Returns null when the file has no closed frontmatter.
 *
 * It does not imitate YAML; it fails closed instead. The value loses one pair of quotes and one
 * pair of brackets and is split into rules; a block list contributes one rule per `- item`, and
 * any other line before the next key is split like the value. Whatever is left over that is not
 * a rule (a stray quote, a bracket, a comment, a block-scalar sign) becomes a token that
 * ruleClasses reports as `agent-unparsed-rule`, instead of disappearing.
 */
export function agentFrontmatter(lines) {
  if (lines[0]?.trim() !== '---') return null;
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (end < 0) return null;
  const rules = [];
  let modelInvocationOff = false;
  let inAllowed = false;
  for (let i = 1; i < end; i += 1) {
    const key = FRONTMATTER_KEY.exec(lines[i]);
    if (key) {
      const [, , name, value] = key;
      inAllowed = name === 'allowed-tools';
      if (inAllowed) {
        for (const token of splitRules(unbracket(unquote(value)))) rules.push({ rule: unquote(token), line: i + 1 });
      }
      if (name === 'disable-model-invocation') modelInvocationOff = MODEL_INVOCATION_OFF.test(value.trim());
      continue;
    }
    const text = lines[i].trim();
    if (!inAllowed || text === '' || text.startsWith('#')) continue;
    const item = LIST_ITEM.exec(lines[i]);
    if (item) {
      rules.push({ rule: unquote(item[1]), line: i + 1 });
    } else {
      for (const token of splitRules(text)) rules.push({ rule: unquote(token), line: i + 1 });
    }
  }
  return { rules, modelInvocationOff };
}

/**
 * Finding classes for one permission rule such as `Bash(curl:*)` or `Write`. Anything that is not
 * a rule is `agent-unparsed-rule`: a check must not pass over a grant it cannot read.
 */
export function ruleClasses(rule) {
  const m = typeof rule === 'string' ? RULE.exec(rule.trim()) : null;
  if (!m) return ['agent-unparsed-rule'];
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
 * Pre-approved tools of agent commands, sub-agents, skills and shared settings: only exact,
 * read-only shell commands, no write access without a path, no rule the check cannot read, and no
 * command or skill with pre-approved tools that the model may run on its own.
 * Returns findings and the number of files plus rules examined.
 */
export function scanAgentPermissions(files) {
  const findings = [];
  let examined = 0;
  for (const file of files) {
    const lines = file.text.split(/\r?\n/);
    if (AGENT_FILE.test(file.path)) {
      examined += 1;
      const fm = agentFrontmatter(lines);
      if (!fm || fm.rules.length === 0) continue;
      for (const { rule, line } of fm.rules) {
        examined += 1;
        for (const cls of ruleClasses(rule)) findings.push({ cls, location: `${file.path}:${line}` });
      }
      if (MODEL_INVOCABLE_FILE.test(file.path) && !fm.modelInvocationOff) {
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
  // `image:tag@sha256:<digest>` (docker:// actions, pinned images) has the same shape as user:password@host;
  // a digest is never a host, so it does not count.
  { cls: 'url-embedded-credentials', re: /[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/\s:@'"]+:[^/\s@'"]+@(?!sha256:)/ },
];

export function checkSecrets(ctx) {
  const { findings, examined } = scanLines(ctx.files, SECRET_CLASSES);
  return report('secrets', examined, findings);
}

/* ------------------------------------------------------------------------------ dev mail */

/**
 * No tracked config may select Laravel's log mailer, as a value or as a default: mails carry 2FA and
 * reset codes. (A failover chain with 'log' is covered by api/tests/Unit/MailConfigTest.php.)
 */
export const LOG_MAILER_CLASSES = [
  { cls: 'log-mailer', re: /\bMAIL_MAILER\b["']?\s*[:=]\s*["']?log\b/ },
  { cls: 'log-mailer-default', re: /MAIL_MAILER\s*:-\s*log\b|env\(\s*['"]MAIL_MAILER['"]\s*,\s*['"]log['"]\s*\)/ },
];

export function checkLogMailer(ctx) {
  const { findings, examined } = scanLines(ctx.files, LOG_MAILER_CLASSES);
  return report('log-mailer', examined, findings);
}

/* ------------------------------------------------------------------------------ checks */

/** The checks the CLI runs, in order. Each takes a context and returns report(...). */
export const CHECKS = [checkIgnoreRules, checkAutostart, checkAgentPermissions, checkSecrets, checkLogMailer];

export function formatReport(r) {
  const head = `${r.check}\texamined ${r.examined}\tfindings ${r.findings.length}`;
  return [head, ...r.findings.map((f) => `  ${f.cls}\t${f.location}`)].join('\n');
}

/** Runs every check over `root`. `log` and `error` receive the output (tests capture it). */
export function main(root = REPO_ROOT, { log = console.log, error = console.error } = {}) {
  if (CHECKS.length === 0) {
    error('check-repo: no checks registered - refusing to report a verdict');
    return 2;
  }
  let failed = 0;
  let ctx;
  try {
    ctx = repoContext(root);
  } catch (err) {
    error(`check-repo: cannot read the repository: ${err.message}`);
    return 2;
  }
  log(formatNotScanned(ctx));
  for (const check of CHECKS) {
    let r;
    try {
      r = check(ctx);
    } catch (err) {
      error(`check-repo: ${err.message}`);
      return 2;
    }
    log(formatReport(r));
    failed += r.findings.length;
  }
  log(`check-repo: ${CHECKS.length} checks, ${failed} findings`);
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
