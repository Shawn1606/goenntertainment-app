#!/usr/bin/env node
// Checks that values written in more than one place still agree ("mirrors"):
//   - Node major:  CI (NODE_VERSION in ci.yml) and the server image (server/Dockerfile FROM);
//   - PHP minor:   CI (PHP_VERSION in ci.yml), the API image (api/Dockerfile FROM) and the
//                  constraint in api/composer.json ("^8.4" and "^8.4.1" both read as 8.4);
//   - MySQL minor: every `image: mysql:` in ci.yml (service containers) and in
//                  deploy/docker-compose.yml;
//   - the minimum length of NODE_INTERNAL_SECRET: server/src/config.js, api/app/Support/
//                  NodeInternal.php and api/docker/entrypoint.sh;
//   - the development NODE_INTERNAL_SECRET: api/.env.example and server/.env.example;
//   - the upload size limit: server/src/uploads.js and Laravel's NodeFallbackController;
//   - the interests per event: the app's create-activity screen and server/src/routes/activities.js.
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
    // The app lets a host pick at most this many interests per event; the server refuses longer
    // lists before it loops over them.
    name: 'Interests per event',
    sources: [
      { file: 'src/app/create-activity.tsx', what: 'MAX_INTERESTS', extract: all(/^const MAX_INTERESTS = (\d+);/gm) },
      { file: 'server/src/routes/activities.js', what: 'MAX_INTERESTS', extract: all(/^const MAX_INTERESTS = (\d+);/gm) },
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
