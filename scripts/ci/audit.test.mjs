import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  REPO_ROOT,
  allowEntry,
  audit,
  composerIgnoreProblem,
  evaluate,
  loadAllowSection,
  parseComposerAudit,
  parseNpmAudit,
  runTool,
} from './audit.mjs';

// Shapes as printed by `npm audit --json` (report version 2) and `composer audit --format=json`.
// Package names and ids are made up for the fixtures.
const npmReport = {
  auditReportVersion: 2,
  vulnerabilities: {
    'fixture-lib': {
      name: 'fixture-lib',
      severity: 'moderate',
      isDirect: false,
      via: [
        { source: 1001, name: 'fixture-lib', title: 'Fixture prototype pollution', url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc', severity: 'moderate' },
        { source: 1002, name: 'fixture-lib', title: 'Fixture advisory without GHSA url', url: '', severity: 'low' },
      ],
      effects: ['fixture-parent'],
      nodes: ['node_modules/fixture-lib'],
    },
    'fixture-parent': {
      name: 'fixture-parent', severity: 'moderate', isDirect: true, via: ['fixture-lib'], effects: [], nodes: ['node_modules/fixture-parent'],
    },
  },
  metadata: { dependencies: { prod: 10, dev: 5, optional: 0, peer: 0, peerOptional: 0, total: 15 } },
};
/** Allow-list entries for both advisories of npmReport, with the dependent npm reports. */
const npmAllow = (reason = 'not reachable: fixture reason') => ({
  'GHSA-aaaa-bbbb-cccc': { reason, via: ['fixture-parent'] },
  'npm-1002': { reason: 'dev-only build tool, never shipped', via: ['fixture-parent'] },
});

test('npm: GHSA ids come from via[].url; string via entries (transitive paths) are not advisories', () => {
  const r = parseNpmAudit(npmReport);
  assert.equal(r.examined, 15);
  assert.deepEqual([...r.advisories.keys()].sort(), ['GHSA-aaaa-bbbb-cccc', 'npm-1002']);
  assert.equal(r.advisories.get('GHSA-aaaa-bbbb-cccc').pkg, 'fixture-lib');
});

test("npm: an advisory keeps its dependents: the vulnerable package's effects, and (direct) for the project's own manifest", () => {
  assert.deepEqual(parseNpmAudit(npmReport).advisories.get('GHSA-aaaa-bbbb-cccc').dependents, ['fixture-parent']);
  const direct = structuredClone(npmReport);
  direct.vulnerabilities['fixture-lib'].isDirect = true;
  assert.deepEqual(parseNpmAudit(direct).advisories.get('GHSA-aaaa-bbbb-cccc').dependents, ['(direct)', 'fixture-parent']);
  const none = structuredClone(npmReport);
  delete none.vulnerabilities['fixture-lib'].effects;
  assert.deepEqual(parseNpmAudit(none).advisories.get('GHSA-aaaa-bbbb-cccc').dependents, []);
});

test('npm: an error object from npm is "could not run", never clean', () => {
  const r = parseNpmAudit({ error: { code: 'ENOLOCK', summary: 'no lockfile' } });
  assert.match(r.error, /ENOLOCK/);
  assert.ok(parseNpmAudit({}).error, 'JSON without metadata is refused');
});

test('evaluate: refuses to report clean when 0 packages were examined', () => {
  const r = evaluate({ examined: 0, advisories: new Map(), allow: {} });
  assert.deepEqual(r.problems, ['0 packages examined; refusing to report clean']);
});

test('evaluate: fails on an advisory that is not allow-listed', () => {
  const { advisories } = parseNpmAudit(npmReport);
  const r = evaluate({ examined: 15, advisories, allow: { 'npm-1002': npmAllow()['npm-1002'] } });
  assert.equal(r.open, 1);
  assert.equal(r.allowListed, 1);
  assert.deepEqual(r.problems, ['GHSA-aaaa-bbbb-cccc fixture-lib (moderate): Fixture prototype pollution']);
});

test('evaluate: passes when every advisory is allow-listed with a reason and the dependents npm reports', () => {
  const { advisories } = parseNpmAudit(npmReport);
  assert.deepEqual(evaluate({ examined: 15, advisories, allow: npmAllow() }).problems, []);
});

test('evaluate: rejects an allow-list entry without a reason', () => {
  const { advisories } = parseNpmAudit(npmReport);
  assert.deepEqual(evaluate({ examined: 15, advisories, allow: npmAllow('  ') }).problems, ['allow-list entry GHSA-aaaa-bbbb-cccc has no reason']);
  const bare = { ...npmAllow(), 'GHSA-aaaa-bbbb-cccc': { via: ['fixture-parent'] } };
  assert.deepEqual(evaluate({ examined: 15, advisories, allow: bare }).problems, ['allow-list entry GHSA-aaaa-bbbb-cccc has no reason']);
});

/*
 * An allow-listed advisory that reaches new code. The fixture copies the shape of a real case: a
 * build tool's dependency with an advisory (reached via a CLI and a signing helper), which a
 * runtime package starts to use as well. npm dedupes it onto the same copy, so `nodes` stays the
 * same and only `effects` grows.
 */
const spreadReport = (effects, { isDirect = false } = {}) => ({
  auditReportVersion: 2,
  vulnerabilities: {
    'fixture-forge': {
      name: 'fixture-forge',
      severity: 'high',
      isDirect,
      via: [{ source: 2001, name: 'fixture-forge', title: 'Fixture signature forgery', url: 'https://github.com/advisories/GHSA-ffff-gggg-hhhh', severity: 'high' }],
      effects,
      nodes: ['node_modules/fixture-forge'],
    },
  },
  metadata: { dependencies: { total: 40 } },
});
const TOOLING = ['fixture-cli', 'fixture-signing'];
const forgeEntry = (via) => ({ reason: 'build tool only: fixture reason', ...(via ? { via } : {}) });

test('evaluate: an allow-listed advisory reported through a dependent its entry does not list fails, although its copy is the same', () => {
  const at = (report, entry) => evaluate({ examined: 40, ...parseNpmAudit(report), allow: { 'GHSA-ffff-gggg-hhhh': entry } }).problems;
  assert.deepEqual(at(spreadReport(TOOLING), forgeEntry(TOOLING)), [], 'the dependents the reason assumes');
  assert.deepEqual(at(spreadReport([...TOOLING, 'fixture-runtime']), forgeEntry(TOOLING)), [
    'GHSA-ffff-gggg-hhhh fixture-forge (high) is now also reached via fixture-runtime, which allow-list entry GHSA-ffff-gggg-hhhh does not list; '
      + 'check whether its reason still holds, then add them to "via" or fix the advisory',
  ]);
  // The project starts to depend on it itself.
  assert.match(at(spreadReport(TOOLING, { isDirect: true }), forgeEntry(TOOLING)).join('\n'), /is now also reached via \(direct\), which/);
  // An entry that records no dependents, or no list of names, cannot be checked.
  assert.deepEqual(at(spreadReport(TOOLING), forgeEntry(null)), [
    'allow-list entry GHSA-ffff-gggg-hhhh does not record the dependents its reason assumes; check the reason against them, then add "via" (npm reports: fixture-cli, fixture-signing)',
  ]);
  assert.deepEqual(at(spreadReport(TOOLING), 'build tool only: fixture reason'), at(spreadReport(TOOLING), forgeEntry(null)), 'a plain reason records no dependents');
  assert.match(at(spreadReport(TOOLING), forgeEntry('fixture-cli')).join('\n'), /"via" must be a list of package names/);
  assert.match(at(spreadReport(TOOLING), forgeEntry([''])).join('\n'), /"via" must be a list of package names/);
  // A listed dependent npm no longer reports, and a key that is neither reason nor via.
  assert.deepEqual(at(spreadReport(['fixture-cli']), forgeEntry(TOOLING)), [
    'allow-list entry GHSA-ffff-gggg-hhhh lists via fixture-signing, which npm no longer reports; remove them (the list may only shrink)',
  ]);
  assert.deepEqual(at(spreadReport(TOOLING), { ...forgeEntry(TOOLING), vias: ['x'] }), [
    'allow-list entry GHSA-ffff-gggg-hhhh has unknown keys (vias); only reason and via',
  ]);
  // No dependents at all is a list too: an empty one.
  assert.deepEqual(at(spreadReport([]), forgeEntry([])), []);
});

test('evaluate: composer names no dependents, so its entries carry a reason only', () => {
  const report = { advisories: { 'a/one': [{ packageName: 'a/one', title: 'Fixture XSS', severity: 'medium', sources: [{ remoteId: 'GHSA-1111-2222-3333' }] }] } };
  const { advisories } = parseComposerAudit(report, { packages: [{ name: 'a/one' }] });
  const at = (entry) => evaluate({ examined: 1, advisories, allow: { 'GHSA-1111-2222-3333': entry } }).problems;
  assert.deepEqual(at('not reachable: fixture reason'), []);
  assert.deepEqual(at({ reason: 'not reachable: fixture reason' }), []);
  assert.deepEqual(at({ reason: 'not reachable: fixture reason', via: ['a/two'] }), [
    'allow-list entry GHSA-1111-2222-3333: this audit names no dependents, so "via" cannot be checked; remove it',
  ]);
});

test('evaluate: a stale allow-list entry fails (the list may only shrink)', () => {
  const r = evaluate({ examined: 3, advisories: new Map(), allow: { 'GHSA-dddd-eeee-ffff': 'fixed long ago' } });
  assert.equal(r.problems.length, 1);
  assert.match(r.problems[0], /^stale allow-list entry GHSA-dddd-eeee-ffff: .*may only shrink/);
});

const lock = { packages: [{ name: 'a/one' }, { name: 'a/two' }], 'packages-dev': [{ name: 'a/dev' }] };

test('composer: advisories as an array or a keyed object, GHSA from sources[].remoteId, abandoned packages', () => {
  const report = {
    advisories: {
      'a/one': [{ advisoryId: 'PKSA-1111-2222-3333', packageName: 'a/one', title: 'Fixture XSS', severity: 'medium', sources: [{ name: 'GitHub', remoteId: 'GHSA-1111-2222-3333' }] }],
      'a/two': { 3: { advisoryId: 'PKSA-4444-5555-6666', packageName: 'a/two', title: 'Fixture DoS', severity: 'low', sources: [{ name: 'FriendsOfPHP/security-advisories', remoteId: 'a/two/2026-01-01.yaml' }] } },
    },
    abandoned: { 'a/dev': 'b/dev' },
  };
  const r = parseComposerAudit(report, lock);
  assert.equal(r.examined, 3);
  assert.deepEqual([...r.advisories.keys()].sort(), ['GHSA-1111-2222-3333', 'PKSA-4444-5555-6666', 'abandoned:a/dev']);
  assert.equal(r.advisories.get('abandoned:a/dev').severity, 'abandoned');
});

test('composer: "advisories": [] means none, and the lock is still the denominator', () => {
  const r = parseComposerAudit({ advisories: [], abandoned: [] }, lock);
  assert.equal(r.advisories.size, 0);
  assert.deepEqual(evaluate({ examined: r.examined, advisories: r.advisories, allow: {} }).problems, []);
  assert.ok(parseComposerAudit({}, lock).error, 'JSON without "advisories" is refused');
});

test('composer: refuses when composer.json has its own config.audit.ignore list', () => {
  assert.match(composerIgnoreProblem({ config: { audit: { ignore: ['GHSA-1111-2222-3333'] } } }), /config\.audit\.ignore lists 1/);
  assert.match(composerIgnoreProblem({ config: { audit: { ignore: { 'PKSA-1': 'x' } } } }), /lists 1/);
  assert.equal(composerIgnoreProblem({ config: { audit: { abandoned: 'fail' } } }), null);
});

test('allow-list: a missing section is an error, not an empty list', () => {
  const dir = mkdtempSync(join(tmpdir(), 'audit-'));
  try {
    const file = join(dir, 'allow.json');
    writeFileSync(file, JSON.stringify({ 'npm:.': {} }));
    assert.deepEqual(loadAllowSection(file, 'npm:.'), { allow: {} });
    assert.match(loadAllowSection(file, 'npm:server').error, /no section "npm:server"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------------------------------
 * The wrapper: audit() with a fake runner, so no npm, no composer and no network are involved.
 * ------------------------------------------------------------------------------------------ */

const npmClean = { auditReportVersion: 2, vulnerabilities: {}, metadata: { dependencies: { total: 15 } } };
const NPM_ARGS = ['audit', '--json', '--package-lock-only'];
const COMPOSER_ARGS = ['audit', '--locked', '--format=json', '--no-interaction'];

/**
 * Runs `fn({ root, allowlist })` on a new temporary root holding `files` ({ path: object | string })
 * and an allow-list file with the sections in `allow`; removes the root afterwards.
 */
function withRoot(files, fn, allow = { 'npm:app': {}, 'composer:api': {} }) {
  const root = mkdtempSync(join(tmpdir(), 'audit-root-'));
  try {
    for (const [rel, content] of Object.entries(files)) {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      writeFileSync(join(root, rel), typeof content === 'string' ? content : JSON.stringify(content));
    }
    const allowlist = join(root, 'allow.json');
    writeFileSync(allowlist, JSON.stringify(allow));
    return fn({ root, allowlist });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** A runner that records its calls and answers `result`; it never starts a process. */
function fakeRun(result) {
  const calls = [];
  return { calls, run: (cmd, args, cwd) => (calls.push({ cmd, args, cwd }), result) };
}

const NPM_FILES = { 'app/package-lock.json': { lockfileVersion: 3, packages: {} } };
const COMPOSER_FILES = { 'api/composer.lock': lock, 'api/composer.json': { require: {} } };

test('audit: no package-lock.json or composer.lock means it cannot run (exit 2), and no tool starts', () => {
  withRoot({ 'app/package.json': '{}', 'api/composer.json': { require: {} } }, ({ root, allowlist }) => {
    const { run, calls } = fakeRun({ json: npmClean });
    assert.deepEqual(audit('npm', 'app', { root, allowlist, run }), { code: 2, lines: ['npm app: no package-lock.json'] });
    assert.deepEqual(audit('composer', 'api', { root, allowlist, run }), { code: 2, lines: ['composer api: no composer.lock'] });
    assert.equal(calls.length, 0);
  });
});

test('audit: a tool that printed nothing, printed no JSON or could not start means exit 2', () => {
  withRoot({ ...NPM_FILES, ...COMPOSER_FILES }, ({ root, allowlist }) => {
    for (const error of [
      'npm audit --json --package-lock-only printed nothing (exit 1); stderr: fixture',
      'npm audit --json --package-lock-only did not print JSON (exit 1)',
      'npm could not start: fixture spawn error',
    ]) {
      const { run, calls } = fakeRun({ error });
      assert.deepEqual(audit('npm', 'app', { root, allowlist, run }), { code: 2, lines: [`npm app: ${error}`] });
      assert.deepEqual(calls, [{ cmd: 'npm', args: NPM_ARGS, cwd: resolve(root, 'app') }]);
    }
    const { run } = fakeRun({ error: 'composer could not start: fixture spawn error' });
    assert.deepEqual(audit('composer', 'api', { root, allowlist, run }), {
      code: 2,
      lines: ['composer api: composer could not start: fixture spawn error'],
    });
  });
});

test('audit: npm error JSON and npm JSON without metadata mean exit 2, never clean', () => {
  withRoot(NPM_FILES, ({ root, allowlist }) => {
    const failed = fakeRun({ json: { error: { code: 'ENOLOCK', summary: 'fixture summary' } } });
    assert.deepEqual(audit('npm', 'app', { root, allowlist, run: failed.run }), {
      code: 2,
      lines: ['npm app: npm audit failed: ENOLOCK fixture summary'],
    });
    const bare = fakeRun({ json: { auditReportVersion: 2, vulnerabilities: {} } });
    assert.deepEqual(audit('npm', 'app', { root, allowlist, run: bare.run }), {
      code: 2,
      lines: ['npm app: npm audit JSON has no metadata.dependencies.total'],
    });
  });
});

test('audit: a clean npm report is exit 0 with the denominator line', () => {
  withRoot(NPM_FILES, ({ root, allowlist }) => {
    const { run, calls } = fakeRun({ json: npmClean });
    const r = audit('npm', 'app', { root, allowlist, run });
    assert.deepEqual(r, { code: 0, lines: ['npm app: examined 15 packages, 0 advisories (0 allow-listed, 0 open)', 'OK'] });
    assert.match(r.lines[0], /examined 15 packages/);
    assert.deepEqual(calls, [{ cmd: 'npm', args: NPM_ARGS, cwd: resolve(root, 'app') }]);
  });
});

test('audit: an advisory that is not allow-listed is exit 1 and is named', () => {
  const allow = { 'npm:app': { 'npm-1002': { reason: 'fixture reason: dev-only tool', via: ['fixture-parent'] } }, 'composer:api': {} };
  withRoot(
    NPM_FILES,
    ({ root, allowlist }) => {
      const { run } = fakeRun({ json: npmReport });
      assert.deepEqual(audit('npm', 'app', { root, allowlist, run }), {
        code: 1,
        lines: [
          'npm app: examined 15 packages, 2 advisories (1 allow-listed, 1 open)',
          '  - GHSA-aaaa-bbbb-cccc fixture-lib (moderate): Fixture prototype pollution',
          'FAIL: 1 problem(s)',
        ],
      });
    },
    allow,
  );
});

test('audit: an allow-listed advisory that npm now reports through another dependent is exit 1, not clean', () => {
  const spread = spreadReport([...TOOLING, 'fixture-runtime']);
  const header = 'npm app: examined 40 packages, 1 advisories (1 allow-listed, 0 open)';
  // An entry with a reason only, as the allow-list had them: the new dependent must not pass unseen.
  withRoot(NPM_FILES, ({ root, allowlist }) => {
    const { run } = fakeRun({ json: spread });
    const r = audit('npm', 'app', { root, allowlist, run });
    assert.equal(r.code, 1, `an allow-listed advisory reached through a new dependent was reported clean: ${r.lines.join(' | ')}`);
    assert.deepEqual(r.lines, [
      header,
      '  - allow-list entry GHSA-ffff-gggg-hhhh does not record the dependents its reason assumes; check the reason against them, then add "via" (npm reports: fixture-cli, fixture-runtime, fixture-signing)',
      'FAIL: 1 problem(s)',
    ]);
  }, { 'npm:app': { 'GHSA-ffff-gggg-hhhh': 'build tool only: fixture reason' } });
  // An entry that records the dependents its reason assumes.
  withRoot(NPM_FILES, ({ root, allowlist }) => {
    assert.deepEqual(audit('npm', 'app', { root, allowlist, run: fakeRun({ json: spread }).run }), {
      code: 1,
      lines: [
        header,
        '  - GHSA-ffff-gggg-hhhh fixture-forge (high) is now also reached via fixture-runtime, which allow-list entry GHSA-ffff-gggg-hhhh does not list; '
          + 'check whether its reason still holds, then add them to "via" or fix the advisory',
        'FAIL: 1 problem(s)',
      ],
    });
    assert.deepEqual(audit('npm', 'app', { root, allowlist, run: fakeRun({ json: spreadReport(TOOLING) }).run }), { code: 0, lines: [header, 'OK'] });
  }, { 'npm:app': { 'GHSA-ffff-gggg-hhhh': forgeEntry(TOOLING) } });
});

test("audit: composer.json's own config.audit.ignore fails a clean composer report (exit 1)", () => {
  const cleanComposer = { advisories: [], abandoned: [] };
  withRoot(COMPOSER_FILES, ({ root, allowlist }) => {
    const { run, calls } = fakeRun({ json: cleanComposer });
    assert.deepEqual(audit('composer', 'api', { root, allowlist, run }), {
      code: 0,
      lines: ['composer api: examined 3 packages, 0 advisories (0 allow-listed, 0 open)', 'OK'],
    });
    assert.deepEqual(calls, [{ cmd: 'composer', args: COMPOSER_ARGS, cwd: resolve(root, 'api') }]);
  });
  const ignoring = { ...COMPOSER_FILES, 'api/composer.json': { config: { audit: { ignore: ['GHSA-1111-2222-3333'] } } } };
  withRoot(ignoring, ({ root, allowlist }) => {
    const { run } = fakeRun({ json: cleanComposer });
    assert.deepEqual(audit('composer', 'api', { root, allowlist, run }), {
      code: 1,
      lines: [
        'composer api: examined 3 packages, 0 advisories (0 allow-listed, 0 open)',
        '  - composer.json config.audit.ignore lists 1 advisories; move them to .github/audit-allowlist.json with a reason',
        'FAIL: 1 problem(s)',
      ],
    });
  });
});

test('audit: a missing allow-list section or an unknown tool means exit 2, and no tool starts', () => {
  withRoot(
    NPM_FILES,
    ({ root, allowlist }) => {
      const { run, calls } = fakeRun({ json: npmClean });
      assert.deepEqual(audit('npm', 'app', { root, allowlist, run }), {
        code: 2,
        lines: [`npm app: allow-list ${allowlist} has no section "npm:app"; add one (an empty object is fine)`],
      });
      assert.deepEqual(audit('yarn', 'app', { root, allowlist, run }), {
        code: 2,
        lines: ['usage: node scripts/ci/audit.mjs npm|composer <dir> [--allowlist <file>]'],
      });
      assert.equal(calls.length, 0);
    },
    { 'npm:other': {}, 'yarn:app': {} },
  );
});

test('the CLI prints usage without a tool and directory, and honours --allowlist (exit 2, no tool starts)', () => {
  const cli = fileURLToPath(new URL('./audit.mjs', import.meta.url));
  const env = { ...process.env };
  delete env.GITHUB_STEP_SUMMARY;
  const usage = spawnSync(process.execPath, [cli], { encoding: 'utf8', env });
  assert.equal(usage.status, 2);
  assert.equal(usage.stdout.trim(), 'usage: node scripts/ci/audit.mjs npm|composer <dir> [--allowlist <file>]');
  // scripts/ has no package-lock.json, so the run stops before npm. Only the allow-list given on
  // the command line has a "npm:scripts" section; with the default one the error would differ.
  const dir = mkdtempSync(join(tmpdir(), 'audit-cli-'));
  try {
    const allowlist = join(dir, 'allow.json');
    writeFileSync(allowlist, JSON.stringify({ 'npm:scripts': {} }));
    const r = spawnSync(process.execPath, [cli, 'npm', 'scripts', '--allowlist', allowlist], { encoding: 'utf8', env, cwd: REPO_ROOT });
    assert.equal(r.status, 2);
    assert.equal(r.stdout.trim(), 'npm scripts: no package-lock.json');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runTool: empty output, output that is not JSON and a command that does not exist are errors', () => {
  const dir = mkdtempSync(join(tmpdir(), 'audit-run-'));
  try {
    // `node` stands in for npm and composer; the scripts contain no spaces (on Windows the
    // command line is one string for the shell).
    assert.deepEqual(runTool('node', ['-e', 'process.stdout.write(JSON.stringify({a:1}))'], dir), { json: { a: 1 } });
    assert.match(runTool('node', ['-e', '0'], dir).error, /^node -e 0 printed nothing \(exit 0\)/);
    assert.match(runTool('node', ['-e', "process.stdout.write('fixture')"], dir).error, /did not print JSON \(exit 0\)$/);
    assert.match(runTool('no-such-audit-tool-fixture', [], dir).error, /could not start|printed nothing/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the repository allow-list has one section per audited lock file, reasons for every entry and the dependents of every npm entry', () => {
  const data = JSON.parse(readFileSync(join(REPO_ROOT, '.github', 'audit-allowlist.json'), 'utf8'));
  let entries = 0;
  for (const section of ['npm:.', 'npm:server', 'composer:api']) {
    assert.equal(typeof data[section], 'object', section);
    for (const [id, value] of Object.entries(data[section])) {
      entries += 1;
      const { reason, via, unknown } = allowEntry(value);
      assert.ok(typeof reason === 'string' && reason.trim().length > 0, `${section} ${id} needs a reason`);
      assert.deepEqual(unknown, [], `${section} ${id}: only reason and via`);
      if (section.startsWith('npm:')) {
        assert.ok(Array.isArray(via) && via.every((d) => typeof d === 'string' && d.trim() !== ''), `${section} ${id} needs "via": the dependents its reason assumes`);
      } else {
        assert.equal(via, undefined, `${section} ${id}: composer names no dependents`);
      }
    }
  }
  console.log(`allow-list: ${entries} entries in 3 sections`);
});
