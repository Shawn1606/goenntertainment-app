import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkCiEnv, checkDir, checkWorkflow } from './check-workflows.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHA = 'a'.repeat(40);

// A minimal workflow that follows every rule; each test changes one thing.
const good = (overrides = {}) => {
  const o = {
    permissions: 'permissions:\n  contents: read\n',
    on: 'on:\n  pull_request:\n  push:\n    branches: [main]\n',
    timeout: '    timeout-minutes: 10\n',
    checkout: `      - uses: actions/checkout@${SHA} # v7.0.1\n        with:\n          persist-credentials: false\n`,
    env: '    env:\n      DB_PASSWORD: ci-only-not-a-secret-db\n',
    extra: '',
    ...overrides,
  };
  return `name: T\n${o.on}${o.permissions}jobs:\n  build:\n    runs-on: ubuntu-24.04\n${o.timeout}${o.env}    steps:\n${o.checkout}${o.extra}`;
};

test('accepts a workflow that follows every rule', () => {
  const r = checkWorkflow('t.yml', good());
  assert.deepEqual(r.problems, []);
  assert.equal(r.jobs, 1);
  assert.equal(r.uses, 1);
});

test('rejects a workflow without a top-level permissions block', () => {
  const r = checkWorkflow('t.yml', good({ permissions: '' }));
  assert.deepEqual(r.problems, ['t.yml: no top-level permissions block']);
});

test('rejects write permissions, top-level or per job', () => {
  assert.equal(checkWorkflow('t.yml', good({ permissions: 'permissions: write-all\n' })).problems.length, 1);
  const r = checkWorkflow('t.yml', good({ permissions: 'permissions:\n  contents: read\n  pull-requests: write\n' }));
  assert.deepEqual(r.problems, ['t.yml:8: write permission (pull-requests: write)']);
});

test('rejects a third-party action pinned by tag (actions/checkout@v4)', () => {
  const r = checkWorkflow('t.yml', good({ checkout: '      - uses: actions/checkout@v4\n        with:\n          persist-credentials: false\n' }));
  assert.deepEqual(r.problems, ['t.yml:15: action not pinned by commit SHA: actions/checkout@v4']);
});

test('rejects a SHA pin without a version comment', () => {
  const r = checkWorkflow('t.yml', good({ extra: `      - uses: actions/setup-node@${SHA}\n` }));
  assert.equal(r.problems.length, 1);
  assert.match(r.problems[0], /SHA pin without a version comment/);
});

test('accepts SHA pins with version comments, ./local actions and docker:// digests', () => {
  const extra = [
    `      - uses: shivammathur/setup-php@${SHA} # 2.37.2`,
    '      - uses: ./.github/actions/local',
    `      - uses: docker://alpine:3@sha256:${'b'.repeat(64)}`,
    '',
  ].join('\n');
  const r = checkWorkflow('t.yml', good({ extra }));
  assert.deepEqual(r.problems, []);
  assert.equal(r.uses, 4);
});

test('rejects a uses: it cannot read (flow style) instead of skipping it', () => {
  const r = checkWorkflow('t.yml', good({ extra: `      - { uses: "actions/cache@${SHA}" }\n` }));
  assert.equal(r.problems.length, 1);
  assert.match(r.problems[0], /cannot read this uses: line/);
});

test('rejects pull_request_target', () => {
  const r = checkWorkflow('t.yml', good({ on: 'on:\n  pull_request_target:\n' }));
  assert.deepEqual(r.problems, ['t.yml: pull_request_target is not allowed']);
});

test('rejects a job without timeout-minutes and names the job', () => {
  const r = checkWorkflow('t.yml', good({ timeout: '' }));
  assert.deepEqual(r.problems, ['t.yml: job "build" has no timeout-minutes']);
});

test('rejects checkout that keeps the token in .git/config', () => {
  const r = checkWorkflow('t.yml', good({ checkout: `      - name: Checkout\n        uses: actions/checkout@${SHA} # v7.0.1\n` }));
  assert.deepEqual(r.problems, ['t.yml:16: actions/checkout without persist-credentials: false']);
});

