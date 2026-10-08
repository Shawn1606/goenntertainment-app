import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { run, summarizeJunit, summarizeTap, verdict } from './test-report.mjs';

const tapSummary = ({ tests, pass, fail = 0, cancelled = 0, skipped = 0, todo = 0 }) =>
  [
    'TAP version 13',
    `1..${tests}`,
    `# tests ${tests}`,
    '# suites 0',
    `# pass ${pass}`,
    `# fail ${fail}`,
    `# cancelled ${cancelled}`,
    `# skipped ${skipped}`,
    `# todo ${todo}`,
    '# duration_ms 12.5',
    '',
  ].join('\n');

test('tap: refuses the "# tests 0" stream node --test prints for a glob that matches no file', () => {
  const s = summarizeTap(tapSummary({ tests: 0, pass: 0 }));
  assert.equal(s.tests, 0);
  const v = verdict(s);
  assert.equal(v.ok, false);
  assert.match(v.reason, /no tests ran; refusing to report clean/);
});

test('tap: refuses a stream without its final summary (cut off by a timeout or a crash)', () => {
  const cut = ['TAP version 13', '# Subtest: first', 'ok 1 - first', '# Subtest: second', ''].join('\n');
  const s = summarizeTap(cut);
  assert.ok(s.error);
  assert.equal(verdict(s).ok, false);
  assert.match(verdict(s).reason, /no final summary/);
});

test('tap: passes a clean run and reports its numbers', () => {
  const s = summarizeTap(tapSummary({ tests: 3, pass: 3 }));
  assert.deepEqual(s, { tests: 3, passed: 3, failed: 0, skipped: 0 });
  assert.equal(verdict(s).ok, true);
});

test('tap: fails on a failed test and on a cancelled test', () => {
  assert.equal(verdict(summarizeTap(tapSummary({ tests: 3, pass: 2, fail: 1 }))).ok, false);
  const cancelled = summarizeTap(tapSummary({ tests: 3, pass: 2, cancelled: 1 }));
  assert.equal(cancelled.failed, 1);
  assert.equal(verdict(cancelled).ok, false);
});

test('tap: only the column-0 summary counts, not indented subtest lines', () => {
  const text = ['    # tests 99', tapSummary({ tests: 2, pass: 2 })].join('\n');
  assert.equal(summarizeTap(text).tests, 2);
});

test('junit: refuses tests="0" and a document without <testsuite>', () => {
  assert.equal(verdict(summarizeJunit('<testsuites><testsuite name="x" tests="0" failures="0" errors="0"/></testsuites>')).ok, false);
  const empty = summarizeJunit('<?xml version="1.0"?><testsuites></testsuites>');
  assert.ok(empty.error);
  assert.equal(verdict(empty).ok, false);
});

test('junit: passes 192 tests without failures, fails on one error', () => {
  const ok = summarizeJunit('<testsuites><testsuite name="" tests="192" assertions="400" errors="0" failures="0" skipped="0" time="3.1"><testsuite name="Unit" tests="10"/></testsuite></testsuites>');
  assert.deepEqual(ok, { tests: 192, passed: 192, failed: 0, skipped: 0 });
  assert.equal(verdict(ok).ok, true);
  const bad = summarizeJunit('<testsuites><testsuite name="" tests="192" errors="1" failures="0" skipped="0"></testsuite></testsuites>');
  assert.equal(bad.failed, 1);
  assert.equal(verdict(bad).ok, false);
});

test('cli: a missing report file is a failure, not a pass', () => {
  const dir = mkdtempSync(join(tmpdir(), 'test-report-'));
  try {
    const r = run(['tap', 'probe', join(dir, 'missing.tap')], {});
    assert.equal(r.code, 1);
    assert.match(r.out, /no report/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cli: writes one line to the step summary and exits 0 on a clean report', () => {
  const dir = mkdtempSync(join(tmpdir(), 'test-report-'));
  try {
    const report = join(dir, 'r.tap');
    const summary = join(dir, 'summary.md');
    writeFileSync(report, tapSummary({ tests: 5, pass: 5 }));
    const r = run(['tap', 'client', report], { GITHUB_STEP_SUMMARY: summary });
    assert.equal(r.code, 0);
    assert.equal(readFileSync(summary, 'utf8'), `- ${r.out}\n`);
    assert.match(r.out, /^client: 5 tests, 5 passed, 0 failed, 0 skipped - OK$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cli: rejects unknown formats instead of guessing', () => {
  assert.equal(run(['xml', 'x', 'y'], {}).code, 2);
});
