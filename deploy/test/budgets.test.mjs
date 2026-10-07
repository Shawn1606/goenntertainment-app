// The time limits of the stack test and of the CI job that runs it, checked against each other.
// They are written in three files: the stack test's own budgets (deploy/test/stack.test.mjs), the
// limit for the whole test file (package.json, test:deploy:stack) and the deploy job of
// .github/workflows/docker.yml. Needs neither Docker nor a network.
//
//   node --test deploy/test/budgets.test.mjs        (npm run test:deploy runs every deploy test)
//
// Why they must fit: `node --test --test-timeout` gives the whole file one limit. When it runs
// out, the runner kills the file's process, so the stack test's after() hook, which prints the
// stack's logs and removes the stack, never runs. That limit must therefore cover before(), time
// for the checks and after(); the image build runs inside before() and must end before it; and
// the job must outlast every step that may run in it, or GitHub cancels the job and the log step
// after the stack test never runs either.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { CI_ENV, CI_OVERRIDE, COMPOSE_FILE, REPO_ROOT, readText } from './lib.mjs';

const MINUTE = 60_000;
/** Time for the checks between before() and after(); a whole run took about 2 minutes locally. */
export const CHECKS_MS = 5 * MINUTE;
/** Time between the runner killing the test file and the step ending (npm and node exiting). */
export const STOP_MS = 1 * MINUTE;
/** Time for the job's steps that only set up or count (checkout, setup-node, the test counts). */
export const QUICK_MS = 3 * MINUTE;

const STACK_SCRIPT = 'test:deploy:stack';
const WORKFLOW = path.join(REPO_ROOT, '.github', 'workflows', 'docker.yml');
const STACK_TEST = path.join(REPO_ROOT, 'deploy', 'test', 'stack.test.mjs');

/** `30 * 60_000` and the like: whole numbers joined by `*`; anything else is refused. */
export function milliseconds(expression) {
  const text = String(expression ?? '').trim();
  if (!/^\d[\d_]*(?:\s*\*\s*\d[\d_]*)*$/.test(text)) throw new Error(`cannot read the time "${text}"`);
  return text.split('*').reduce((product, factor) => product * Number(factor.trim().replaceAll('_', '')), 1);
}

/** The limit `node --test` gives the whole stack test file, from the npm script. */
export function fileLimit(packageJson) {
  const script = JSON.parse(packageJson).scripts?.[STACK_SCRIPT] ?? '';
  const m = /--test-timeout[= ](\d+)(?:\s|$)/.exec(script);
  if (!m) throw new Error(`the npm script ${STACK_SCRIPT} sets no --test-timeout: the job's limit would be the only one`);
  return Number(m[1]);
}

/** The stack test's own budgets: before(), after() and the image build inside before(). */
export function stackBudgets(source) {
  const hook = (name) => {
    const m = new RegExp(`^${name}\\((?:async )?\\(\\) => \\{[\\s\\S]*?^\\}, \\{ timeout: ([^}]+?) \\}\\);$`, 'm').exec(source);
    if (!m) throw new Error(`cannot find the timeout of the ${name}() hook in the stack test`);
    return milliseconds(m[1]);
  };
  const build = /stack\.compose\(\['build'\], \{[^}]*\btimeout: ([^,}]+?)\s*\}\)/.exec(source);
  if (!build) throw new Error('cannot find the timeout of the image build (`stack.compose([\'build\'], ...)`) in the stack test');
  return { before: hook('before'), after: hook('after'), build: milliseconds(build[1]) };
}

