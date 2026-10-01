/**
 * Tests for scripts/ci/check-repo.mjs.
 *
 * Two kinds per check: the real repository must be clean (these fail on a tree that still has
 * the problem), and every finding class must fire on a planted sample (proves the check can fail
 * at all). Planted samples are built at run time and scanned in memory; nothing here is written
 * to disk, and no planted sample appears literally in this file (the repository scan reads it).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CHECKS,
  MUST_IGNORE,
  checkIgnoreRules,
  formatReport,
  ignoreFindings,
  readTracked,
  repoContext,
  report,
  scanLines,
  trackedFiles,
} from './check-repo.mjs';

/** The real repository, read once for all tests. */
let ctxCache;
const ctx = () => (ctxCache ??= repoContext());

/** `class<TAB>location` lines - what a failure message may show. */
const listed = (findings) => findings.map((f) => `${f.cls}\t${f.location}`);

test('every check refuses a verdict on zero examined items', () => {
  assert.throws(() => report('sample', 0, []), /examined 0 items - refusing to report a verdict/);
  assert.throws(() => report('sample', Number.NaN, []), /refusing to report a verdict/);
  assert.deepEqual(report('sample', 3, []), { check: 'sample', examined: 3, findings: [] });
});

test('the tracked-file reader sees the repository and skips binary files', () => {
  const paths = trackedFiles();
  assert.ok(paths.length > 100, `only ${paths.length} tracked files seen`);
  assert.ok(paths.includes('package.json'));
  const { files, binary, missing } = readTracked(undefined, paths);
  assert.equal(files.length + binary + missing, paths.length);
  assert.ok(binary > 0, 'the repository has images; none was recognised as binary');
  assert.ok(!files.some((f) => f.text.includes('\0')));
});

test('the line scanner reports class and location only, and counts the files it applied to', () => {
  const classes = [{ cls: 'planted', re: /needle/, applies: (p) => p.endsWith('.md') }];
  const { findings, examined } = scanLines(
    [
      { path: 'a.md', text: 'hay\r\nhay needle hay\n' },
      { path: 'b.js', text: 'needle' },
    ],
    classes,
  );
  assert.equal(examined, 1);
  assert.deepEqual(findings, [{ cls: 'planted', location: 'a.md:2' }]);
  assert.equal(formatReport(report('planted', examined, findings)), 'planted\texamined 1\tfindings 1\n  planted\ta.md:2');
});

test('every registered check runs on the real repository and examines something', () => {
  assert.ok(CHECKS.length > 0, 'no checks registered');
  for (const check of CHECKS) {
    const r = check(ctx());
    assert.ok(r.examined > 0, `${r.check} examined nothing`);
  }
});

/* ------------------------------------------------------------------ ignore rules (F-46) */

test('F-46: .gitignore ignores env files, dumps, logs and personal agent settings', () => {
  const r = checkIgnoreRules(ctx());
  assert.ok(r.examined > MUST_IGNORE.length);
  assert.deepEqual(listed(r.findings.filter((f) => f.cls === 'gitignore-gap')), []);
});

test('F-46: sources and templates stay un-ignored, and no tracked file is ignored', () => {
  const r = checkIgnoreRules(ctx());
  assert.deepEqual(listed(r.findings.filter((f) => f.cls !== 'gitignore-gap')), []);
});

test('ignore findings: only a non-negated rule from a tracked .gitignore counts', () => {
  const verdicts = [
    { path: '.env', source: '.gitignore', line: '3', pattern: '.env' },
    { path: 'a.log', source: '.git/info/exclude', line: '7', pattern: '*.log' },
    { path: 'b.log', source: 'C:/Users/someone/.gitignore', line: '1', pattern: '*.log' },
    { path: 'c.sql', source: '', line: '', pattern: '' },
    { path: 'server/schema.sql', source: '.gitignore', line: '9', pattern: '!/server/schema.sql' },
    { path: 'api/.env.example', source: 'api/.gitignore', line: '2', pattern: '.env*' },
  ];
  const findings = ignoreFindings({
    mustIgnore: ['.env', 'a.log', 'b.log', 'c.sql'],
    mustNotIgnore: ['server/schema.sql', 'api/.env.example'],
    verdicts,
    tracked: ['.gitignore', 'api/.gitignore'],
    ignoredTracked: ['docs/old.log'],
  });
  assert.deepEqual(listed(findings), [
    'gitignore-gap\ta.log',
    'gitignore-gap\tb.log',
    'gitignore-gap\tc.sql',
    'gitignore-hides-source\tapi/.env.example',
    'tracked-file-ignored\tdocs/old.log',
  ]);
});
