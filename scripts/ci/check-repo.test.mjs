/**
 * Tests for scripts/ci/check-repo.mjs.
 *
 * Two kinds per check: the real repository must be clean (these fail on a tree that still has
 * the problem), and every finding class must fire on a planted sample (proves the check can fail
 * at all). Planted samples are built at run time and never appear literally in this file (the
 * repository scan reads it). Most are scanned in memory; the tests of what the reader skips write
 * theirs to a temporary directory and remove it afterwards.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  main,
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
  assert.equal(files.length + binary.length + missing.length, paths.length);
  assert.ok(binary.length > 0, 'the repository has images; none was recognised as binary');
  assert.ok(binary.every((p) => paths.includes(p)) && missing.every((p) => paths.includes(p)));
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

/** An agent file whose frontmatter is `description` (line 2) followed by the given lines (from line 3). */
const agentFile = (filePath, ...frontmatter) => ({
  path: filePath,
  text: ['---', 'description: planted', ...frontmatter, '---', 'body'].join('\n'),
});

test('agent permissions: quoted, flow-list and space-separated allowed-tools read like the plain list', () => {
  const { findings, examined } = scanAgentPermissions([
    agentFile('.claude/commands/quoted.md', 'allowed-tools: "Bash, Write"'),
    agentFile('.claude/commands/single.md', "allowed-tools: 'Bash(curl:*)'"),
    agentFile('.claude/commands/flow.md', 'allowed-tools: [Bash, "Write"]'),
    agentFile('.claude/commands/spaces.md', 'allowed-tools: Read Bash(git status) Edit'),
    agentFile('.claude/commands/keys.md', '"allowed-tools" : Write', 'disable-model-invocation: true'),
  ]);
  assert.equal(examined, 5 + 2 + 1 + 2 + 3 + 1);
  assert.deepEqual(listed(findings), [
    'agent-shell-wildcard\t.claude/commands/quoted.md:3',
    'agent-unscoped-write\t.claude/commands/quoted.md:3',
    'agent-model-invocable\t.claude/commands/quoted.md:1',
    'agent-shell-wildcard\t.claude/commands/single.md:3',
    'agent-model-invocable\t.claude/commands/single.md:1',
    'agent-shell-wildcard\t.claude/commands/flow.md:3',
    'agent-unscoped-write\t.claude/commands/flow.md:3',
    'agent-model-invocable\t.claude/commands/flow.md:1',
    'agent-unscoped-write\t.claude/commands/spaces.md:3',
    'agent-model-invocable\t.claude/commands/spaces.md:1',
    'agent-unscoped-write\t.claude/commands/keys.md:3',
  ]);
});

test('agent permissions: block lists and continuation lines are read item by item', () => {
  const { findings, examined } = scanAgentPermissions([
    agentFile(
      '.claude/commands/block.md',
      'allowed-tools:',
      '  - Read',
      '  - "Bash(curl:*)"',
      '',
      "  - 'Write'",
      'disable-model-invocation: false',
    ),
    agentFile('.claude/commands/flush.md', 'allowed-tools:', '- Edit', 'model: planted'),
    agentFile('.claude/commands/folded.md', 'allowed-tools: Read,', '  Grep, Edit'),
  ]);
  assert.equal(examined, 3 + 3 + 1 + 3);
  assert.deepEqual(listed(findings), [
    'agent-shell-wildcard\t.claude/commands/block.md:5',
    'agent-unscoped-write\t.claude/commands/block.md:7',
    'agent-model-invocable\t.claude/commands/block.md:1',
    'agent-unscoped-write\t.claude/commands/flush.md:4',
    'agent-model-invocable\t.claude/commands/flush.md:1',
    'agent-unscoped-write\t.claude/commands/folded.md:4',
    'agent-model-invocable\t.claude/commands/folded.md:1',
  ]);
});

test('agent permissions: skills and nested .claude directories are checked; skills count as model-invocable', () => {
  const { findings, examined } = scanAgentPermissions([
    agentFile('.claude/skills/planted/SKILL.md', 'allowed-tools: Bash(curl:*)'),
    { path: '.claude/skills/planted/reference.md', text: 'notes without frontmatter' },
    agentFile('api/.claude/commands/nested.md', 'allowed-tools: Write'),
    // Sub-agents are not slash commands: no model-invocable finding, but their rules are checked.
    agentFile('.claude/agents/helper.md', 'allowed-tools: Write'),
    { path: 'docs/.claude-notes/commands/x.md', text: agentFile('', 'allowed-tools: Write').text },
  ]);
  assert.equal(examined, 4 + 3);
  assert.deepEqual(listed(findings), [
    'agent-shell-wildcard\t.claude/skills/planted/SKILL.md:3',
    'agent-model-invocable\t.claude/skills/planted/SKILL.md:1',
    'agent-unscoped-write\tapi/.claude/commands/nested.md:3',
    'agent-model-invocable\tapi/.claude/commands/nested.md:1',
    'agent-unscoped-write\t.claude/agents/helper.md:3',
  ]);
});