test('rejects a literal secret-looking value; accepts empty, expressions and marked fake values', () => {
  const env = [
    '    env:',
    '      DB_PASSWORD: hunter-fixture',
    '      APP_KEY: "base64:Zml4dHVyZQ=="',
    '      API_TOKEN: abc # not-a-secret (a comment does not count)',
    '      EMPTY_SECRET: \'\'',
    '      FROM_SECRETS_KEY: ${{ secrets.FIXTURE }}',
    '      ROOT_PASSWORD: ci-only-not-a-secret-root',
    '      MYSQL_PWD: fixture-pwd',
    '      CACHE_KEY_PREFIX_PATH: /tmp/cache',
    '',
  ].join('\n');
  const r = checkWorkflow('t.yml', good({ env }));
  assert.deepEqual(r.problems.map((p) => p.replace(/ \(use.*$/, '')), [
    't.yml:13: literal value for DB_PASSWORD',
    't.yml:14: literal value for APP_KEY',
    't.yml:15: literal value for API_TOKEN',
    't.yml:19: literal value for MYSQL_PWD',
  ]);
});

test('does not read shell scripts in run: blocks as YAML', () => {
  const extra = [
    '      - name: Script',
    '        run: |',
    '          echo "uses: something@v1"',
    '          DB_PASSWORD: literal-inside-a-heredoc',
    '',
  ].join('\n');
  assert.deepEqual(checkWorkflow('t.yml', good({ extra })).problems, []);
});

test('refuses to report clean on a directory without workflow files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'check-workflows-'));
  try {
    const r = checkDir(dir);
    assert.equal(r.files, 0);
    assert.equal(r.problems.length, 1);
    assert.match(r.problems[0], /no workflow files found; refusing to report clean/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ci env file: needs the ci-only label and the marker on secret-looking values', () => {
  const labelled = '# CI-ONLY settings. Public and fake.\nDOMAIN=ci.example.invalid\nDB_PASSWORD=ci-only-not-a-secret-db\n';
  assert.deepEqual(checkCiEnv('ci.env', labelled), { settings: 2, problems: [] });
  const bad = checkCiEnv('ci.env', '# settings\nAPP_KEY=base64:Zml4dHVyZQ==\nnot a setting\n');
  assert.deepEqual(bad.problems, [
    'ci.env: the first lines must label the file as CI-ONLY',
    'ci.env:2: literal value for APP_KEY without the "not-a-secret" marker',
    'ci.env:3: cannot read this line as KEY=VALUE',
  ]);
  assert.match(checkCiEnv('ci.env', '# CI-ONLY\n').problems[0], /no settings found/);
});

test('checkDir applies the env rule through --ci-env and counts files, jobs and uses', () => {
  const dir = mkdtempSync(join(tmpdir(), 'check-workflows-'));
  try {
    mkdirSync(join(dir, 'wf'));
    writeFileSync(join(dir, 'wf', 'a.yml'), good());
    writeFileSync(join(dir, 'ci.env'), '# CI-ONLY\nSECRET_TOKEN=real-looking\n');
    const r = checkDir(join(dir, 'wf'), { ciEnv: join(dir, 'ci.env') });
    assert.equal(r.files, 1);
    assert.equal(r.envSettings, 1);
    assert.deepEqual(r.problems, ['ci.env:2: literal value for SECRET_TOKEN without the "not-a-secret" marker']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the repository workflows and deploy/ci.env follow the policy', () => {
  const r = checkDir(join(REPO_ROOT, '.github', 'workflows'), { ciEnv: join(REPO_ROOT, 'deploy', 'ci.env') });
  assert.deepEqual(r.problems, []);
  assert.ok(r.files >= 1, 'at least one workflow file');
  assert.ok(r.jobs >= 1 && r.uses >= 1 && r.envSettings >= 1);
});
