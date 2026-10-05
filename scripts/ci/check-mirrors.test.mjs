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
  'deploy/docker-compose.yml': [
    'services:',
    '  db:',
    '    image: mysql:8.4',
    '  node:',
    '    environment:',
    '      # The same setting as api.',
    '      SANCTUM_EXPIRATION: ${SANCTUM_EXPIRATION:-}',
    '  api:',
    '    environment:',
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
  'api/app/Support/Streak.php': '<?php\nfinal class Streak\n{\n    public const ACTIVE_DAYS_WINDOW = 120;\n}\n',
  'api/app/Support/NodeInternal.php': '<?php\nfinal class NodeInternal\n{\n    public const SECRET_MIN_LENGTH = 32;\n}\n',
  'api/docker/entrypoint.sh': 'if [ -n "$NODE_FALLBACK_URL" ] && [ "${#NODE_INTERNAL_SECRET}" -lt 32 ]; then\n  exit 1\nfi\n',
  'api/.env.example': 'APP_NAME=Laravel\nNODE_INTERNAL_SECRET=dev-only-fixture-not-a-secret-0000000000\n# SANCTUM_EXPIRATION=43200\n',
  'server/.env.example': 'PORT=8001\r\nNODE_INTERNAL_SECRET=dev-only-fixture-not-a-secret-0000000000\r\n# SANCTUM_EXPIRATION=43200\r\n',
  'server/src/uploads.js': '/** Largest image. */\nexport const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;\n',
  'api/app/Http/Controllers/NodeFallbackController.php': '<?php\n        $nodeLimit = 5 * 1024 ** 2;\n',
  'server/src/rate-limit.js': "export const RATE_LIMIT_MESSAGE = 'Zu viele Versuche – bitte warte kurz.';\n",
  'api/app/Providers/AppServiceProvider.php': "<?php\n        fn () => response()->json(['message' => 'Zu viele Versuche – bitte warte kurz.'], 429);\n",
  'src/app/create-activity.tsx': "import x from 'y';\nconst MAX_INTERESTS = 5;\n",
  'server/src/routes/activities.js': '/** Interests. */\nconst MAX_INTERESTS = 5;\n',
  'server/src/activity-pages.js': 'export const PAST_AFTER_HOURS = 3;\nexport const PAGE_SIZE_DEFAULT = 50;\nexport const PAGE_SIZE_MAX = 100;\n',
  'src/domain/urgency.ts': 'const HOUR = 60 * MINUTE;\nexport const SOON_MS = 3 * HOUR;\nexport const LIVE_MS = 3 * HOUR;\n',
  'src/app/(app)/index.tsx': '  const feed = useMemo(() => {\n    const cutoff = now.getTime() - 3 * 60 * 60 * 1000;\n',
  'src/app/search.tsx': '/** Vergangenes nicht. */\nconst PAST_CUTOFF_MS = 3 * 60 * 60 * 1000;\n',
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
    assert.equal(r.values, 19);
    assert.equal(r.places, 46);
    assert.equal(r.occurrences, 47, 'two mysql services in ci.yml count separately');
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
      'SANCTUM_EXPIRATION in the deploy: cannot find node SANCTUM_EXPIRATION in deploy/docker-compose.yml',
    ]);
  });
  withTree({ 'deploy/docker-compose.yml': compose.replace('    environment:\n      SANCTUM_EXPIRATION: ${SANCTUM_EXPIRATION:-}', '    environment:\n      SANCTUM_EXPIRATION: ${SANCTUM_EXPIRATION:-1440}') }, (root) => {
    const r = checkMirrors(root);
    assert.equal(r.problems.length, 1);
    assert.match(r.problems[0], /^SANCTUM_EXPIRATION in the deploy differs: \$\{SANCTUM_EXPIRATION:-1440\} \(deploy\/docker-compose\.yml api .*\), \$\{SANCTUM_EXPIRATION:-\} \(deploy\/docker-compose\.yml node /);
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

test('detects an event-over time that differs between the server and the app', () => {
  const cases = [
    ['server/src/activity-pages.js', FILES['server/src/activity-pages.js'].replace('PAST_AFTER_HOURS = 3', 'PAST_AFTER_HOURS = 2'), /^Event over after \(hours\) differs: 2 \(server\/src\/activity-pages\.js PAST_AFTER_HOURS\), 3 /],
    ['src/domain/urgency.ts', FILES['src/domain/urgency.ts'].replace('LIVE_MS = 3 * HOUR', 'LIVE_MS = 4 * HOUR'), /4 \(src\/domain\/urgency\.ts LIVE_MS\)/],
    ['src/app/(app)/index.tsx', FILES['src/app/(app)/index.tsx'].replace('- 3 * 60', '- 6 * 60'), /6 \(src\/app\/\(app\)\/index\.tsx the feed cutoff\)/],
    ['src/app/search.tsx', FILES['src/app/search.tsx'].replace('= 3 * 60', '= 1 * 60'), /1 \(src\/app\/search\.tsx PAST_CUTOFF_MS\)/],
  ];
  for (const [file, text, message] of cases) {
    withTree({ [file]: text }, (root) => {
      const r = checkMirrors(root);
      assert.equal(r.problems.length, 1, file);
      assert.match(r.problems[0], message);
    });
  }
  // Written in milliseconds instead of hours: not found, never a pass.
  withTree({ 'src/domain/urgency.ts': 'export const LIVE_MS = 10800000;\n' }, (root) => {
    assert.deepEqual(checkMirrors(root).problems, ['Event over after (hours): cannot find LIVE_MS in src/domain/urgency.ts']);
  });
});

test('detects an event-list page size the app asks for that is not the server maximum', () => {
  withTree({ 'src/domain/activity-pages.ts': 'export const ACTIVITY_PAGE_SIZE = 50;\n' }, (root) => {
    const r = checkMirrors(root);
    assert.equal(r.problems.length, 1);
    assert.match(r.problems[0], /^Event list page size differs: 100 \(server\/src\/activity-pages\.js PAGE_SIZE_MAX\), 50 /);
  });
});

test('detects a smallest usage retention that is not the streak window of both backends', () => {
  const config = FILES['server/src/config.js'].replace('USAGE_RETENTION_MIN_DAYS = 120', 'USAGE_RETENTION_MIN_DAYS = 90');
  withTree({ 'server/src/config.js': config }, (root) => {
    const r = checkMirrors(root);
    assert.equal(r.problems.length, 1);
    assert.match(
      r.problems[0],
      /^Streak window \(days\) differs: 120 \(server\/src\/streak\.js ACTIVE_DAYS_WINDOW\), 120 \(api\/app\/Support\/Streak\.php ACTIVE_DAYS_WINDOW\), 90 /,
    );
  });
  withTree({ 'api/app/Support/Streak.php': '<?php\nfinal class Streak\n{\n    public const ACTIVE_DAYS_WINDOW = 90;\n}\n' }, (root) => {
    const r = checkMirrors(root);
    assert.equal(r.problems.length, 1);
    assert.match(r.problems[0], /^Streak window \(days\) differs: /);
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
  withTree({ 'server/.env.example': 'NODE_INTERNAL_SECRET=dev-only-other-not-a-secret-00000000000\n# SANCTUM_EXPIRATION=43200\n' }, (root) => {
    const r = checkMirrors(root);
    assert.equal(r.problems.length, 1);
    assert.match(r.problems[0], /^Development NODE_INTERNAL_SECRET differs: /);
  });
  withTree({ 'api/.env.example': 'APP_NAME=Laravel\nNODE_INTERNAL_SECRET=\n# SANCTUM_EXPIRATION=43200\n' }, (root) => {
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
    'deploy/docker-compose.yml': FILES['deploy/docker-compose.yml'].replace('image: mysql:8.4', `image: mysql:8.4${digest}`),
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
