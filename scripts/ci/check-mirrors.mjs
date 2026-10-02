#!/usr/bin/env node
// Checks that values written in more than one place still agree ("mirrors"):
//   - Node major:  CI (NODE_VERSION in ci.yml) and the server image (server/Dockerfile FROM);
//   - PHP minor:   CI (PHP_VERSION in ci.yml), the API image (api/Dockerfile FROM) and the
//                  constraint in api/composer.json ("^8.4" and "^8.4.1" both read as 8.4);
//   - MySQL minor: every `image: mysql:` in ci.yml (service containers) and in
//                  deploy/docker-compose.yml;
//   - MySQL image digest: the same lines carry one `@sha256:` digest, so CI tests the MySQL build
//                  the server runs (Dependabot updates the compose, never a workflow's services);
//   - the access-token lifetime (one token-validity rule on both backends): its default in
//                  api/app/Support/Sessions.php, server/src/config.js and the three .env examples,
//                  its accepted format in both backends, and the SANCTUM_EXPIRATION that the
//                  deploy hands to api and to node;
//   - the minimum length of NODE_INTERNAL_SECRET: server/src/config.js, api/app/Support/
//                  NodeInternal.php and api/docker/entrypoint.sh;
//   - the development NODE_INTERNAL_SECRET: api/.env.example and server/.env.example;
//   - the upload size limit: server/src/uploads.js and Laravel's NodeFallbackController;
//   - the 429 message: server/src/rate-limit.js and api/app/Providers/AppServiceProvider.php;
//   - the interests per event: the app's create-activity screen and server/src/routes/activities.js;
//   - the hours after its start from which an event is over: server/src/activity-pages.js (the
//                  event list leaves it out) and the app (urgency.ts, the feed and the search);
//   - the page size of the event list: the server's largest page and the one the app asks for;
//   - the streak window (active days the app shows): server/src/streak.js and api/app/Support/
//                  Streak.php, and the smallest USAGE_RETENTION_DAYS in server/src/config.js;
//   - the request body limits (JSON, webhook JSON with its path, urlencoded) and their 413 message:
//                  server/src/app.js and server/src/client-errors.js against Laravel's
//                  LimitRequestBody, which applies them before Laravel parses a body.
// CI tests what production runs only while these agree. A Dependabot update of a base image
// that moves Node or PHP fails here until CI (and composer.json) move with it, on purpose.
//
// Every occurrence counts, and a place where a value cannot be found is a failure, never a
// pass: an edited file must not silently drop out of the comparison.
//
//   node scripts/ci/check-mirrors.mjs [repository root]
//
// Exit codes: 0 = all values agree, 1 = a mismatch or a value that cannot be found.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const all = (re) => (text) => [...text.matchAll(re)].map((m) => m[1]);

const LIMIT_REQUEST_BODY = 'api/app/Http/Middleware/LimitRequestBody.php';

/**
 * The value of the environment setting `name` in one service of a compose file: services are
 * the keys indented by two spaces under the top-level `services:`.
 */