test('agent permissions: a token that is not a rule is a finding, never skipped', () => {
  const settings = JSON.stringify({ permissions: { allow: ['Read', 42, 'Bash(ls'] } }, null, 2);
  const { findings } = scanAgentPermissions([
    agentFile('.claude/commands/quote.md', 'allowed-tools: Read, "Write, Grep', 'disable-model-invocation: true'),
    agentFile('.claude/commands/comment.md', 'allowed-tools: Read # read-only', 'disable-model-invocation: true'),
    agentFile('.claude/commands/bracket.md', 'allowed-tools: [Read, Grep', 'disable-model-invocation: true'),
    agentFile('.claude/commands/scalar.md', 'allowed-tools: >', '  Read', 'disable-model-invocation: true'),
    { path: '.claude/settings.json', text: settings },
  ]);
  assert.deepEqual(listed(findings), [
    'agent-unparsed-rule\t.claude/commands/quote.md:3',
    'agent-unparsed-rule\t.claude/commands/comment.md:3',
    'agent-unparsed-rule\t.claude/commands/comment.md:3',
    'agent-unparsed-rule\t.claude/commands/bracket.md:3',
    'agent-unparsed-rule\t.claude/commands/scalar.md:3',
    'agent-unparsed-rule\t.claude/settings.json:5',
    'agent-unparsed-rule\t.claude/settings.json:6',
  ]);
});

