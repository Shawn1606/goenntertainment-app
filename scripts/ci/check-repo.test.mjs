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

import { CHECKS, formatReport, readTracked, repoContext, report, scanLines, trackedFiles } from './check-repo.mjs';

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
  const ctx = repoContext();
  for (const check of CHECKS) {
    const r = check(ctx);
    assert.ok(r.examined > 0, `${r.check} examined nothing`);
  }
});