function composeServiceEnv(service, name) {
  const setting = new RegExp(`^\\s+${name}:\\s*(\\S.*?)\\s*$`);
  return (text) => {
    const values = [];
    let inServices = false;
    let current = null;
    for (const line of text.split(/\r?\n/)) {
      if (/^\S/.test(line)) {
        inServices = /^services:\s*(?:#.*)?$/.test(line);
        current = null;
        continue;
      }
      const key = inServices ? /^ {2}([\w.-]+):\s*(?:#.*)?$/.exec(line) : null;
      if (key) current = key[1];
      else if (current === service && setting.test(line)) values.push(setting.exec(line)[1]);
    }
    return values;
  };
}

/**
 * The digests of every `image: mysql:` line, or none at all when one of those lines has no
 * `@sha256:` digest: an unpinned copy is reported as a value that cannot be found, never as a pass.
 */
function mysqlDigests(text) {
  const refs = [...text.matchAll(/^\s*image:\s*['"]?mysql:([^\s'"#]+)/gm)].map((m) => m[1]);
  const digests = refs.map((ref) => /@(sha256:[0-9a-f]{64})$/.exec(ref)?.[1]);
  return digests.length > 0 && digests.every(Boolean) ? digests : [];
}

/** The `require.php` constraint of composer.json, reduced to major.minor ("^8.4" and "^8.4.1" → 8.4). */
function composerPhp(text) {
  const php = JSON.parse(text)?.require?.php;
  const m = typeof php === 'string' ? /^\^(\d+\.\d+)(?:\.\d+)?$/.exec(php.trim()) : null;
  return m ? [m[1]] : [];
}

export const MIRRORS = [
  {
    name: 'Node major',
    sources: [
      { file: '.github/workflows/ci.yml', what: 'NODE_VERSION', extract: all(/^\s*NODE_VERSION:\s*['"]?(\d+)['"]?\s*(?:#.*)?$/gm) },
      { file: 'server/Dockerfile', what: 'FROM node:', extract: all(/^FROM\s+(?:--platform=\S+\s+)?node:(\d+)(?=[-.:@\s]|$)/gim) },
    ],
  },
  {
    name: 'PHP minor',
    sources: [
      { file: '.github/workflows/ci.yml', what: 'PHP_VERSION', extract: all(/^\s*PHP_VERSION:\s*['"]?(\d+\.\d+)['"]?\s*(?:#.*)?$/gm) },
      { file: 'api/Dockerfile', what: 'FROM php:', extract: all(/^FROM\s+(?:--platform=\S+\s+)?php:(\d+\.\d+)(?=[-.:@\s]|$)/gim) },
      { file: 'api/composer.json', what: 'require.php', extract: composerPhp },
    ],
  },
  {
    name: 'MySQL minor',
    sources: [
      { file: '.github/workflows/ci.yml', what: 'image: mysql:', extract: all(/^\s*image:\s*['"]?mysql:(\d+\.\d+)/gm) },
      { file: 'deploy/docker-compose.yml', what: 'image: mysql:', extract: all(/^\s*image:\s*['"]?mysql:(\d+\.\d+)/gm) },
    ],
  },
  {
    // CI's service containers and the deploy's db, backup and admin-gate run one MySQL build.
    name: 'MySQL image digest',
    sources: [
      { file: '.github/workflows/ci.yml', what: 'a digest on every image: mysql: line', extract: mysqlDigests },
      { file: 'deploy/docker-compose.yml', what: 'a digest on every image: mysql: line', extract: mysqlDigests },
    ],
  },
  {
    // Laravel and Node refuse a token issued longer ago than the lifetime (one token-validity
    // rule, server/src/auth.js); unset, both take this default, and the examples name it.
    name: 'Token lifetime default (minutes)',
    sources: [
      { file: 'api/app/Support/Sessions.php', what: 'DEFAULT_LIFETIME_MINUTES', extract: all(/\bconst DEFAULT_LIFETIME_MINUTES = (\d+);/g) },
      { file: 'server/src/config.js', what: 'DEFAULT_TOKEN_LIFETIME_MINUTES', extract: all(/^export const DEFAULT_TOKEN_LIFETIME_MINUTES = (\d+);/gm) },
      { file: 'api/.env.example', what: '# SANCTUM_EXPIRATION=', extract: all(/^# SANCTUM_EXPIRATION=(\d+)\s*$/gm) },
      { file: 'server/.env.example', what: '# SANCTUM_EXPIRATION=', extract: all(/^# SANCTUM_EXPIRATION=(\d+)\s*$/gm) },
      { file: 'deploy/.env.example', what: '# SANCTUM_EXPIRATION=', extract: all(/^# SANCTUM_EXPIRATION=(\d+)\s*$/gm) },
    ],
  },
  {
    // A SANCTUM_EXPIRATION one backend accepts and the other refuses would stop only one of them.
    name: 'Token lifetime format (SANCTUM_EXPIRATION)',
    sources: [
      { file: 'api/app/Support/Sessions.php', what: 'lifetimeFromEnv pattern', extract: all(/preg_match\('\/(\^[^']*\$)\/', trim\(\$raw\)\)/g) },
      { file: 'server/src/config.js', what: 'TOKEN_LIFETIME_PATTERN', extract: all(/^export const TOKEN_LIFETIME_PATTERN = \/(.+)\/;$/gm) },
    ],
  },
  {
    // Both containers must read the same setting, or a lower value ends sessions on one only.
    name: 'SANCTUM_EXPIRATION in the deploy',
    sources: [
      { file: 'deploy/docker-compose.yml', what: 'api SANCTUM_EXPIRATION', extract: composeServiceEnv('api', 'SANCTUM_EXPIRATION') },
      { file: 'deploy/docker-compose.yml', what: 'node SANCTUM_EXPIRATION', extract: composeServiceEnv('node', 'SANCTUM_EXPIRATION') },
    ],
  },
  {
    // Node refuses to start with, Laravel refuses to send, and the api container refuses to start
    // with a shorter NODE_INTERNAL_SECRET: one minimum, written in three places.
    name: 'Internal secret minimum length',
    sources: [
      { file: 'server/src/config.js', what: 'INTERNAL_SECRET_MIN_LENGTH', extract: all(/^export const INTERNAL_SECRET_MIN_LENGTH = (\d+);/gm) },
      { file: 'api/app/Support/NodeInternal.php', what: 'SECRET_MIN_LENGTH', extract: all(/\bconst SECRET_MIN_LENGTH = (\d+);/g) },
      { file: 'api/docker/entrypoint.sh', what: 'NODE_INTERNAL_SECRET length check', extract: all(/"\$\{#NODE_INTERNAL_SECRET\}" -lt (\d+)/g) },
    ],
  },
  {
    // Development: Laravel (api/.env) and Node (server/.env) must hold the same value, or deleting
    // an account fails; both .env files start from these examples.
    name: 'Development NODE_INTERNAL_SECRET',
    sources: [
      { file: 'api/.env.example', what: 'NODE_INTERNAL_SECRET', extract: all(/^NODE_INTERNAL_SECRET=(\S+)\s*$/gm) },
      { file: 'server/.env.example', what: 'NODE_INTERNAL_SECRET', extract: all(/^NODE_INTERNAL_SECRET=(\S+)\s*$/gm) },
    ],
  },
  {
    // Node refuses larger images (uploads.js); Laravel names the same limit to the app when PHP
    // refuses a file before Node sees it (NodeFallbackController::uploadLimitMb).
    name: 'Upload size limit (MB)',
    sources: [
      { file: 'server/src/uploads.js', what: 'MAX_UPLOAD_BYTES', extract: all(/^export const MAX_UPLOAD_BYTES = (\d+) \* 1024 \* 1024;/gm) },
      { file: 'api/app/Http/Controllers/NodeFallbackController.php', what: '$nodeLimit', extract: all(/\$nodeLimit = (\d+) \* 1024 \*\* 2;/g) },
    ],
  },
  {
    // The answer to a rate-limited request: Laravel's limiters and Node's write limiter send the
    // same German text, which the app shows verbatim.
    name: 'Rate limit message',
    sources: [
      { file: 'server/src/rate-limit.js', what: 'RATE_LIMIT_MESSAGE', extract: all(/^export const RATE_LIMIT_MESSAGE = '([^']+)';/gm) },
      { file: 'api/app/Providers/AppServiceProvider.php', what: "'Zu viele Versuche ...' message", extract: all(/'(Zu viele Versuche[^']*)'/g) },
    ],
  },
  {
    // The app lets a host pick at most this many interests per event; the server refuses longer
    // lists before it loops over them.
    name: 'Interests per event',
    sources: [
      { file: 'src/app/create-activity.tsx', what: 'MAX_INTERESTS', extract: all(/^const MAX_INTERESTS = (\d+);/gm) },
      { file: 'server/src/routes/activities.js', what: 'MAX_INTERESTS', extract: all(/^const MAX_INTERESTS = (\d+);/gm) },
    ],
  },
  {
    // A dated event is over this many hours after its start (the database stores no end). The
    // server leaves it out of the event list from then on (F-12); the app shows "Vorbei" and hides
    // it from the feed and the search. A smaller server value would drop events the app still
    // shows as running.
    name: 'Event over after (hours)',
    sources: [
      { file: 'server/src/activity-pages.js', what: 'PAST_AFTER_HOURS', extract: all(/^export const PAST_AFTER_HOURS = (\d+);/gm) },
      { file: 'src/domain/urgency.ts', what: 'LIVE_MS', extract: all(/^export const LIVE_MS = (\d+) \* HOUR;/gm) },
      { file: 'src/app/(app)/index.tsx', what: 'the feed cutoff', extract: all(/const cutoff = now\.getTime\(\) - (\d+) \* 60 \* 60 \* 1000;/g) },
      { file: 'src/app/search.tsx', what: 'PAST_CUTOFF_MS', extract: all(/^const PAST_CUTOFF_MS = (\d+) \* 60 \* 60 \* 1000;/gm) },
    ],
  },
  {
    // The app asks for the server's largest page of the event list (F-12); a smaller server value
    // would only cost requests, a larger one would leave it unused.
    name: 'Event list page size',
    sources: [
      { file: 'server/src/activity-pages.js', what: 'PAGE_SIZE_MAX', extract: all(/^export const PAGE_SIZE_MAX = (\d+);/gm) },
      { file: 'src/domain/activity-pages.ts', what: 'ACTIVITY_PAGE_SIZE', extract: all(/^export const ACTIVITY_PAGE_SIZE = (\d+);/gm) },
    ],
  },
  {
    // Both backends read the active days of this many days back; the retention prune must keep at
    // least as many (USAGE_RETENTION_DAYS), or it would cut streaks.
    name: 'Streak window (days)',
    sources: [
      { file: 'server/src/streak.js', what: 'ACTIVE_DAYS_WINDOW', extract: all(/^export const ACTIVE_DAYS_WINDOW = (\d+);/gm) },
      { file: 'api/app/Support/Streak.php', what: 'ACTIVE_DAYS_WINDOW', extract: all(/\bconst ACTIVE_DAYS_WINDOW = (\d+);/g) },
      { file: 'server/src/config.js', what: 'USAGE_RETENTION_MIN_DAYS', extract: all(/^export const USAGE_RETENTION_MIN_DAYS = (\d+);/gm) },
    ],
  },
  {
    // Laravel refuses a larger body before it parses it (LimitRequestBody); Node's parsers refuse
    // the same sizes. 1 kB = 1024 bytes on both sides, so the values are compared in kB.
    name: 'JSON body limit (kB)',
    sources: [
      { file: 'server/src/app.js', what: 'JSON_LIMIT', extract: all(/^export const JSON_LIMIT = '(\d+)kb';/gm) },
      { file: LIMIT_REQUEST_BODY, what: 'JSON_LIMIT_KB', extract: all(/\bconst JSON_LIMIT_KB = (\d+);/g) },
    ],
  },
  {
    name: 'Webhook JSON body limit (kB)',
    sources: [
      { file: 'server/src/app.js', what: 'WEBHOOK_JSON_LIMIT', extract: all(/^export const WEBHOOK_JSON_LIMIT = '(\d+)kb';/gm) },
      { file: LIMIT_REQUEST_BODY, what: 'WEBHOOK_JSON_LIMIT_KB', extract: all(/\bconst WEBHOOK_JSON_LIMIT_KB = (\d+);/g) },
    ],
  },
  {
    // The path Node mounts its larger webhook parser on, and the normalised path Laravel gives the
    // larger limit.
    name: 'Webhook JSON body limit path',
    sources: [
      { file: 'server/src/app.js', what: 'the webhook parser mount', extract: all(/app\.use\('([^']+)', express\.json\(\{ limit: WEBHOOK_JSON_LIMIT \}\)\)/g) },
      { file: LIMIT_REQUEST_BODY, what: 'WEBHOOK_PATH', extract: all(/\bconst WEBHOOK_PATH = '([^']+)';/g) },
    ],
  },
  {
    name: 'Urlencoded body limit (kB)',
    sources: [
      { file: 'server/src/app.js', what: 'URLENCODED_LIMIT', extract: all(/^export const URLENCODED_LIMIT = '(\d+)kb';/gm) },
      { file: LIMIT_REQUEST_BODY, what: 'URLENCODED_LIMIT_KB', extract: all(/\bconst URLENCODED_LIMIT_KB = (\d+);/g) },
    ],
  },
  {
    // The answer to an oversized body, from whichever backend refuses it; the app shows it verbatim.
    name: 'Body too large message',
    sources: [
      { file: 'server/src/client-errors.js', what: 'MSG_TOO_LARGE', extract: all(/^export const MSG_TOO_LARGE = '([^']+)';/gm) },
      { file: LIMIT_REQUEST_BODY, what: 'MSG_TOO_LARGE', extract: all(/\bconst MSG_TOO_LARGE = '([^']+)';/g) },
    ],
  },
];

export function checkMirrors(root, mirrors = MIRRORS) {
  const problems = [];
  const summaries = [];
  let places = 0;
  let occurrences = 0;
  for (const mirror of mirrors) {
    const seen = [];
    for (const source of mirror.sources) {
      places += 1;
      const path = join(root, source.file);
      let values = [];
      if (!existsSync(path)) {
        problems.push(`${mirror.name}: ${source.file} not found`);
        continue;
      }
      try {
        values = source.extract(readFileSync(path, 'utf8'));
      } catch (err) {
        problems.push(`${mirror.name}: cannot read ${source.file} (${err.message})`);
        continue;
      }
      if (values.length === 0) {
        problems.push(`${mirror.name}: cannot find ${source.what} in ${source.file}`);
        continue;
      }
      occurrences += values.length;
      for (const value of values) seen.push({ value, where: `${source.file} ${source.what}` });
    }
    const distinct = [...new Set(seen.map((s) => s.value))];
    if (distinct.length > 1) {
      problems.push(`${mirror.name} differs: ${seen.map((s) => `${s.value} (${s.where})`).join(', ')}`);
    }
    summaries.push(`${mirror.name}: ${distinct.join(' / ') || '?'} in ${seen.length} occurrence(s)`);
  }
  return { values: mirrors.length, places, occurrences, summaries, problems };
}

export function run(argv) {
  const root = resolve(argv[0] ?? REPO_ROOT);
  const r = checkMirrors(root);
  const lines = [
    `mirrors: checked ${r.values} values in ${r.places} places (${r.occurrences} occurrences)`,
    ...r.summaries.map((s) => `  ${s}`),
    ...r.problems.map((p) => `  - ${p}`),
    r.problems.length ? `FAIL: ${r.problems.length} problem(s)` : 'OK',
  ];
  return { code: r.problems.length || r.occurrences === 0 ? 1 : 0, lines };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const { code, lines } = run(process.argv.slice(2));
  console.log(lines.join('\n'));
  process.exit(code);
}