/** A key of a step or a job (`name:`, `- run:`), without quotes and a trailing comment. */
function value(line, key) {
  const m = new RegExp(`^\\s*(?:-\\s+)?${key}:\\s*(.*?)\\s*$`).exec(line);
  if (!m) return null;
  return m[1].replace(/\s+#.*$/, '').replace(/^(['"])(.*)\1$/, '$2');
}

/**
 * The `deploy:` job of docker.yml, read line by line (the deploy tests run without npm install,
 * so without a YAML parser): its timeout, its env and its steps.
 */
export function deployJob(text) {
  const lines = text.split(/\r?\n/);
  const jobs = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  const start = lines.findIndex((l, i) => jobs >= 0 && i > jobs && /^ {2}deploy:\s*$/.test(l));
  if (start < 0) throw new Error('no `deploy:` job under `jobs:` in docker.yml');
  const job = { timeout: null, env: {}, steps: [] };
  const envEntry = (line, indent) => new RegExp(`^ {${indent}}([A-Za-z_][A-Za-z0-9_]*):\\s*(.*?)\\s*$`).exec(line);
  let section = null;
  let stepSection = null;
  for (const line of lines.slice(start + 1)) {
    if (/^ {0,2}\S/.test(line) && !line.trimStart().startsWith('#')) break;
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    if (/^ {4}\S/.test(line)) {
      section = /^ {4}([\w-]+):/.exec(line)?.[1] ?? null;
      if (section === 'timeout-minutes') job.timeout = Number(value(line, 'timeout-minutes'));
      continue;
    }
    if (section === 'env') {
      const m = envEntry(line, 6);
      if (m) job.env[m[1]] = value(line, m[1]);
      continue;
    }
    if (section !== 'steps') continue;
    if (/^ {6}-\s/.test(line)) job.steps.push({ env: {} });
    const step = job.steps.at(-1);
    if (!step) continue;
    // A key of the step itself: after `      - ` or at 8 spaces.
    const key = /^ {6}(?:- | {2})([\w-]+):/.exec(line)?.[1];
    if (key) {
      stepSection = key;
      if (['name', 'run', 'uses', 'if'].includes(key)) step[key] = value(line, key);
      if (key === 'timeout-minutes') step[key] = Number(value(line, key));
      continue;
    }
    const m = stepSection === 'env' ? envEntry(line, 10) : null;
    if (m) step.env[m[1]] = value(line, m[1]);
  }
  return job;
}

const isStackStep = (step) => /^npm run test:deploy:stack$/.test(step.run ?? '');
/** Steps that only set up or count: an action, or the test count (scripts/ci/test-report.mjs). */
const isQuickStep = (step) => Boolean(step.uses) || /^node scripts\/ci\/test-report\.mjs\s/.test(step.run ?? '');

/** What each step of the job may take, in ms, and the problems found on the way. */
export function jobBudget(job, limit) {
  const problems = [];
  let total = QUICK_MS;
  const parts = [`${QUICK_MS / MINUTE} min for the steps that set up or count`];
  for (const step of job.steps) {
    const label = step.name ?? step.run ?? step.uses ?? '(a step)';
    const own = Number.isFinite(step['timeout-minutes']) ? step['timeout-minutes'] * MINUTE : null;
    if (isStackStep(step)) {
      if (own === null || own < limit + STOP_MS) {
        problems.push(`"${label}": its timeout-minutes must be at least the file limit (${limit / MINUTE} min) + ${STOP_MS / MINUTE} min, `
          + 'so the test runner reports a timeout and after() has run before GitHub stops the step');
      }
      total += own ?? limit + STOP_MS;
      parts.push(`${(own ?? limit + STOP_MS) / MINUTE} min for the stack test`);
    } else if (!isQuickStep(step)) {
      // Setup and count steps are covered by QUICK_MS; every other step brings its own limit.
      if (own === null) {
        problems.push(`"${label}": a step that runs more than a setup or a count needs its own timeout-minutes`);
      } else {
        total += own;
        parts.push(`${own / MINUTE} min for "${label}"`);
      }
    }
  }
  return { total, parts, problems };
}

test("the stack test's file limit covers before(), the checks and after(); the build fits in before()", () => {
  const limit = fileLimit(readText(path.join(REPO_ROOT, 'package.json')));
  const b = stackBudgets(readText(STACK_TEST));
  const min = (ms) => `${ms / MINUTE} min`;
  console.log(`file limit ${min(limit)}; before() ${min(b.before)} (build ${min(b.build)}), checks ${min(CHECKS_MS)}, after() ${min(b.after)}`);
  assert.ok(b.build < b.before, `the build (${min(b.build)}) runs inside before() (${min(b.before)}) and must end before it`);
  assert.ok(b.before - b.build >= 5 * MINUTE, `before() must leave at least 5 min after the build to start the stack (${min(b.before - b.build)} left)`);
  assert.ok(
    b.before + CHECKS_MS + b.after <= limit,
    `the file limit (${min(limit)}, package.json ${STACK_SCRIPT}) must cover before() + checks + after() `
      + `(${min(b.before + CHECKS_MS + b.after)}); otherwise the runner kills the file and after() never prints the logs or removes the stack`,
  );
});

test('the deploy job outlasts every step that may run in it, the stack test included', () => {
  const limit = fileLimit(readText(path.join(REPO_ROOT, 'package.json')));
  const job = deployJob(readText(WORKFLOW));
  console.log(`deploy job: ${job.steps.length} steps, timeout-minutes ${job.timeout}`);
  assert.ok(job.steps.length > 0, 'no steps found in the deploy job; refusing to report its budget');
  assert.equal(job.steps.filter(isStackStep).length, 1, 'exactly one step runs npm run test:deploy:stack');
  assert.ok(Number.isInteger(job.timeout) && job.timeout > 0, 'the deploy job sets no timeout-minutes');
  const { total, parts, problems } = jobBudget(job, limit);
  console.log(`budget: ${parts.join(' + ')} = ${total / MINUTE} min`);
  assert.deepEqual(problems, []);
  assert.ok(total <= job.timeout * MINUTE, `the job's timeout-minutes (${job.timeout}) must cover its steps (${total / MINUTE} min)`);
});

test('the log step after the stack test reads the same project, compose files and env file as the test', () => {
  const job = deployJob(readText(WORKFLOW));
  const stackAt = job.steps.findIndex(isStackStep);
  const logs = job.steps.filter((s, i) => i > stackAt && /^docker compose .* logs(?:\s|$)/.test(s.run ?? ''));
  assert.equal(logs.length, 1, 'one step after the stack test prints the stack logs');
  const [step] = logs;
  assert.match(step.if ?? '', /^\$\{\{\s*failure\(\)\s*\}\}$|^failure\(\)$/, 'the log step runs when a step before it failed');
  // The project: one COMPOSE_PROJECT_NAME for the job, which neither step overrides.
  assert.match(job.env.COMPOSE_PROJECT_NAME ?? '', /^[a-z0-9][a-z0-9_-]*$/, 'the job sets COMPOSE_PROJECT_NAME');
  for (const s of [job.steps[stackAt], step]) {
    assert.equal(s.env.COMPOSE_PROJECT_NAME, undefined, `"${s.name}" must use the job's COMPOSE_PROJECT_NAME`);
  }
  assert.doesNotMatch(step.run, /\s(?:-p|--project-name)\s/, "the log step must use the job's COMPOSE_PROJECT_NAME");
  // The files: those the stack test uses by default (stack-lib.mjs, stackSettings).
  const rel = (file) => path.relative(REPO_ROOT, file).split(path.sep).join('/');
  const expected = ['--project-directory deploy', `--env-file ${rel(CI_ENV)}`, `-f deploy/${COMPOSE_FILE}`, `-f deploy/${CI_OVERRIDE}`];
  for (const part of expected) assert.ok(step.run.includes(` ${part} `), `the log step passes ${part}`);
  assert.equal((step.run.match(/\s-f\s/g) ?? []).length, 2, 'the log step passes exactly the two compose files of the stack test');
});

test('the readers fail closed and the budget rules fire', () => {
  assert.equal(milliseconds('30 * 60_000'), 1_800_000);
  assert.equal(milliseconds('120_000'), 120_000);
  assert.throws(() => milliseconds('ms(30)'), /cannot read/);
  assert.throws(() => fileLimit(JSON.stringify({ scripts: { [STACK_SCRIPT]: 'node --test deploy/test/stack.test.mjs' } })), /sets no --test-timeout/);
  assert.equal(fileLimit(JSON.stringify({ scripts: { [STACK_SCRIPT]: 'node --test --test-timeout=2400000 x.mjs' } })), 2_400_000);
  const source = [
    'before(async () => {', '  x();', '}, { timeout: 30 * 60_000 });',
    "  const build = step('build', () => stack.compose(['build'], { profiles: ['tools'], timeout: 25 * 60_000 }));",
    'after(() => {', '  y();', '}, { timeout: 5 * 60_000 });',
  ].join('\n');
  assert.deepEqual(stackBudgets(source), { before: 30 * MINUTE, after: 5 * MINUTE, build: 25 * MINUTE });
  assert.throws(() => stackBudgets(source.replace('before(', 'beforeEach(')), /before\(\) hook/);
  // A job with a step that has no timeout of its own, a stack step without one and a stack step
  // whose timeout lies under the file limit.
  const workflow = (stackTimeout, staticTimeout) => [
    'jobs:', '  deploy:', '    timeout-minutes: 60', '    env:', '      COMPOSE_PROJECT_NAME: goenn-ci', '    steps:',
    '      - uses: actions/checkout@0000000000000000000000000000000000000000 # v0',
    '      - name: Static', ...(staticTimeout ? [`        timeout-minutes: ${staticTimeout}`] : []), '        run: npm run test:deploy',
    '      - name: Stack', ...(stackTimeout ? [`        timeout-minutes: ${stackTimeout}`] : []), '        run: npm run test:deploy:stack',
    '  other:', '    timeout-minutes: 1',
  ].join('\n');
  const ok = deployJob(workflow(42, 10));
  assert.equal(ok.timeout, 60);
  assert.equal(ok.env.COMPOSE_PROJECT_NAME, 'goenn-ci');
  assert.deepEqual(jobBudget(ok, 40 * MINUTE).problems, []);
  assert.equal(jobBudget(ok, 40 * MINUTE).total, (3 + 42 + 10) * MINUTE);
  assert.match(jobBudget(deployJob(workflow(42, null)), 40 * MINUTE).problems.join('\n'), /"Static": .* needs its own timeout-minutes/);
  assert.match(jobBudget(deployJob(workflow(null, 10)), 40 * MINUTE).problems.join('\n'), /"Stack": its timeout-minutes must be at least/);
  assert.match(jobBudget(deployJob(workflow(40, 10)), 40 * MINUTE).problems.join('\n'), /"Stack": its timeout-minutes must be at least/);
  assert.throws(() => deployJob('jobs:\n  build:\n    timeout-minutes: 1\n'), /no `deploy:` job/);
});
