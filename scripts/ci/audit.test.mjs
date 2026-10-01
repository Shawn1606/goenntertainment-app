import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  REPO_ROOT,
  composerIgnoreProblem,
  evaluate,
  loadAllowSection,
  parseComposerAudit,
  parseNpmAudit,
} from './audit.mjs';

// Shapes as printed by `npm audit --json` (report version 2) and `composer audit --format=json`.
// Package names and ids are made up for the fixtures.
const npmReport = {
  auditReportVersion: 2,
  vulnerabilities: {
    'fixture-lib': {
      name: 'fixture-lib',
      severity: 'moderate',
      via: [
        { source: 1001, name: 'fixture-lib', title: 'Fixture prototype pollution', url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc', severity: 'moderate' },
        { source: 1002, name: 'fixture-lib', title: 'Fixture advisory without GHSA url', url: '', severity: 'low' },
      ],
    },
    'fixture-parent': { name: 'fixture-parent', severity: 'moderate', via: ['fixture-lib'] },
  },
  metadata: { dependencies: { prod: 10, dev: 5, optional: 0, peer: 0, peerOptional: 0, total: 15 } },
};

test('npm: GHSA ids come from via[].url; string via entries (transitive paths) are not advisories', () => {
  const r = parseNpmAudit(npmReport);
  assert.equal(r.examined, 15);
  assert.deepEqual([...r.advisories.keys()].sort(), ['GHSA-aaaa-bbbb-cccc', 'npm-1002']);
  assert.equal(r.advisories.get('GHSA-aaaa-bbbb-cccc').pkg, 'fixture-lib');
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
  const r = evaluate({ examined: 15, advisories, allow: { 'npm-1002': 'dev-only build tool, never shipped' } });
  assert.equal(r.open, 1);
  assert.equal(r.allowListed, 1);
  assert.deepEqual(r.problems, ['GHSA-aaaa-bbbb-cccc fixture-lib (moderate): Fixture prototype pollution']);
});

test('evaluate: passes when every advisory is allow-listed with a reason', () => {
  const { advisories } = parseNpmAudit(npmReport);
  const allow = { 'GHSA-aaaa-bbbb-cccc': 'not reachable: fixture reason', 'npm-1002': 'dev-only build tool, never shipped' };
  assert.deepEqual(evaluate({ examined: 15, advisories, allow }).problems, []);
});

test('evaluate: rejects an allow-list entry without a reason', () => {
  const { advisories } = parseNpmAudit(npmReport);
  const allow = { 'GHSA-aaaa-bbbb-cccc': '  ', 'npm-1002': 'dev-only build tool, never shipped' };
  assert.deepEqual(evaluate({ examined: 15, advisories, allow }).problems, ['allow-list entry GHSA-aaaa-bbbb-cccc has no reason']);
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

test('the repository allow-list has one section per audited lock file and reasons for every entry', () => {
  const data = JSON.parse(readFileSync(join(REPO_ROOT, '.github', 'audit-allowlist.json'), 'utf8'));
  for (const section of ['npm:.', 'npm:server', 'composer:api']) {
    assert.equal(typeof data[section], 'object', section);
    for (const [id, reason] of Object.entries(data[section])) {
      assert.ok(typeof reason === 'string' && reason.trim().length > 0, `${section} ${id} needs a reason`);
    }
  }
});