test('agent permissions: MCP tool names and every spelling of a true disable-model-invocation are accepted', () => {
  const { findings, examined } = scanAgentPermissions([
    agentFile(
      '.claude/commands/mcp.md',
      'allowed-tools: mcp__srv__tool, mcp__srv__*, mcp__planted-server__read_item, Read(./docs/**), WebFetch(domain:example.invalid)',
      'disable-model-invocation: yes',
    ),
    agentFile('.claude/skills/x/SKILL.md', 'allowed-tools: Grep', 'disable-model-invocation: On'),
    agentFile('.claude/commands/one.md', 'allowed-tools: Glob', 'disable-model-invocation: 1'),
    agentFile('.claude/commands/upper.md', 'allowed-tools: Glob', 'disable-model-invocation: TRUE'),
  ]);
  assert.equal(examined, 4 + 5 + 1 + 1 + 1);
  assert.deepEqual(listed(findings), []);
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

test('url-embedded-credentials does not read an image digest reference as a password', () => {
  const digest = `docker://alpine:3.20${at}sha256:${'b'.repeat(64)}`;
  const { findings } = scanLines([{ path: '.github/workflows/x.yml', text: `      - uses: ${digest}
` }], SECRET_CLASSES);
  assert.deepEqual(findings, []);
  // The real shape still fires on the same line layout.
  const cred = scanLines([{ path: '.github/workflows/x.yml', text: `      url: ${PLANTED['url-embedded-credentials']}
` }], SECRET_CLASSES);
  assert.deepEqual(cred.findings.map((f) => f.cls), ['url-embedded-credentials']);
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

/* ------------------------------------------------------------ files the reader does not scan */

/** Writes `{ relativePath: content }` into a new temporary directory; the caller removes it. */
function plantFiles(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-repo-'));
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  return dir;
}

/** A script that registers a logon task and holds a fake key, assembled at run time. */
const plantedScript = () =>
  [`${'Register-'}${'ScheduledTask'} -TaskName planted -Action $action`, `$key = '${PLANTED['aws-access-key-id']}'`].join('\r\n');
/** How Windows PowerShell 5.1 writes a file by default: UTF-16LE with a byte-order mark. */
const utf16le = (text) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
const utf16be = (text) => Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(text, 'utf16le').swap16()]);
/** The start of a PNG file: NUL bytes early on, as in every image. */
const binaryBytes = () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);

test('UTF-16 files with a BOM are scanned; binary and missing paths are listed; a binary script is a finding', () => {
  const dir = plantFiles({
    'scripts/planted-le.ps1': utf16le(plantedScript()),
    'scripts/planted-be.ps1': utf16be(plantedScript()),
    'scripts/odd.ps1': binaryBytes(),
    'assets/planted.png': binaryBytes(),
    'assets/bom-then-nul.bin': Buffer.from([0xff, 0xfe, 0x00, 0x00, 0x41, 0x00]),
    'notes/plain.md': 'plain text\n',
  });
  try {
    const paths = [
      'scripts/planted-le.ps1',
      'scripts/planted-be.ps1',
      'scripts/odd.ps1',
      'assets/planted.png',
      'assets/bom-then-nul.bin',
      'notes/plain.md',
      'notes/gone.md',
    ];
    const read = readTracked(dir, paths);
    assert.deepEqual(
      read.files.map((f) => f.path),
      ['scripts/planted-le.ps1', 'scripts/planted-be.ps1', 'notes/plain.md'],
    );
    assert.equal(read.files[0].text, plantedScript());
    assert.equal(read.files[1].text, plantedScript());
    assert.deepEqual(read.binary, ['scripts/odd.ps1', 'assets/planted.png', 'assets/bom-then-nul.bin']);
    assert.deepEqual(read.missing, ['notes/gone.md']);

    const planted = { root: dir, paths, ...read };
    const autostart = checkAutostart(planted);
    assert.equal(autostart.examined, 3);
    assert.deepEqual(listed(autostart.findings), [
      'autostart-scheduled-task\tscripts/planted-le.ps1:1',
      'autostart-scheduled-task\tscripts/planted-be.ps1:1',
      'script-not-text\tscripts/odd.ps1',
    ]);
    assert.deepEqual(listed(checkSecrets(planted).findings), [
      'aws-access-key-id\tscripts/planted-le.ps1:2',
      'aws-access-key-id\tscripts/planted-be.ps1:2',
    ]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('main prints what it did not scan before the per-check reports, missing files by path only', () => {
  const dir = plantFiles({
    '.claude/settings.json': JSON.stringify({ permissions: { allow: ['Read'] } }),
    'scripts/planted.ps1': utf16le(plantedScript()),
    'assets/planted.png': binaryBytes(),
    'notes/plain.md': 'plain text\n',
    'notes/gone.md': 'removed from the working tree after staging\n',
  });
  try {
    // core.longpaths: the temporary directory can be deep on Windows (git's object paths pass 260).
    const git = (...args) => execFileSync('git', ['-c', 'core.longpaths=true', '-C', dir, ...args], { stdio: 'pipe' });
    git('init', '-q');
    // -f: a global excludes file of the machine running the tests must not change what is tracked.
    git('add', '-f', '--', '.claude/settings.json', 'scripts/planted.ps1', 'assets/planted.png', 'notes/plain.md', 'notes/gone.md');
    fs.rmSync(path.join(dir, 'notes', 'gone.md'));

    const out = [];
    const code = main(dir, { log: (s) => out.push(s), error: (s) => out.push(`error: ${s}`) });
    const lines = out.join('\n').split('\n');
    assert.deepEqual(lines.slice(0, 2), [
      'check-repo: tracked 5, text 3, not scanned: binary 1, missing 1',
      '  not-scanned-missing\tnotes/gone.md',
    ]);
    assert.match(lines[2], /^ignore-rules\texamined \d+\tfindings \d+$/);
    assert.ok(lines.includes('  autostart-scheduled-task\tscripts/planted.ps1:1'), 'the UTF-16 script was not scanned');
    assert.ok(lines.includes('  aws-access-key-id\tscripts/planted.ps1:2'), 'the UTF-16 script was not scanned');
    assert.ok(!lines.some((l) => l.startsWith('error: ')), lines.find((l) => l.startsWith('error: ')));
    assert.equal(code, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the CLI reports how many tracked files it did not scan, before the per-check reports', () => {
  const cli = fileURLToPath(new URL('./check-repo.mjs', import.meta.url));
  const r = spawnSync(process.execPath, [cli], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  const m = /^check-repo: tracked (\d+), text (\d+), not scanned: binary (\d+), missing (\d+)$/m.exec(r.stdout);
  assert.ok(m, `no not-scanned line; first line: ${r.stdout.split('\n')[0]}`);
  const [tracked, text, binary, missing] = m.slice(1).map(Number);
  assert.equal(text + binary + missing, tracked);
  assert.ok(binary > 0, 'the repository has images; none was counted as binary');
  assert.ok(r.stdout.startsWith(m[0]), 'the not-scanned line must come first');
});
