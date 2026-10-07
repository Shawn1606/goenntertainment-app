#!/usr/bin/env node
// Prints how many tests a suite ran and refuses a run that examined nothing.
//
// Why: `node --test` exits 0 when its glob matches no file (it prints "# tests 0"),
// and a run that is killed by a timeout or a crash leaves a TAP stream without its
// final summary. Both would look green in CI. This script reads the report a suite
// wrote and fails unless it shows at least one test and no failures.
//
//   node scripts/ci/test-report.mjs tap   <label> <file.tap>
//   node scripts/ci/test-report.mjs junit <label> <file.xml>
//
// Exit codes: 0 = tests ran and none failed, 1 = no tests, failures or a cut-off report,
// 2 = wrong arguments. When $GITHUB_STEP_SUMMARY is set, one line is appended there.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const TAP_KEYS = ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'];

/**
 * Reads the final summary of a TAP stream written by `node --test`.
 * Only column-0 lines count (subtests are indented); the last occurrence wins,
 * because the summary is the last thing the runner prints.
 */
export function summarizeTap(text) {
  const found = {};
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^# (tests|pass|fail|cancelled|skipped|todo) (\d+)\s*$/.exec(line);
    if (m) found[m[1]] = Number(m[2]);
  }
  const missing = TAP_KEYS.filter((k) => !(k in found));
  if (missing.length > 0) {
    return { error: `the TAP report has no final summary (missing: ${missing.join(', ')}); the run was cut off or never started` };
  }
  return {
    tests: found.tests,
    passed: found.pass,
    failed: found.fail + found.cancelled,
    skipped: found.skipped + found.todo,
  };
}

/** Reads the totals of a JUnit report (PHPUnit writes one top-level <testsuite> with the totals). */
export function summarizeJunit(xml) {
  const m = /<testsuite\b([^>]*)>/.exec(String(xml));
  if (!m) return { error: 'the JUnit report has no <testsuite> element; the run was cut off or never started' };
  const attrs = {};
  for (const a of m[1].matchAll(/([\w:-]+)="([^"]*)"/g)) attrs[a[1]] = a[2];
  const num = (name) => (attrs[name] === undefined ? NaN : Number(attrs[name]));
  const tests = num('tests');
  const failures = num('failures');
  const errors = num('errors');
  if ([tests, failures, errors].some((n) => !Number.isInteger(n))) {
    return { error: 'the JUnit <testsuite> element lacks numeric tests/failures/errors attributes' };
  }
  const skipped = Number.isInteger(num('skipped')) ? num('skipped') : 0;
  return { tests, passed: tests - failures - errors - skipped, failed: failures + errors, skipped };
}

/** Turns a summary into a verdict. Never "ok" on zero tests. */
export function verdict(summary) {
  if (summary.error) return { ok: false, reason: summary.error };
  if (!(summary.tests > 0)) return { ok: false, reason: 'no tests ran; refusing to report clean' };
  if (summary.failed > 0) return { ok: false, reason: `${summary.failed} failed` };
  return { ok: true, reason: 'ok' };
}

export function formatLine(label, summary, v) {
  if (summary.error) return `${label}: ${v.reason}`;
  return `${label}: ${summary.tests} tests, ${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped - ${v.ok ? 'OK' : `FAIL (${v.reason})`}`;
}

export function run(argv, env = process.env) {
  const [format, label, file] = argv;
  if (!['tap', 'junit'].includes(format) || !label || !file) {
    return { code: 2, out: 'usage: node scripts/ci/test-report.mjs tap|junit <label> <file>' };
  }
  if (!existsSync(file)) {
    return { code: 1, out: `${label}: no report at ${file} (did the test step start?); refusing to report clean` };
  }
  const text = readFileSync(file, 'utf8');
  const summary = format === 'tap' ? summarizeTap(text) : summarizeJunit(text);
  const v = verdict(summary);
  const out = formatLine(label, summary, v);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `- ${out}\n`);
  return { code: v.ok ? 0 : 1, out };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const { code, out } = run(process.argv.slice(2));
  console.log(out);
  process.exit(code);
}
