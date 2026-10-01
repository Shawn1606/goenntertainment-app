#!/usr/bin/env node
// Dependency audit with a denominator and one reviewed allow-list.
//
//   node scripts/ci/audit.mjs npm .           # root package-lock.json
//   node scripts/ci/audit.mjs npm server      # server/package-lock.json
//   node scripts/ci/audit.mjs composer api    # api/composer.lock
//   ... [--allowlist <file>]                  # default .github/audit-allowlist.json
//
// It reads the lock file only (npm `--package-lock-only`, composer `--locked`), so no
// install is needed. The exit codes of npm and composer are ignored (both exit non-zero
// when they find something); their JSON output is the source of truth.
//
// Rules:
// - it prints how many packages it examined and refuses to report clean on zero;
// - every advisory must be in the allow-list section for that lock file, with a reason;
// - an allow-list entry that no longer matches an advisory fails too (the list may only shrink);
// - composer's own `config.audit.ignore` is refused: the allow-list is the only place to accept one.
//
// Exit codes: 0 = clean or everything allow-listed, 1 = open advisories or allow-list problems,
// 2 = the audit could not run (no JSON, registry error, bad arguments).
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_ALLOWLIST = join(REPO_ROOT, '.github', 'audit-allowlist.json');

function ghsaFrom(text) {
  const m = /GHSA(?:-[0-9a-z]{4}){3}/i.exec(String(text ?? ''));
  return m ? m[0] : null;
}

function addAdvisory(map, id, info) {
  const known = map.get(id);
  if (known) {
    if (!known.pkg.split(', ').includes(info.pkg)) known.pkg += `, ${info.pkg}`;
  } else {
    map.set(id, { ...info });
  }
}

/** Parses `npm audit --json` (report version 2). */
export function parseNpmAudit(report) {
  if (!report || typeof report !== 'object') return { error: 'npm audit printed no JSON object' };
  if (report.error) {
    const e = report.error;
    return { error: `npm audit failed: ${e.code ?? ''} ${e.summary ?? e.message ?? ''}`.trim() };
  }
  const total = report.metadata?.dependencies?.total;
  if (!Number.isInteger(total)) return { error: 'npm audit JSON has no metadata.dependencies.total' };
  const advisories = new Map();
  for (const vuln of Object.values(report.vulnerabilities ?? {})) {
    for (const via of vuln.via ?? []) {
      // A string entry only points at another vulnerable package (a transitive path);
      // the advisory itself is listed under that package.
      if (typeof via !== 'object' || via === null) continue;
      const id = ghsaFrom(via.url) ?? `npm-${via.source}`;
      addAdvisory(advisories, id, { pkg: via.name ?? vuln.name, severity: via.severity ?? vuln.severity ?? '?', title: via.title ?? '' });
    }
  }
  return { examined: total, advisories };
}

/** Counts the packages in composer.lock (runtime and dev). */
export function countComposerLock(lock) {
  const prod = Array.isArray(lock?.packages) ? lock.packages.length : 0;
  const dev = Array.isArray(lock?.['packages-dev']) ? lock['packages-dev'].length : 0;
  return prod + dev;
}

/** Parses `composer audit --locked --format=json`. */
export function parseComposerAudit(report, lock) {
  if (!report || typeof report !== 'object') return { error: 'composer audit printed no JSON object' };
  if (!('advisories' in report)) return { error: 'composer audit JSON has no "advisories" key' };
  const advisories = new Map();
  const byPackage = Array.isArray(report.advisories) ? {} : report.advisories ?? {};
  for (const [pkg, list] of Object.entries(byPackage)) {
    const entries = Array.isArray(list) ? list : Object.values(list ?? {});
    for (const a of entries) {
      const fromSources = (a.sources ?? []).map((s) => ghsaFrom(s.remoteId)).find(Boolean);
      const id = fromSources ?? ghsaFrom(a.link) ?? a.advisoryId ?? `composer-${pkg}-${a.cve ?? 'unknown'}`;
      addAdvisory(advisories, id, { pkg: a.packageName ?? pkg, severity: a.severity ?? '?', title: a.title ?? '' });
    }
  }
  const abandoned = Array.isArray(report.abandoned) ? {} : report.abandoned ?? {};
  for (const [pkg, replacement] of Object.entries(abandoned)) {
    addAdvisory(advisories, `abandoned:${pkg}`, {
      pkg,
      severity: 'abandoned',
      title: replacement ? `abandoned; use ${replacement}` : 'abandoned, no replacement suggested',
    });
  }
  return { examined: countComposerLock(lock), advisories };
}

/** composer.json may carry its own ignore list; it would bypass the reviewed allow-list. */
export function composerIgnoreProblem(composerJson) {
  const ignore = composerJson?.config?.audit?.ignore;
  const size = Array.isArray(ignore) ? ignore.length : ignore && typeof ignore === 'object' ? Object.keys(ignore).length : 0;
  return size > 0
    ? `composer.json config.audit.ignore lists ${size} advisories; move them to .github/audit-allowlist.json with a reason`
    : null;
}

