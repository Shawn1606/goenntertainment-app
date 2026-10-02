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
  'server/src/config.js': 'export const INTERNAL_SECRET_MIN_LENGTH = 32;\n',
  'api/app/Support/NodeInternal.php': '<?php\nfinal class NodeInternal\n{\n    public const SECRET_MIN_LENGTH = 32;\n}\n',
  'api/docker/entrypoint.sh': 'if [ -n "$NODE_FALLBACK_URL" ] && [ "${#NODE_INTERNAL_SECRET}" -lt 32 ]; then\n  exit 1\nfi\n',
  'api/.env.example': 'APP_NAME=Laravel\nNODE_INTERNAL_SECRET=dev-only-fixture-not-a-secret-0000000000\n',
  'server/.env.example': 'PORT=8001\r\nNODE_INTERNAL_SECRET=dev-only-fixture-not-a-secret-0000000000\r\n',
  'server/src/uploads.js': '/** Largest image. */\nexport const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;\n',
  'api/app/Http/Controllers/NodeFallbackController.php': '<?php\n        $nodeLimit = 5 * 1024 ** 2;\n',
  'server/src/rate-limit.js': "export const RATE_LIMIT_MESSAGE = 'Zu viele Versuche – bitte warte kurz.';\n",
  'api/app/Providers/AppServiceProvider.php': "<?php\n        fn () => response()->json(['message' => 'Zu viele Versuche – bitte warte kurz.'], 429);\n",
  'src/app/create-activity.tsx': "import x from 'y';\nconst MAX_INTERESTS = 5;\n",
  'server/src/routes/activities.js': '/** Interests. */\nconst MAX_INTERESTS = 5;\n',
  'server/src/app.js': [
    "export const JSON_LIMIT = '32kb';",
    "export const WEBHOOK_JSON_LIMIT = '128kb';",
    "export const URLENCODED_LIMIT = '16kb';",
    "  app.use('/api/webhooks/revenuecat', express.json({ limit: WEBHOOK_JSON_LIMIT }));",
    '  app.use(express.json({ limit: JSON_LIMIT }));',
    '',
  ].join('\n'),
  'server/src/client-errors.js': "export const MSG_TOO_LARGE = 'Die Anfrage ist zu groß.';\n",
  'api/app/Http/Middleware/LimitRequestBody.php': [
    '<?php',
    'final class LimitRequestBody',
    '{',
    '    public const JSON_LIMIT_KB = 32;',
    '    public const WEBHOOK_JSON_LIMIT_KB = 128;',
    '    public const URLENCODED_LIMIT_KB = 16;',
    "    public const WEBHOOK_PATH = '/api/webhooks/revenuecat';",
    "    public const MSG_TOO_LARGE = 'Die Anfrage ist zu groß.';",
    '}',
    '',
  ].join('\n'),
};

const LIMIT_REQUEST_BODY = 'api/app/Http/Middleware/LimitRequestBody.php';

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
    assert.equal(r.values, 13);
    assert.equal(r.places, 28);
    assert.equal(r.occurrences, 29, 'two mysql services in ci.yml count separately');
  });
});

test('detects request body limits that differ between Node and Laravel', () => {
  const php = FILES[LIMIT_REQUEST_BODY];
  const cases = [
    [{ [LIMIT_REQUEST_BODY]: php.replace('JSON_LIMIT_KB = 32;', 'JSON_LIMIT_KB = 64;') },
      /^JSON body limit \(kB\) differs: 32 \(server\/src\/app\.js JSON_LIMIT\), 64 \(api\/app\/Http\/Middleware\/LimitRequestBody\.php JSON_LIMIT_KB\)$/],
    [{ 'server/src/app.js': FILES['server/src/app.js'].replace("'128kb'", "'256kb'") },
      /^Webhook JSON body limit \(kB\) differs: 256 \(server\/src\/app\.js WEBHOOK_JSON_LIMIT\), 128 /],
    [{ [LIMIT_REQUEST_BODY]: php.replace('URLENCODED_LIMIT_KB = 16;', 'URLENCODED_LIMIT_KB = 32;') },
      /^Urlencoded body limit \(kB\) differs: 16 .*, 32 /],
    [{ 'server/src/app.js': FILES['server/src/app.js'].replace("app.use('/api/webhooks/revenuecat'", "app.use('/api/webhooks/store'") },
      /^Webhook JSON body limit path differs: \/api\/webhooks\/store .*, \/api\/webhooks\/revenuecat /],
    [{ 'server/src/client-errors.js': "export const MSG_TOO_LARGE = 'Zu groß.';\n" },
      /^Body too large message differs: Zu groß\. /],
  ];
  for (const [overrides, expected] of cases) {
    withTree(overrides, (root) => {
      const r = checkMirrors(root);
      assert.equal(r.problems.length, 1, JSON.stringify(r.problems));
      assert.match(r.problems[0], expected);
    });
  }
});

