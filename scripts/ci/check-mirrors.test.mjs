import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { REPO_ROOT, checkMirrors } from './check-mirrors.mjs';

// A fixture tree with every mirrored file; each test changes one of them.
const MYSQL_DIGEST = `sha256:${'a'.repeat(64)}`;
const FILES = {
  '.github/workflows/ci.yml': [
    'env:',
    "  NODE_VERSION: '22'",
    "  PHP_VERSION: '8.4'",
    'jobs:',
    '  server:',
    '    services:',
    '      mysql:',
    `        image: mysql:8.4@${MYSQL_DIGEST}`,
    '  schema-drift:',
    '    services:',
    '      mysql:',
    `        image: mysql:8.4@${MYSQL_DIGEST}`,
    '',
  ].join('\n'),
  '.github/workflows/docker.yml': "env:\n  # Mirror of NODE_VERSION in ci.yml.\n  NODE_VERSION: '22'\njobs:\n",
  'server/Dockerfile': 'FROM node:22-alpine\nWORKDIR /app\n',
  'api/Dockerfile': 'FROM php:8.4-apache\nCOPY --from=composer:2 /usr/bin/composer /usr/bin/composer\n',
  'api/composer.json': JSON.stringify({ require: { php: '^8.4', 'laravel/framework': '^13.0' } }, null, 4),
  'deploy/docker-compose.yml': [
    'services:',
    '  db:',
    `    image: mysql:8.4@${MYSQL_DIGEST}`,
    '  api:',
    '    environment:',
    '      SANCTUM_EXPIRATION: ${SANCTUM_EXPIRATION:-}',
    '  scheduler:',
    '    environment:',
    '      # The same setting as api.',
    '      SANCTUM_EXPIRATION: ${SANCTUM_EXPIRATION:-}',
    'volumes:',
    '  db-data:',
    '',
  ].join('\n'),
  'deploy/.env.example': '# --- Sessions (optional) ---\n# SANCTUM_EXPIRATION=43200\n',
  'api/app/Support/Sessions.php': [
    '<?php',
    'final class Sessions',
    '{',
    '    public const DEFAULT_LIFETIME_MINUTES = 43200;',
    '',
    '    public static function lifetimeFromEnv(mixed $raw): int',
    '    {',
    "        if (is_string($raw) && preg_match('/^[1-9]\\d{0,6}$/', trim($raw)) === 1) {",
    '            return (int) trim($raw);',
    '        }',
    '    }',
    '}',
    '',
  ].join('\n'),
  'server/src/config.js': [
    'export const INTERNAL_SECRET_MIN_LENGTH = 32;',
    'export const DEFAULT_TOKEN_LIFETIME_MINUTES = 43200;',
    'export const TOKEN_LIFETIME_PATTERN = /^[1-9]\\d{0,6}$/;',
    'export const USAGE_RETENTION_MIN_DAYS = 120;',
    '',
  ].join('\n'),
  'server/src/streak.js': "import { pool } from './db.js';\nexport const ACTIVE_DAYS_WINDOW = 120;\n",
  'server/.env.example': 'PORT=8001\r\nNODE_INTERNAL_SECRET=dev-only-fixture-not-a-secret-0000000000\r\n# SANCTUM_EXPIRATION=43200\r\n',
  'api/.env.example': 'APP_NAME=Laravel\n# SANCTUM_EXPIRATION=43200\n',
  'server/src/uploads.js': '/** Largest image. */\nexport const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;\n',
  'api/app/Support/Uploads.php': '<?php\nfinal class Uploads\n{\n    public const MAX_KB = 5120;\n}\n',
  'server/src/rate-limit.js': "export const RATE_LIMIT_MESSAGE = 'Zu viele Versuche – bitte warte kurz.';\n",
  'api/app/Providers/AppServiceProvider.php': "<?php\n        fn () => response()->json(['message' => 'Zu viele Versuche – bitte warte kurz.'], 429);\n",
  'server/src/activity-pages.js': 'export const PAST_AFTER_HOURS = 3;\nexport const PAGE_SIZE_DEFAULT = 50;\nexport const PAGE_SIZE_MAX = 100;\n',
  'src/domain/activity-pages.ts': 'export const ACTIVITY_PAGE_SIZE = 100;\nexport const MAX_ACTIVITY_PAGES = 1000;\n',
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
    assert.equal(r.values, 16);
    assert.equal(r.places, 37);
    assert.equal(r.occurrences, 39, 'two mysql services in ci.yml count separately, for the tag and for the digest');
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

test('detects a token lifetime default that differs between Laravel, Node and an example', () => {
  withTree({ 'deploy/.env.example': '# SANCTUM_EXPIRATION=1440\n' }, (root) => {
    const r = checkMirrors(root);
    assert.equal(r.problems.length, 1);
    assert.match(r.problems[0], /^Token lifetime default \(minutes\) differs: 43200 \(api\/app\/Support\/Sessions\.php .*, 1440 \(deploy\/\.env\.example # SANCTUM_EXPIRATION=\)$/);
  });
  withTree({ 'server/src/config.js': FILES['server/src/config.js'].replace('= 43200;', '= 1440;') }, (root) => {
    assert.match(checkMirrors(root).problems[0], /^Token lifetime default \(minutes\) differs: .*1440 \(server\/src\/config\.js DEFAULT_TOKEN_LIFETIME_MINUTES\)/);
  });
});

test('detects a token lifetime format that one backend accepts and the other refuses', () => {
  withTree({ 'server/src/config.js': FILES['server/src/config.js'].replace('\\d{0,6}', '\\d{0,8}') }, (root) => {
    const r = checkMirrors(root);
    assert.equal(r.problems.length, 1);
    assert.match(r.problems[0], /^Token lifetime format \(SANCTUM_EXPIRATION\) differs: /);
  });
});

test('detects a deploy that does not hand SANCTUM_EXPIRATION to both containers alike', () => {
  const compose = FILES['deploy/docker-compose.yml'];
  withTree({ 'deploy/docker-compose.yml': compose.replace('      # The same setting as api.\n      SANCTUM_EXPIRATION: ${SANCTUM_EXPIRATION:-}\n', '') }, (root) => {
    assert.deepEqual(checkMirrors(root).problems, [
      'SANCTUM_EXPIRATION in the deploy: cannot find scheduler SANCTUM_EXPIRATION in deploy/docker-compose.yml',
    ]);
  });
  withTree({ 'deploy/docker-compose.yml': compose.replace('  api:\n    environment:\n      SANCTUM_EXPIRATION: ${SANCTUM_EXPIRATION:-}', '  api:\n    environment:\n      SANCTUM_EXPIRATION: ${SANCTUM_EXPIRATION:-1440}') }, (root) => {
    const r = checkMirrors(root);
    assert.equal(r.problems.length, 1);
    assert.match(r.problems[0], /^SANCTUM_EXPIRATION in the deploy differs: \$\{SANCTUM_EXPIRATION:-1440\} \(deploy\/docker-compose\.yml api .*\), \$\{SANCTUM_EXPIRATION:-\} \(deploy\/docker-compose\.yml scheduler /);
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
  withTree({ 'api/app/Support/Uploads.php': '<?php\nfinal class Uploads\n{\n    public const MAX_KB = 8192;\n}\n' }, (root) => {
    const r = checkMirrors(root);
    assert.equal(r.problems.length, 1);
    assert.match(r.problems[0], /^Upload size limit \(MB\) differs: 8 \(api\/app\/Support\/Uploads\.php MAX_KB\), 5 \(server\/src\/uploads\.js MAX_UPLOAD_BYTES\)$/);
  });
  // Not a whole number of MB: not found, never a pass.
  withTree({ 'api/app/Support/Uploads.php': '<?php\nfinal class Uploads\n{\n    public const MAX_KB = 5000;\n}\n' }, (root) => {
    assert.deepEqual(checkMirrors(root).problems, ['Upload size limit (MB): cannot find MAX_KB in api/app/Support/Uploads.php']);
  });
  withTree({ 'server/src/uploads.js': 'export const MAX_UPLOAD_BYTES = 5242880;\n' }, (root) => {
    assert.deepEqual(checkMirrors(root).problems, [
      'Upload size limit (MB): cannot find MAX_UPLOAD_BYTES in server/src/uploads.js',
    ]);
  });
});

test('detects an event-list page size the app asks for that is not the server maximum', () => {
  withTree({ 'src/domain/activity-pages.ts': 'export const ACTIVITY_PAGE_SIZE = 50;\n' }, (root) => {
    const r = checkMirrors(root);
    assert.equal(r.problems.length, 1);
    assert.match(r.problems[0], /^Event list page size differs: 100 \(server\/src\/activity-pages\.js PAGE_SIZE_MAX\), 50 /);
  });
});

test('detects a smallest usage retention that is not the streak window', () => {
  const config = FILES['server/src/config.js'].replace('USAGE_RETENTION_MIN_DAYS = 120', 'USAGE_RETENTION_MIN_DAYS = 90');
  withTree({ 'server/src/config.js': config }, (root) => {
    const r = checkMirrors(root);
    assert.equal(r.problems.length, 1);
    assert.match(r.problems[0], /^Streak window \(days\) differs: 120 \(server\/src\/streak\.js ACTIVE_DAYS_WINDOW\), 90 /);
  });
  withTree({ 'server/src/streak.js': "import { pool } from './db.js';\nexport const ACTIVE_DAYS_WINDOW = 90;\n" }, (root) => {
    const r = checkMirrors(root);
    assert.equal(r.problems.length, 1);
    assert.match(r.problems[0], /^Streak window \(days\) differs: /);
  });
});

test('detects a Node major that differs between ci.yml and server/Dockerfile', () => {
  withTree({ 'server/Dockerfile': 'FROM node:24-alpine@sha256:' + 'c'.repeat(64) + '\n' }, (root) => {
    const r = checkMirrors(root);
    assert.equal(r.problems.length, 1);
    assert.match(r.problems[0], /^Node major differs: 22 \(\.github\/workflows\/ci\.yml NODE_VERSION\), 22 \(\.github\/workflows\/docker\.yml NODE_VERSION\), 24 \(server\/Dockerfile FROM node:\)$/);
  });
});

test('detects a Node major in docker.yml (the deploy tests) that differs from ci.yml, or is missing there', () => {
  withTree({ '.github/workflows/docker.yml': "env:\n  NODE_VERSION: '24'\n" }, (root) => {
    const r = checkMirrors(root);
    assert.equal(r.problems.length, 1);
    assert.match(r.problems[0], /^Node major differs: 22 \(\.github\/workflows\/ci\.yml NODE_VERSION\), 24 \(\.github\/workflows\/docker\.yml NODE_VERSION\), 22 \(server\/Dockerfile FROM node:\)$/);
  });
  withTree({ '.github/workflows/docker.yml': 'env: {}\n' }, (root) => {
    assert.deepEqual(checkMirrors(root).problems, ['Node major: cannot find NODE_VERSION in .github/workflows/docker.yml']);
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
  const ci = FILES['.github/workflows/ci.yml'].replace(/image: mysql:8\.4(@sha256:a{64})\n$/, 'image: mysql:9.1$1\n');
  withTree({ '.github/workflows/ci.yml': ci }, (root) => {
    const r = checkMirrors(root);
    assert.equal(r.problems.length, 1);
    assert.match(r.problems[0], /^MySQL minor differs: 8\.4 .*, 9\.1 \(\.github\/workflows\/ci\.yml image: mysql:\), 8\.4 \(deploy/);
  });
});

test('detects a MySQL digest that differs between a ci.yml service and deploy/docker-compose.yml', () => {
  const ci = FILES['.github/workflows/ci.yml'].replace(/@sha256:a{64}\n$/, `@sha256:${'b'.repeat(64)}\n`);
  withTree({ '.github/workflows/ci.yml': ci }, (root) => {
    const r = checkMirrors(root);
    assert.equal(r.problems.length, 1, JSON.stringify(r.problems));
    assert.match(
      r.problems[0],
      /^MySQL image digest differs: sha256:a{64} \(\.github\/workflows\/ci\.yml .*\), sha256:b{64} \(\.github\/workflows\/ci\.yml .*\), sha256:a{64} \(deploy\/docker-compose\.yml /,
    );
  });
});

test('refuses a MySQL image without a digest in CI or in the deploy (never a silent pass)', () => {
  const compose = FILES['deploy/docker-compose.yml'].replace(`image: mysql:8.4@${MYSQL_DIGEST}`, 'image: mysql:8.4');
  withTree({ 'deploy/docker-compose.yml': compose }, (root) => {
    assert.deepEqual(checkMirrors(root).problems, [
      'MySQL image digest: cannot find a digest on every image: mysql: line in deploy/docker-compose.yml',
    ]);
  });
  const ci = FILES['.github/workflows/ci.yml'].replace(`image: mysql:8.4@${MYSQL_DIGEST}\n  schema-drift:`, 'image: mysql:8.4\n  schema-drift:');
  withTree({ '.github/workflows/ci.yml': ci }, (root) => {
    assert.deepEqual(checkMirrors(root).problems, [
      'MySQL image digest: cannot find a digest on every image: mysql: line in .github/workflows/ci.yml',
    ]);
  });
});

test('accepts digest-pinned images', () => {
  const digest = `@sha256:${'d'.repeat(64)}`;
  withTree({
    'server/Dockerfile': `FROM node:22-alpine${digest}\n`,
    'deploy/docker-compose.yml': FILES['deploy/docker-compose.yml'].replaceAll(`@${MYSQL_DIGEST}`, digest),
    '.github/workflows/ci.yml': FILES['.github/workflows/ci.yml'].replaceAll(`@${MYSQL_DIGEST}`, digest),
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