/** Compares the advisories with the allow-list section. */
export function evaluate({ examined, advisories, allow }) {
  const problems = [];
  if (!(examined > 0)) problems.push(`${examined ?? 0} packages examined; refusing to report clean`);
  let allowListed = 0;
  for (const [id, a] of [...advisories].sort(([x], [y]) => x.localeCompare(y))) {
    if (Object.hasOwn(allow, id)) {
      allowListed += 1;
      if (typeof allow[id] !== 'string' || allow[id].trim() === '') {
        problems.push(`allow-list entry ${id} has no reason`);
      }
    } else {
      problems.push(`${id} ${a.pkg} (${a.severity}): ${a.title}`);
    }
  }
  for (const id of Object.keys(allow).sort()) {
    if (!advisories.has(id)) problems.push(`stale allow-list entry ${id}: no longer reported; remove it (the list may only shrink)`);
  }
  return { problems, allowListed, open: advisories.size - allowListed };
}

export function loadAllowSection(file, section) {
  if (!existsSync(file)) return { error: `allow-list ${file} not found` };
  let data;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    return { error: `allow-list ${file} is not valid JSON (${err.message})` };
  }
  const allow = data?.[section];
  if (!allow || typeof allow !== 'object' || Array.isArray(allow)) {
    return { error: `allow-list ${file} has no section "${section}"; add one (an empty object is fine)` };
  }
  return { allow };
}

function runTool(cmd, args, cwd) {
  // Windows ships npm and composer as .cmd/.bat wrappers, which need a shell there; the
  // command line is then one string. The arguments are fixed strings in this file, never
  // user input. Elsewhere no shell is involved.
  const options = { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 };
  const r = process.platform === 'win32'
    ? spawnSync([cmd, ...args].join(' '), { ...options, shell: true })
    : spawnSync(cmd, args, options);
  if (r.error) return { error: `${cmd} could not start: ${r.error.message}` };
  const out = (r.stdout ?? '').trim();
  if (!out) return { error: `${cmd} ${args.join(' ')} printed nothing (exit ${r.status}); stderr: ${(r.stderr ?? '').trim().slice(0, 500)}` };
  try {
    return { json: JSON.parse(out) };
  } catch {
    return { error: `${cmd} ${args.join(' ')} did not print JSON (exit ${r.status})` };
  }
}

export function audit(tool, dir, { allowlist = DEFAULT_ALLOWLIST, root = REPO_ROOT } = {}) {
  const abs = resolve(root, dir);
  const rel = relative(root, abs).split('\\').join('/') || '.';
  const label = `${tool} ${rel}`;
  const section = `${tool}:${rel}`;
  const loaded = loadAllowSection(allowlist, section);
  if (loaded.error) return { code: 2, lines: [`${label}: ${loaded.error}`] };

  let parsed;
  const extra = [];
  if (tool === 'npm') {
    if (!existsSync(join(abs, 'package-lock.json'))) return { code: 2, lines: [`${label}: no package-lock.json`] };
    const r = runTool('npm', ['audit', '--json', '--package-lock-only'], abs);
    parsed = r.error ? r : parseNpmAudit(r.json);
  } else if (tool === 'composer') {
    const lockFile = join(abs, 'composer.lock');
    if (!existsSync(lockFile)) return { code: 2, lines: [`${label}: no composer.lock`] };
    let manifest;
    let lock;
    try {
      manifest = JSON.parse(readFileSync(join(abs, 'composer.json'), 'utf8'));
      lock = JSON.parse(readFileSync(lockFile, 'utf8'));
    } catch (err) {
      return { code: 2, lines: [`${label}: cannot read composer.json or composer.lock (${err.message})`] };
    }
    const ignore = composerIgnoreProblem(manifest);
    if (ignore) extra.push(ignore);
    const r = runTool('composer', ['audit', '--locked', '--format=json', '--no-interaction'], abs);
    parsed = r.error ? r : parseComposerAudit(r.json, lock);
  } else {
    return { code: 2, lines: ['usage: node scripts/ci/audit.mjs npm|composer <dir> [--allowlist <file>]'] };
  }
  if (parsed.error) return { code: 2, lines: [`${label}: ${parsed.error}`] };

  const result = evaluate({ examined: parsed.examined, advisories: parsed.advisories, allow: loaded.allow });
  const problems = [...extra, ...result.problems];
  const lines = [
    `${label}: examined ${parsed.examined} packages, ${parsed.advisories.size} advisories (${result.allowListed} allow-listed, ${result.open} open)`,
    ...problems.map((p) => `  - ${p}`),
    problems.length ? `FAIL: ${problems.length} problem(s)` : 'OK',
  ];
  return { code: problems.length ? 1 : 0, lines };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--allowlist');
  const allowlist = at >= 0 ? resolve(args[at + 1] ?? '') : DEFAULT_ALLOWLIST;
  if (at >= 0) args.splice(at, 2);
  const [tool, dir] = args;
  const r = tool && dir ? audit(tool, dir, { allowlist }) : { code: 2, lines: ['usage: node scripts/ci/audit.mjs npm|composer <dir> [--allowlist <file>]'] };
  console.log(r.lines.join('\n'));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `- ${r.lines[0]}${r.code ? ` - exit ${r.code}` : ''}\n`);
  process.exit(r.code);
}
