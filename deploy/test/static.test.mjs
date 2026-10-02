// Static checks of the production deploy (deploy/): the compose files as docker compose renders
// them. They need the Docker CLI but no network and no running stack.
//
//   node --test deploy/test/static.test.mjs        (npm run test:deploy runs every deploy test)
//
// DEPLOY_DIR=<folder> runs the same checks against another deploy/ folder (lib.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { CI_OVERRIDE, COMPOSE_FILE, REPO_ROOT, readText, renderConfig } from './lib.mjs';

const base = () => renderConfig({ profiles: ['tools'] });
const ci = () => renderConfig({ files: [COMPOSE_FILE, CI_OVERRIDE], profiles: ['tools'] });

const servicesOf = (config) => Object.entries(config.services ?? {});

// ------------------------------------------------------------------------------ F-25

/** A reference is pinned when it ends in @sha256 and 64 hex digits. */
const PINNED = /^[^\s@]+@sha256:[0-9a-f]{64}$/;

/** Image references of a Dockerfile: FROM images and COPY --from images (not stage names). */
function dockerfileImages(text, contexts = ['shared']) {
  const stages = new Set();
  const refs = [];
  for (const line of text.split(/\r?\n/)) {
    const from = /^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?/i.exec(line);
    if (from) {
      if (!stages.has(from[1].toLowerCase())) refs.push(from[1]);
      if (from[2]) stages.add(from[2].toLowerCase());
    }
    const copy = /^\s*COPY\s+.*--from=(\S+)/i.exec(line);
    if (copy && !stages.has(copy[1].toLowerCase()) && !contexts.includes(copy[1]) && !/^\d+$/.test(copy[1])) refs.push(copy[1]);
  }
  return refs;
}

/** `image:` values and the images of `docker run` lines in a workflow file. */
function workflowImages(text) {
  const refs = [...text.matchAll(/^\s*image:\s*['"]?([^\s'"#]+)/gm)].map((m) => m[1]);
  const built = new Set([...text.matchAll(/docker build\b[^\n]*--tag\s+(\S+)/g)].map((m) => m[1]));
  const withValue = new Set(['-v', '--volume', '-w', '--workdir', '-e', '--env', '--network', '--name', '--mount', '-p', '--publish', '--entrypoint', '-u', '--user', '--platform']);
  for (const m of text.matchAll(/docker run\b([^\n]*)/g)) {
    const words = m[1].trim().split(/\s+/);
    let i = 0;
    while (i < words.length && words[i].startsWith('-')) i += withValue.has(words[i]) ? 2 : 1;
    const image = words[i];
    if (image && !built.has(image)) refs.push(image);
  }
  return refs;
}

test('F-25: every image in the compose files, the workflows and the CI tool images is pinned by digest, and copies agree', () => {
  const refs = [];
  const add = (where, list) => list.forEach((ref) => refs.push({ where, ref }));
  for (const [label, config] of [['deploy compose', base()], ['deploy compose + CI override', ci()]]) {
    add(label, servicesOf(config).filter(([, s]) => s.image).map(([, s]) => s.image));
  }
  add('dev/docker-compose.yml', [...readText(path.join(REPO_ROOT, 'dev', 'docker-compose.yml')).matchAll(/^\s*image:\s*(\S+)/gm)].map((m) => m[1]));
  const workflows = path.join(REPO_ROOT, '.github', 'workflows');
  for (const f of fs.readdirSync(workflows).filter((n) => /\.ya?ml$/.test(n))) add(`.github/workflows/${f}`, workflowImages(readText(path.join(workflows, f))));
  add('.github/actionlint/Dockerfile', dockerfileImages(readText(path.join(REPO_ROOT, '.github', 'actionlint', 'Dockerfile'))));
  assert.ok(refs.length > 0, 'no image reference found: refusing to report clean');
  console.log(`image references in scope: ${refs.length} (${new Set(refs.map((r) => r.ref)).size} distinct)`);
  assert.deepEqual(refs.filter((r) => !PINNED.test(r.ref)).map((r) => `${r.where}: ${r.ref}`), [], 'not pinned by digest');

  // Copies of one image tag carry one digest everywhere, the Dockerfiles included (their own pins
  // are checked by deploy/test/image.test.mjs).
  const dockerfiles = spawnSync('git', ['-C', REPO_ROOT, 'ls-files', '*Dockerfile*'], { encoding: 'utf8' }).stdout.trim().split('\n').filter(Boolean);
  for (const f of dockerfiles) add(f, dockerfileImages(readText(path.join(REPO_ROOT, f))));
  const byTag = new Map();
  for (const { where, ref } of refs) {
    const [tag, digest] = ref.split('@');
    if (!digest) continue;
    if (!byTag.has(tag)) byTag.set(tag, new Map());
    byTag.get(tag).set(digest, [...(byTag.get(tag).get(digest) ?? []), where]);
  }
  const differing = [...byTag].filter(([, digests]) => digests.size > 1).map(([tag, digests]) => `${tag}: ${[...digests].map(([d, w]) => `${d} (${[...new Set(w)].join(', ')})`).join(' / ')}`);
  console.log(`digest agreement: ${byTag.size} pinned tags across ${dockerfiles.length} Dockerfiles, the compose files and the workflows`);
  assert.deepEqual(differing, []);
});

test('F-25: Dependabot watches the Dockerfiles and the compose files of deploy/', () => {
  const text = readText(path.join(REPO_ROOT, '.github', 'dependabot.yml'));
  const entries = text.split(/^ {2}- package-ecosystem:/m).slice(1).map((chunk) => {
    const ecosystem = chunk.split('\n')[0].trim();
    const dirs = [...chunk.matchAll(/^\s+(?:directory:\s*|-\s+)(\/\S*)\s*$/gm)].map((m) => m[1]);
    return { ecosystem, dirs };
  });
  const dirsOf = (eco) => entries.filter((e) => e.ecosystem === eco).flatMap((e) => e.dirs);
  console.log(`dependabot: ${entries.length} update entries`);
  for (const dir of ['/api', '/server', '/.github/actionlint']) assert.ok(dirsOf('docker').includes(dir), `docker ${dir}`);
  for (const dir of ['/deploy', '/dev']) assert.ok(dirsOf('docker-compose').includes(dir), `docker-compose ${dir}`);
});