test('refuses a body limit it cannot read, such as one written in bytes or MB', () => {
  withTree({ 'server/src/app.js': FILES['server/src/app.js'].replace("JSON_LIMIT = '32kb'", "JSON_LIMIT = '0.03mb'") }, (root) => {
    assert.deepEqual(checkMirrors(root).problems, ['JSON body limit (kB): cannot find JSON_LIMIT in server/src/app.js']);
  });
  withTree({ [LIMIT_REQUEST_BODY]: null }, (root) => {
    assert.deepEqual(checkMirrors(root).problems, [
      `JSON body limit (kB): ${LIMIT_REQUEST_BODY} not found`,
      `Webhook JSON body limit (kB): ${LIMIT_REQUEST_BODY} not found`,
      `Webhook JSON body limit path: ${LIMIT_REQUEST_BODY} not found`,
      `Urlencoded body limit (kB): ${LIMIT_REQUEST_BODY} not found`,
      `Body too large message: ${LIMIT_REQUEST_BODY} not found`,
    ]);
  });
});

test('detects a 429 message that differs between Node and Laravel', () => {
  withTree({ 'server/src/rate-limit.js': "export const RATE_LIMIT_MESSAGE = 'Zu viele Versuche – warte.';\n" }, (root) => {
    const r = checkMirrors(root);
    assert.equal(r.problems.length, 1);
    assert.match(r.problems[0], /^Rate limit message differs: /);
  });
  withTree({ 'api/app/Providers/AppServiceProvider.php': "<?php\n        ['message' => 'Too Many Attempts.'];\n" }, (root) => {
    assert.deepEqual(checkMirrors(root).problems, [
      "Rate limit message: cannot find 'Zu viele Versuche ...' message in api/app/Providers/AppServiceProvider.php",
    ]);
  });
});

test('detects an upload size limit that differs between Node and Laravel', () => {
  withTree({ 'api/app/Http/Controllers/NodeFallbackController.php': '<?php\n        $nodeLimit = 8 * 1024 ** 2;\n' }, (root) => {
    const r = checkMirrors(root);
    assert.equal(r.problems.length, 1);
    assert.match(r.problems[0], /^Upload size limit \(MB\) differs: 5 \(server\/src\/uploads\.js MAX_UPLOAD_BYTES\), 8 \(api\/app\/Http\/Controllers\/NodeFallbackController\.php \$nodeLimit\)$/);
  });
  withTree({ 'server/src/uploads.js': 'export const MAX_UPLOAD_BYTES = 5242880;\n' }, (root) => {
    assert.deepEqual(checkMirrors(root).problems, [
      'Upload size limit (MB): cannot find MAX_UPLOAD_BYTES in server/src/uploads.js',
    ]);
  });
});

test('detects an interests-per-event maximum that differs between the app and the server', () => {
  withTree({ 'server/src/routes/activities.js': 'const MAX_INTERESTS = 6;\n' }, (root) => {
    const r = checkMirrors(root);
    assert.equal(r.problems.length, 1);
    assert.match(r.problems[0], /^Interests per event differs: 5 \(src\/app\/create-activity\.tsx MAX_INTERESTS\), 6 /);
  });
});

test('detects an internal secret minimum length that differs between Node, Laravel and the container', () => {
  withTree({ 'api/app/Support/NodeInternal.php': '<?php\nfinal class NodeInternal\n{\n    public const SECRET_MIN_LENGTH = 24;\n}\n' }, (root) => {
    const r = checkMirrors(root);
    assert.equal(r.problems.length, 1);
    assert.match(r.problems[0], /^Internal secret minimum length differs: 32 \(server\/src\/config\.js .*\), 24 \(api\/app\/Support\/NodeInternal\.php .*\), 32 \(api\/docker\/entrypoint\.sh .*\)$/);
  });
  withTree({ 'api/docker/entrypoint.sh': 'exit 0\n' }, (root) => {
    assert.deepEqual(checkMirrors(root).problems, [
      'Internal secret minimum length: cannot find NODE_INTERNAL_SECRET length check in api/docker/entrypoint.sh',
    ]);
  });
});

test('detects development internal secrets that differ between api/ and server/', () => {
  withTree({ 'server/.env.example': 'NODE_INTERNAL_SECRET=dev-only-other-not-a-secret-00000000000\n' }, (root) => {
    const r = checkMirrors(root);
    assert.equal(r.problems.length, 1);
    assert.match(r.problems[0], /^Development NODE_INTERNAL_SECRET differs: /);
  });
  withTree({ 'api/.env.example': 'APP_NAME=Laravel\nNODE_INTERNAL_SECRET=\n' }, (root) => {
    assert.deepEqual(checkMirrors(root).problems, [
      'Development NODE_INTERNAL_SECRET: cannot find NODE_INTERNAL_SECRET in api/.env.example',
    ]);
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
