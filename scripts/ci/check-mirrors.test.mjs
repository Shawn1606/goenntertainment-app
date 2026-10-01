import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { REPO_ROOT, checkMirrors } from './check-mirrors.mjs';

// A fixture tree with every mirrored file; each test changes one of them.
const FILES = {
  '.github/workflows/ci.yml': [
    'env:',
    "  NODE_VERSION: '22'",
    "  PHP_VERSION: '8.4'",
    'jobs:',
    '  server:',
    '    services:',
    '      mysql:',
    '        image: mysql:8.4',
    '  schema-drift:',
    '    services:',
    '      mysql:',
    '        image: mysql:8.4',
    '',
  ].join('\n'),
  'server/Dockerfile': 'FROM node:22-alpine\nWORKDIR /app\n',
  'api/Dockerfile': 'FROM php:8.4-apache\nCOPY --from=composer:2 /usr/bin/composer /usr/bin/composer\n',
  'api/composer.json': JSON.stringify({ require: { php: '^8.4', 'laravel/framework': '^13.0' } }, null, 4),
  'deploy/docker-compose.yml': 'services:\n  db:\n    image: mysql:8.4\n',
};

function withTree(overrides, fn) {
  const root = mkdtempSync(join(tmpdir(), 'check-mirrors-'));
  try {
    for (const [file, text] of Object.entries({ ...FILES, ...overrides })) {
      if (text === null) continue;
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), text);
    }
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('agrees on a consistent tree and reports its denominator', () => {
  withTree({}, (root) => {
    const r = checkMirrors(root);
    assert.deepEqual(r.problems, []);
    assert.equal(r.values, 3);
    assert.equal(r.places, 7);
    assert.equal(r.occurrences, 8, 'two mysql services in ci.yml count separately');
  });
});

test('detects a Node major that differs between ci.yml and server/Dockerfile', () => {
  withTree({ 'server/Dockerfile': 'FROM node:24-alpine@sha256:' + 'c'.repeat(64) + '\n' }, (root) => {
    const r = checkMirrors(root);
    assert.equal(r.problems.length, 1);
    assert.match(r.problems[0], /^Node major differs: 22 \(\.github\/workflows\/ci\.yml NODE_VERSION\), 24 \(server\/Dockerfile FROM node:\)$/);
  });
});

test('detects a PHP version that differs between ci.yml, api/Dockerfile and composer.json', () => {
  withTree({ 'api/composer.json': JSON.stringify({ require: { php: '^8.3' } }) }, (root) => {
    const r = checkMirrors(root);
    assert.equal(r.problems.length, 1);
    assert.match(r.problems[0], /^PHP minor differs: .*8\.3 \(api\/composer\.json require\.php\)/);
  });
  withTree({ 'api/Dockerfile': 'FROM php:8.5-apache AS base\n' }, (root) => {
    assert.match(checkMirrors(root).problems[0], /PHP minor differs: .*8\.5 \(api\/Dockerfile FROM php:\)/);
  });
});

test('reads both "^8.4" and "^8.4.1" in composer.json as PHP 8.4', () => {
  for (const php of ['^8.4', '^8.4.1']) {
    withTree({ 'api/composer.json': JSON.stringify({ require: { php } }) }, (root) => {
      assert.deepEqual(checkMirrors(root).problems, [], php);
    });
  }
});

test('detects a MySQL tag that differs between a ci.yml service and deploy/docker-compose.yml', () => {
  const ci = FILES['.github/workflows/ci.yml'].replace(/image: mysql:8\.4\n$/, 'image: mysql:9.1\n');
  withTree({ '.github/workflows/ci.yml': ci }, (root) => {
    const r = checkMirrors(root);
    assert.equal(r.problems.length, 1);
    assert.match(r.problems[0], /^MySQL minor differs: 8\.4 .*, 9\.1 \(\.github\/workflows\/ci\.yml image: mysql:\), 8\.4 \(deploy/);
  });
});

test('accepts digest-pinned images', () => {
  const digest = `@sha256:${'d'.repeat(64)}`;
  withTree({
    'server/Dockerfile': `FROM node:22-alpine${digest}\n`,
    'deploy/docker-compose.yml': `services:\n  db:\n    image: mysql:8.4${digest}\n`,
  }, (root) => {
    assert.deepEqual(checkMirrors(root).problems, []);
  });
});

test('refuses when a value cannot be found or a file is missing (never a silent pass)', () => {
  withTree({ 'api/composer.json': JSON.stringify({ require: { php: '>=8.4' } }), 'server/Dockerfile': null }, (root) => {
    const r = checkMirrors(root);
    assert.deepEqual(r.problems, [
      'Node major: server/Dockerfile not found',
      'PHP minor: cannot find require.php in api/composer.json',
    ]);
  });
});

test('the repository mirrors agree', () => {
  const r = checkMirrors(REPO_ROOT);
  assert.deepEqual(r.problems, []);
  assert.ok(r.occurrences >= 7, `found ${r.occurrences} occurrences`);
});
