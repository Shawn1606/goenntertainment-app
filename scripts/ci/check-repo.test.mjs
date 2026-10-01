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
  AUTOSTART_CLASSES,
  CHECKS,
  LOG_MAILER_CLASSES,
  MUST_IGNORE,
  SECRET_CLASSES,
  checkAgentPermissions,
  checkAutostart,
  checkIgnoreRules,
  checkLogMailer,
  checkSecrets,
  formatReport,
  ignoreFindings,
  readTracked,
  repoContext,
  report,
  scanAgentPermissions,
  scanLines,
  splitRules,
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

/* ------------------------------------------------------- machine-specific tooling (F-24) */

test('F-24: no tracked script installs a logon autostart', () => {
  const r = checkAutostart(ctx());
  assert.ok(r.examined > 0, 'no tracked script files examined');
  assert.deepEqual(listed(r.findings), []);
});

test('autostart classes fire on planted samples in scripts, not in docs', () => {
  const lines = [
    "$startup = [Environment]::GetFolderPath('Startup')",
    'New-ItemProperty -Path HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run -Name x',
    'schtasks /create /tn x /tr y /sc onlogon',
  ];
  const { findings, examined } = scanLines(
    [
      { path: 'scripts/planted.ps1', text: lines.join('\n') },
      { path: 'docs/planted.md', text: lines.join('\n') },
    ],
    AUTOSTART_CLASSES,
  );
  assert.equal(examined, 1);
  assert.deepEqual(listed(findings), [
    'autostart-startup-folder\tscripts/planted.ps1:1',
    'autostart-run-key\tscripts/planted.ps1:2',
    'autostart-scheduled-task\tscripts/planted.ps1:3',
  ]);
});

test('F-24: agent commands pre-approve only exact, read-only tools and cannot run on their own', () => {
  const r = checkAgentPermissions(ctx());
  assert.ok(r.examined >= 2, `only ${r.examined} agent files and rules examined`);
  assert.deepEqual(listed(r.findings), []);
});

test('agent permission classes fire on the previous /wlan frontmatter', () => {
  const previous = [
    '---',
    'description: planted',
    'allowed-tools: Read, Edit, Write, Bash(curl:*), Bash(ping:*), Bash(powershell.exe:*), Bash(npm run server:*)',
    '---',
    'body',
  ].join('\n');
  const settings = JSON.stringify({ permissions: { allow: ['Bash', 'Edit(./src/**)', 'Read'] } }, null, 2);
  const { findings, examined } = scanAgentPermissions([
    { path: '.claude/commands/planted.md', text: previous },
    { path: '.claude/settings.json', text: settings },
  ]);
  assert.equal(examined, 2 + 7 + 3);
  assert.deepEqual(listed(findings), [
    'agent-unscoped-write\t.claude/commands/planted.md:3',
    'agent-unscoped-write\t.claude/commands/planted.md:3',
    'agent-shell-wildcard\t.claude/commands/planted.md:3',
    'agent-shell-wildcard\t.claude/commands/planted.md:3',
    'agent-shell-wildcard\t.claude/commands/planted.md:3',
    'agent-shell-interpreter\t.claude/commands/planted.md:3',
    'agent-shell-wildcard\t.claude/commands/planted.md:3',
    'agent-shell-interpreter\t.claude/commands/planted.md:3',
    'agent-model-invocable\t.claude/commands/planted.md:1',
    'agent-shell-wildcard\t.claude/settings.json:4',
    'agent-unscoped-write\t.claude/settings.json:5',
  ]);
  assert.deepEqual(splitRules('Read(./a, b), Bash(ls)'), ['Read(./a, b)', 'Bash(ls)']);
});

/* ------------------------------------------------------------------------- secrets (F-35) */

/** One planted sample per secret class, assembled at run time (never literal in this file). */
const at = '@';
const PLANTED = {
  'email-slash-password': `kontakt${at}example.invalid / Planted99x`,
  'email-password-label': `kontakt${at}example.invalid, Passwort: Planted99x`,
  'private-key': `-----BEGIN ${'RSA PRIVATE'} KEY-----`,
  'anthropic-api-key': `${'sk-'}${'ant-'}${'A'.repeat(24)}`,
  'github-token': `${'gh'}${'p_'}${'a'.repeat(36)}`,
  'aws-access-key-id': `${'AK'}${'IA'}${'ABCDEFGHIJKLMNOP'}`,
  'stripe-live-key': `${'sk'}${'_live_'}${'x'.repeat(12)}`,
  'google-api-key': `${'AI'}${'za'}${'B'.repeat(35)}`,
  'slack-token': `${'xo'}${'xb-'}${'1'.repeat(12)}`,
  'url-embedded-credentials': `https://user:${'planted'}pw${at}host.invalid/`,
};

test('F-35: tracked files contain no e-mail/password pair or provider token', () => {
  const r = checkSecrets(ctx());
  assert.ok(r.examined > 100, `only ${r.examined} text files examined`);
  assert.deepEqual(listed(r.findings), []);
});

test('every secret class fires on its planted sample', () => {
  assert.deepEqual(Object.keys(PLANTED).sort(), SECRET_CLASSES.map((c) => c.cls).sort());
  for (const [cls, sample] of Object.entries(PLANTED)) {
    const { findings } = scanLines([{ path: 'notes/planted.md', text: `line one\n${sample}\n` }], SECRET_CLASSES);
    assert.ok(
      findings.some((f) => f.cls === cls && f.location === 'notes/planted.md:2'),
      `${cls} did not fire on its sample`,
    );
  }
  // The label class is for docs only: fixtures in code pair addresses and passwords on purpose.
  const inCode = scanLines([{ path: 'test/fixture.js', text: PLANTED['email-password-label'] }], SECRET_CLASSES);
  assert.ok(!inCode.findings.some((f) => f.cls === 'email-password-label'));
});

test('secret findings never contain the matched text', () => {
  const text = Object.values(PLANTED).join('\n');
  const { findings } = scanLines([{ path: 'notes/planted.md', text }], SECRET_CLASSES);
  assert.ok(findings.length >= Object.keys(PLANTED).length);
  const out = formatReport(report('secrets', 1, findings));
  for (const sample of Object.values(PLANTED)) {
    assert.ok(!out.includes(sample.slice(-8)), 'a finding repeats the matched text');
  }
});

/* ------------------------------------------------------------------------------ dev mail */

test('dev mail: no tracked config selects the log mailer', () => {
  const r = checkLogMailer(ctx());
  assert.ok(r.examined > 100);
  assert.deepEqual(listed(r.findings), []);
});

test('log-mailer classes fire on planted env, YAML, compose and PHP lines', () => {
  const key = 'MAIL_' + 'MAILER';
  const lines = [
    `${key}=log`,
    `      ${key}: log`,
    `      ${key}: \${${key}:-log}`,
    `    'default' => env('${key}', 'log'),`,
    `${key}=smtp`,
  ];
  const { findings } = scanLines([{ path: 'planted.txt', text: lines.join('\n') }], LOG_MAILER_CLASSES);
  assert.deepEqual(listed(findings), [
    'log-mailer\tplanted.txt:1',
    'log-mailer\tplanted.txt:2',
    'log-mailer-default\tplanted.txt:3',
    'log-mailer-default\tplanted.txt:4',
  ]);
});
