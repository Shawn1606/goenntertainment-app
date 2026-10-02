// The running stack, checked through the edge. CI AND LOCAL TESTS ONLY.
//
// Builds the images, starts the whole stack of deploy/docker-compose.yml with the CI override and
// deploy/ci.env the way the runbook's first start does (backends first, the admin gate, the
// one-off seed, then the edge), checks it from the `probe` service (a visitor on the edge network,
// deploy/test/probe.mjs) and from inside the containers, and removes it again with its volumes and
// built images.
//
//   COMPOSE_PROJECT_NAME=<a name of its own> npm run test:deploy:stack
//
// Needs Docker with Compose >= 2.24.4. The image builds reach the container and package
// registries; the stack itself runs on internal networks only: no certificate authority, no mail
// provider, no moderation provider is ever contacted (DOMAIN=localhost makes Caddy use its own
// internal certificate authority). Settings: stack-lib.mjs (stackSettings).
//
// Every account, password and key here is made up for this run and never printed; answers are
// shown through redact(). Usernames come from the server tests' fixtures (testIdentity), so the
// word filter can never refuse them by accident (server/test/test-support.test.js checks the
// prefixes used here).
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';

import { BLOCKED_TERMS, findBlockedTerm } from '../../server/src/blocked-terms.js';
import { testIdentity, uniqueStamp } from '../../server/test/support/fixtures.js';
import { REPO_ROOT, envFileValues, readText } from './lib.mjs';
import {
  Stack, apiRequest, defaultWriteLimit, freshPassword, header, multipart, png, redact, sha256,
  stackSettings, storageList, waitFor,
} from './stack-lib.mjs';

const settings = stackSettings();
const values = envFileValues(settings.envFile);
const domain = values.DOMAIN;
const legal = JSON.parse(readText(path.join(REPO_ROOT, 'shared', 'legal.json')));

/** The backends and jobs that start before the edge (the runbook's first `up`). */
const BACKEND = ['db', 'storage-init', 'node', 'api', 'backup', 'mailpit'];
/** A stored file name as Node gives it (server/src/storage.js STORED_NAME). */
const storedName = (ext) => `${crypto.randomBytes(20).toString('hex')}.${ext}`;
const MYSQL = 'MYSQL_PWD="$MYSQL_PASSWORD" mysql -u"$MYSQL_USER" -N -B';

const stack = new Stack(settings);
/** What the start recorded, for the tests to judge. */
const S = { failed: false, steps: [] };
const started = Date.now();

/** A test that marks the run as failed (for the logs in `after`). */
function check(name, fn) {
  test(name, async (t) => {
    try {
      await fn(t);
    } catch (err) {
      S.failed = true;
      throw err;
    }
  });
}

function step(name, fn) {
  const t0 = Date.now();
  const result = fn();
  S.steps.push(`${name} ${Math.round((Date.now() - t0) / 1000)} s`);
  return result;
}

const tail = (text, n = 1500) => String(text ?? '').slice(-n);
/** How many answers had which status: { 404: 30 }. */
const tally = (results) => results.reduce((acc, r) => ({ ...acc, [r.status ?? r.error]: (acc[r.status ?? r.error] ?? 0) + 1 }), {});

/** State, health and exit code of the first container of a service, or null. */
function stateOf(service) {
  const c = stack.containersOf(service)[0];
  if (!c) return { exists: false, running: false, status: 'no container' };
  return {
    exists: true,
    running: c.State.Running === true,
    status: c.State.Status,
    health: c.State.Health?.Status,
    exitCode: c.State.ExitCode,
    name: c.Name.replace(/^\//, ''),
  };
}

function adminCount() {
  const r = stack.sh('db', `${MYSQL} -e "SELECT COUNT(*) FROM users WHERE is_admin = 1" "$MYSQL_DATABASE"`);
  if (r.status !== 0) throw new Error(`cannot count the admin accounts: ${r.stderr.trim()}`);
  return Number(r.stdout.trim());
}

function query(sql) {
  const r = stack.sh('db', `${MYSQL} -e "${sql}" "$MYSQL_DATABASE"`);
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim().split(/\r?\n/).filter(Boolean);
}

/** Writes bytes into a container as its own user (node writes the uploads). */
function plant(service, file, bytes) {
  const r = stack.exec(service, ['sh', '-c', `cat > '${file}'`], { input: bytes });
  assert.equal(r.status, 0, `cannot plant ${file} in ${service}: ${r.stderr}`);
}

function remove(service, files) {
  if (files.length > 0) stack.exec(service, ['rm', '-f', ...files]);
}

/** A new account through the edge: { ...identity, password, token, id }. */
function register(prefix, index = 1) {
  const identity = testIdentity(prefix);
  const password = freshPassword();
  const res = stack.request(apiRequest('POST', '/api/register', {
    json: {
      name: identity.name,
      username: identity.username,
      email: identity.email,
      password,
      account_type: 'standard',
      terms_version: legal.terms_version,
      confirmed_min_age: legal.min_age,
    },
  }), index);
  assert.ok([200, 201].includes(res.status), `sign-up: ${redact(res)}`);
  const token = res.json?.token;
  assert.ok(typeof token === 'string' && token.length > 10, 'sign-up returned no token');
  return { ...identity, password, token, id: res.json?.user?.id };
}

let adminTokenCache;
function adminToken() {
  if (!adminTokenCache) {
    const res = stack.request(apiRequest('POST', '/api/login', { json: { email: S.admin.email, password: S.admin.password } }));
    assert.equal(res.status, 200, `admin sign-in: ${redact(res)}`);
    adminTokenCache = res.json?.token;
    assert.ok(adminTokenCache, 'admin sign-in returned no token');
  }
  return adminTokenCache;
}

/** A multipart request with one image, for the probe. */
function imageUpload(urlPath, token, fields, field, bytes) {
  const form = multipart(fields, [{ field, filename: 'image.png', type: 'image/png', bytes }]);
  return {
    method: 'POST',
    path: urlPath,
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, 'Content-Type': form.contentType },
    bodyBase64: form.body.toString('base64'),
  };
}

before(async () => {
  try {
    await start();
  } catch (err) {
    S.failed = true;
    throw err;
  }
}, { timeout: 35 * 60_000 });

/** Builds and starts the stack the way the runbook's first start does, recording each step. */
async function start() {
  console.log(`stack: project ${stack.project}, ${settings.files.length} compose file(s), env file ${path.basename(settings.envFile)}`);
  const services = step('config', () => stack.services());
  S.services = services;
  console.log(`services: ${services.join(', ')}`);

  // The probe (profile test) is built from server/Dockerfile like node and seed.
  const build = step('build', () => stack.compose(['build'], { profiles: ['tools', 'test'], timeout: 30 * 60_000 }));
  if (build.status !== 0) throw new Error(`docker compose build failed (exit ${build.status}):\n${tail(build.stderr, 4000)}`);

  // The runbook's first start: backends and jobs first, without the edge.
  const backend = BACKEND.filter((s) => services.includes(s));
  const up = step('up backends', () => stack.compose(['up', '-d', ...backend]));
  if (up.status !== 0) throw new Error(`docker compose up -d ${backend.join(' ')} failed (exit ${up.status}):\n${tail(up.stderr)}`);
  await waitFor('api to be healthy', () => stateOf('api').health === 'healthy', { ms: 6 * 60_000 });

  // What `docker compose up -d` does while no admin account exists.
  S.adminsBefore = adminCount();
  const early = step('up before seeding', () => stack.compose(['up', '-d']));
  S.upBefore = { status: early.status, stderr: early.stderr };
  S.caddyBefore = stateOf('caddy');
  S.gateBefore = stateOf('admin-gate');
  S.gateBefore.log = S.gateBefore.exists ? stack.compose(['logs', '--no-color', 'admin-gate']).stdout : '';

  // The admin, with the one-off seed service; its values live only in this compose call.
  S.admin = { email: 'ci-admin@example.invalid', password: freshPassword() };
  const adminEnv = { ADMIN_EMAIL: S.admin.email, ADMIN_PASSWORD: S.admin.password };
  const seed = step('seed', () => (services.includes('seed')
    ? stack.compose(['run', '--rm', '-T', 'seed'], { env: adminEnv, profiles: ['tools'] })
    // An older deploy/ without the one-off service: the admin is created through node, so the
    // remaining checks can run (the edge check above then fails on its own assertion).
    : stack.compose(['run', '--rm', '-T', 'node', 'npm', 'run', 'seed:admin'], { env: adminEnv })));
  S.seed = { service: services.includes('seed') ? 'seed' : 'node', status: seed.status, out: tail(`${seed.stdout}\n${seed.stderr}`, 600) };
  S.adminsAfter = adminCount();

  const late = step('up after seeding', () => stack.compose(['up', '-d']));
  S.upAfter = { status: late.status, stderr: late.stderr };
  S.caddyAfter = await waitFor('caddy to run', () => (stateOf('caddy').running ? stateOf('caddy') : null), { ms: 120_000 })
    .catch(() => stateOf('caddy'));

  // Two visitors with two addresses on the edge network.
  const probes = step('probes', () => stack.compose(['up', '-d', '--scale', 'probe=2', 'probe'], { profiles: ['test'] }));
  if (probes.status !== 0) throw new Error(`cannot start the probe service (exit ${probes.status}): ${tail(probes.stderr)}`);
  await waitFor('the edge to answer /api/health', () => {
    try {
      const res = stack.request(apiRequest('GET', '/api/health'));
      return res.status === 200 && res.json?.ok === true;
    } catch {
      return false;
    }
  }, { ms: 180_000, every: 3000 });
  console.log(`start: ${S.steps.join(', ')}; ${Math.round((Date.now() - started) / 1000)} s in total`);
}

after(() => {
  if (S.failed) {
    const logs = stack.compose(['logs', '--no-color', '--tail', '200'], { profiles: ['tools', 'test'] });
    console.log(`--- logs of the stack (last 200 lines per container) ---\n${logs.stdout}${logs.stderr}`);
  }
  if (settings.keep) {
    console.log(`STACK_KEEP=1: the stack ${stack.project} keeps running; remove it with docker compose -p ${stack.project} down -v`);
  } else {
    const down = stack.compose(['down', '-v', '--remove-orphans', '--rmi', 'local'], { profiles: ['tools', 'test'] });
    console.log(`down -v --remove-orphans --rmi local: exit ${down.status}`);
  }
  console.log(`stack test: ${Math.round((Date.now() - started) / 1000)} s`);
}, { timeout: 10 * 60_000 });

// --------------------------------------------------------------------------- first start

check('F-05: the edge does not start before an admin account exists', () => {
  console.log(`before seeding: ${S.adminsBefore} admin account(s); up -d exit ${S.upBefore.status}; `
    + `caddy ${S.caddyBefore.status}; admin-gate ${S.gateBefore.status} (exit ${S.gateBefore.exitCode})`);
  console.log(`seed (${S.seed.service}): exit ${S.seed.status}; after: ${S.adminsAfter} admin account(s); up -d exit ${S.upAfter.status}; caddy ${S.caddyAfter.status}`);
  assert.equal(S.adminsBefore, 0, 'a fresh stack starts without an admin account');
  assert.equal(S.caddyBefore.running, false, `caddy was running while no admin account existed (${S.caddyBefore.status})`);
  assert.equal(S.gateBefore.exists, true, 'no admin-gate container ran before the edge');
  assert.equal(S.gateBefore.exitCode, 1, 'the admin gate refused while no admin account existed');
  assert.match(S.gateBefore.log, /no admin account yet/);
  assert.notEqual(S.upBefore.status, 0, 'docker compose up -d reported success while the edge could not start');
  assert.equal(S.seed.service, 'seed', 'the admin account is created by the one-off seed service');
  assert.equal(S.seed.status, 0, `the seed run: ${S.seed.out}`);
  assert.equal(S.adminsAfter, 1);
  assert.equal(S.upAfter.status, 0, `docker compose up -d after seeding: ${tail(S.upAfter.stderr, 600)}`);
  assert.equal(S.caddyAfter.running, true, `caddy after seeding: ${S.caddyAfter.status}`);
});

check('F-18: no container carries ADMIN_EMAIL or ADMIN_PASSWORD, and no seed container is left', () => {
  const all = stack.containers();
  const running = all.filter((c) => c.State.Running);
  console.log(`containers: ${all.length} in the project, ${running.length} running`);
  assert.ok(running.length >= 6, `only ${running.length} running containers`);
  const name = (c) => c.Name.replace(/^\//, '');
  const env = (c) => c.Config.Env ?? [];
  assert.deepEqual(all.filter((c) => env(c).some((e) => e.startsWith('ADMIN_'))).map(name), [], 'containers with ADMIN_* in their environment');
  assert.deepEqual(all.filter((c) => env(c).some((e) => e.includes(S.admin.password) || e.includes(S.admin.email))).map(name), [], 'containers holding the admin values');
  assert.deepEqual(all.filter((c) => c.Config.Labels?.['com.docker.compose.service'] === 'seed').map(name), [], 'a seed container was left behind');
});

check('F-18: the database healthcheck carries no password', () => {
  const db = stack.containersOf('db')[0];
  assert.ok(db, 'no db container');
  const words = db.Config.Healthcheck?.Test ?? [];
  const secrets = Object.entries(values).filter(([k, v]) => /PASSWORD|SECRET|_KEY$/.test(k) && v !== '').map(([, v]) => v);
  console.log(`db healthcheck: ${words.length} words, checked against ${secrets.length} secret values`);
  assert.ok(words.length > 1, 'the db container has no healthcheck');
  const text = words.join(' ');
  assert.equal(secrets.filter((v) => text.includes(v)).length, 0, 'the healthcheck holds a password value');
  assert.doesNotMatch(text, /(^|\s)(-p\S|--password)|MYSQL_PWD|MYSQL_(ROOT_)?PASSWORD/, 'the healthcheck names a password option');
  assert.equal(db.State.Health?.Status, 'healthy');
});

// --------------------------------------------------------------------------- the Laravel image

check('F-28: the Laravel container runs as a non-root user', () => {
  const id = stack.exec('api', ['id', '-u']);
  assert.equal(id.status, 0, id.stderr);
  const procs = stack.sh('api', "grep -H '^Uid:' /proc/[0-9]*/status 2>/dev/null; true");
  const uids = procs.stdout.trim().split(/\r?\n/).filter(Boolean).map((line) => {
    const [where, ...ids] = line.split(/\s+/);
    return { where: where.replace(/:Uid:$/, ''), ids };
  });
  const api = stack.containersOf('api')[0];
  const imageUser = stack.image(api.Image).Config.User;
  console.log(`api: id -u ${id.stdout.trim()}, ${uids.length} processes, image user ${imageUser || '(none: root)'}`);
  assert.notEqual(Number(id.stdout.trim()), 0, 'api runs as root');
  assert.ok(uids.length > 0, 'no process found in api');
  assert.deepEqual(uids.filter((p) => p.ids.includes('0')).map((p) => p.where), [], 'processes with a root uid');
  assert.ok(imageUser && !/^(root|0)(:|$)/.test(imageUser), `the api image's user is ${imageUser || 'not set (root)'}`);
});

check('F-28: the Laravel image ships no Composer', () => {
  const r = stack.sh('api', 'n=0; for d in $(echo "$PATH" | tr ":" " "); do n=$((n+1)); ls "$d"/composer* 2>/dev/null; done; echo "dirs $n"');
  const lines = r.stdout.trim().split(/\r?\n/);
  const dirs = Number(/^dirs (\d+)$/.exec(lines.at(-1))?.[1]);
  console.log(`api: ${dirs} PATH directories searched for composer`);
  assert.ok(dirs > 0, 'no PATH directory searched');
  assert.deepEqual(lines.slice(0, -1).filter(Boolean), [], 'Composer in the runtime image');
  assert.notEqual(stack.sh('api', 'command -v composer').status, 0, 'command -v composer found it');
});

// --------------------------------------------------------------------------- uploads

check('F-29: a PHP file planted in any upload folder is never executed, through the edge or inside api', () => {
  const pub = storageList('PUBLIC_FOLDERS');
  const priv = storageList('PRIVATE_FOLDERS');
  const folders = [
    ...pub.map((folder) => ({ folder, dir: `/app/storage/${folder}` })),
    ...priv.map((folder) => ({ folder, dir: `/app/storage-private/${folder}` })),
  ];
  // The marker is what the file PRINTS when PHP runs it; its source holds it reversed.
  const marker = `php-ran-${crypto.randomBytes(8).toString('hex')}`;
  const source = `<?php echo strrev('${[...marker].reverse().join('')}'); ?>\n`;
  assert.ok(!source.includes(marker));
  const name = `probe-${crypto.randomBytes(6).toString('hex')}.php`;
  const planted = folders.map((f) => `${f.dir}/${name}`);
  for (const file of planted) plant('node', file, source);
  try {
    const spellings = (f) => [`/storage/${f}/${name}`, `//storage/${f}/${name}`, `/storage/./${f}/${name}`, `/storage/${f}/${name}/x`, `/STORAGE/${f}/${name}`];
    const edge = folders.flatMap((f) => spellings(f.folder));
    const res = stack.probe(edge.map((p) => apiRequest('GET', p))).results;
    console.log(`planted: ${folders.length} folders (${pub.length} public, ${priv.length} private); ${edge.length} requests through the edge, answers ${JSON.stringify(tally(res))}`);
    assert.deepEqual(res.map((r, i) => ({ p: edge[i], r })).filter(({ r }) => r.error || (r.body ?? '').includes(marker)).map(({ p, r }) => `${p}: ${redact(r)}`), [], 'PHP ran');
    assert.deepEqual(res.map((r, i) => ({ p: edge[i], r })).filter(({ r }) => r.status === 200).map(({ p, r }) => `${p}: ${r.status}`), [], 'a planted file was served');

    // Apache inside api, asked directly on its port: it has no uploads at all.
    const paths = folders.map((f) => `/storage/${f.folder}/${name}`);
    const php = [
      '$out = [];',
      'foreach (array_slice($argv, 1) as $p) {',
      "  $ctx = stream_context_create(['http' => ['ignore_errors' => true, 'timeout' => 10]]);",
      "  $body = @file_get_contents('http://127.0.0.1:8080' . $p, false, $ctx);",
      "  $out[] = ['path' => $p, 'status' => $http_response_header[0] ?? 'no answer', 'ran' => str_contains((string) $body, getenv('MARKER'))];",
      '}',
      'echo json_encode($out);',
    ].join('\n');
    const inside = stack.compose(['exec', '-T', '-e', `MARKER=${marker}`, 'api', 'php', '-r', php, ...paths]);
    assert.equal(inside.status, 0, inside.stderr);
    const answers = JSON.parse(inside.stdout);
    console.log(`inside api on 8080: ${answers.length} requests (${[...new Set(answers.map((a) => a.status))].join('; ')})`);
    assert.equal(answers.length, paths.length);
    assert.deepEqual(answers.filter((a) => a.ran || / 200 /.test(a.status)).map((a) => `${a.path}: ${a.status}`), [], 'Apache served or ran a planted file');

    const api = stack.containersOf('api')[0];
    const uploadMounts = (api.Mounts ?? []).filter((m) => /uploads|private-media|storage/.test(`${m.Name ?? ''} ${m.Source ?? ''} ${m.Destination}`));
    assert.deepEqual(uploadMounts.map((m) => `${m.Source} -> ${m.Destination}`), [], 'api mounts an upload folder');

    // And the planted public files did lie where media serves files from: the 404s above are
    // the edge refusing them, not files the file server could not see.
    const seen = stack.sh('media', `${pub.map((f) => `test -f /srv/storage/${f}/${name} && echo ${f}`).join('; ')}; true`);
    assert.deepEqual(seen.stdout.trim().split(/\s+/).filter(Boolean).sort(), [...pub].sort(), 'the planted files are in the volume media serves');
  } finally {
    remove('node', planted);
  }
});

check('F-29/F-30: a stored image is a plain file with nosniff and a sandbox CSP; private media are never served as files', () => {
  const bytes = png([0x20, 0x90, 0x60]);
  const name = storedName('png');
  const pub = storageList('PUBLIC_FOLDERS');
  const priv = storageList('PRIVATE_FOLDERS');
  const planted = [...pub.map((f) => `/app/storage/${f}/${name}`), ...priv.map((f) => `/app/storage-private/${f}/${name}`)];
  for (const file of planted) plant('node', file, bytes);
  try {
    const urls = [...pub, ...priv].map((f) => `/storage/${f}/${name}`);
    const res = stack.probe(urls.map((p) => apiRequest('GET', p))).results;
    console.log(`stored image: ${pub.length} public and ${priv.length} private folders requested through the edge`);
    pub.forEach((f, i) => {
      const r = res[i];
      assert.equal(r.status, 200, `${urls[i]}: ${redact(r)}`);
      assert.equal(header(r, 'content-type'), 'image/png', urls[i]);
      assert.equal(header(r, 'x-content-type-options'), 'nosniff', urls[i]);
      assert.match(header(r, 'content-security-policy') ?? '', /default-src 'none'.*sandbox|sandbox.*default-src 'none'/, urls[i]);
      assert.equal(r.bodySha256, sha256(bytes), `${urls[i]}: not the stored bytes`);
    });
    priv.forEach((f, j) => {
      const r = res[pub.length + j];
      assert.ok(r.status >= 400 && r.status < 500, `${urls[pub.length + j]} answered ${r.status ?? r.error}`);
      assert.notEqual(r.bodySha256, sha256(bytes), `${urls[pub.length + j]} was served`);
    });
    // The files come from media, read-only; the edge, which holds the keys, mounts no upload.
    const caddyMounts = stack.containersOf('caddy')[0]?.Mounts ?? [];
    const mediaMounts = stack.containersOf('media')[0]?.Mounts ?? [];
    const named = (list, re) => list.filter((m) => re.test(m.Name ?? '')).map((m) => m.Destination);
    assert.deepEqual(named(caddyMounts, /(uploads|private-media)$/), [], 'caddy mounts an upload volume');
    assert.deepEqual(named(mediaMounts, /private-media$/), [], 'media mounts the private media');
    const uploads = mediaMounts.find((m) => m.Destination === '/srv/storage');
    assert.ok(uploads && /uploads$/.test(uploads.Name ?? ''), 'media has no uploads volume at /srv/storage');
    assert.equal(uploads.RW, false, 'media mounts the uploads writable');
  } finally {
    remove('node', planted);
  }
});

check("F-11/F-13: a story image leaves the server only through Node's checked route, with a token", () => {
  const token = adminToken();
  const created = stack.request(imageUpload('/api/stories', token, {}, 'image', png([0x30, 0x60, 0x90])));
  assert.equal(created.status, 201, `story: ${redact(created)}`);
  const url = created.json?.data?.image_url ?? '';
  const prefix = `https://${domain}/api/media/stories/`;
  assert.ok(url.startsWith(prefix), `image_url ${url} is not the checked route`);
  const file = url.slice(prefix.length);
  assert.match(file, /^[0-9a-f]{40}\.(jpg|png|webp)$/);
  const [withToken, without, asFile] = stack.probe([
    apiRequest('GET', `/api/media/stories/${file}`, { token }),
    apiRequest('GET', `/api/media/stories/${file}`),
    apiRequest('GET', `/storage/stories/${file}`),
  ]).results;
  console.log(`story image: with token ${withToken.status}, without ${without.status}, as a file ${asFile.status}`);
  assert.equal(withToken.status, 200, redact(withToken));
  assert.match(header(withToken, 'content-type') ?? '', /^image\//);
  assert.equal(without.status, 401);
  assert.ok(asFile.status >= 400 && asFile.status < 500, `/storage/stories/ answered ${asFile.status ?? asFile.error}`);
  assert.notEqual(asFile.bodySha256, withToken.bodySha256, 'the story image was served as a file');
  assert.equal(stack.exec('node', ['test', '-f', `/app/storage-private/stories/${file}`]).status, 0, 'the story image is not in the private media');
  assert.notEqual(stack.exec('media', ['test', '-e', `/srv/storage/stories/${file}`]).status, 0, 'media can see the story image');
  assert.notEqual(stack.exec('caddy', ['test', '-e', `/srv/storage/stories/${file}`]).status, 0, 'caddy can see the story image');
});

check('uploads: a symbolic link planted in the uploads volume never hands out the edge\'s private keys', () => {
  // Caddy's file server follows links, and an allowed name is all a link needs. The edge holds
  // the certificate and account keys (caddy-data; in CI the keys of Caddy's internal authority
  // for DOMAIN=localhost), so the links point there: absolute, and relative from the folder.
  const keys = [
    { folder: 'posts', target: '/data/caddy/pki/authorities/local/root.key' },
    { folder: 'banners', target: `/data/caddy/certificates/local/${domain}/${domain}.key` },
    { folder: 'avatars', target: '/data/caddy/pki/authorities/local/intermediate.key', relative: '../../../data/caddy/pki/authorities/local/intermediate.key' },
  ];
  // The keys exist at the edge: a 404 below is a refusal, not a missing target. Only a hash of
  // each key leaves the container, never the key.
  const hashes = keys.map((k) => {
    const r = stack.sh('caddy', `test -f '${k.target}' && sha256sum '${k.target}' | cut -d' ' -f1`);
    assert.equal(r.status, 0, `the edge has no ${k.target}: the check would prove nothing`);
    return r.stdout.trim();
  });
  const control = { folder: 'user-banners', name: storedName('png'), bytes: png([0x51, 0x52, 0x53]) };
  const links = keys.map((k) => ({ ...k, file: `/app/storage/${k.folder}/${storedName(k.folder === 'avatars' ? 'webp' : 'png')}` }));
  const planted = [...links.map((l) => l.file), `/app/storage/${control.folder}/${control.name}`];
  for (const l of links) {
    const r = stack.exec('node', ['ln', '-s', l.relative ?? l.target, l.file]);
    assert.equal(r.status, 0, `cannot plant a link at ${l.file}: ${r.stderr}`);
  }
  plant('node', `/app/storage/${control.folder}/${control.name}`, control.bytes);
  try {
    const urls = [...links.map((l) => l.file.replace('/app/storage/', '/storage/')), `/storage/${control.folder}/${control.name}`];
    const res = stack.probe(urls.map((p) => apiRequest('GET', p))).results;
    const served = links.map((l, i) => ({ l, r: res[i], hash: hashes[i] }))
      .filter(({ r, hash }) => r.error || r.status !== 404 || r.bodySha256 === hash || /PRIVATE KEY/.test(r.body ?? ''))
      // Status and what was found only: never the body.
      .map(({ l, r, hash }) => `${l.relative ? 'relative' : 'absolute'} link to ${l.target}: ${r.status ?? r.error}, the key's bytes ${r.bodySha256 === hash ? 'served' : 'not served'}, PRIVATE KEY in the body: ${/PRIVATE KEY/.test(r.body ?? '')}`);
    console.log(`planted links: ${links.length} (${links.filter((l) => l.relative).length} relative) to the edge's keys, answers ${JSON.stringify(tally(res.slice(0, links.length)))}; control file ${res.at(-1).status}`);
    assert.deepEqual(served, [], "the edge's private keys were served through a planted link");
    const ctl = res.at(-1);
    assert.equal(ctl.status, 200, `a stored file next to the links: ${ctl.status ?? ctl.error}`);
    assert.equal(ctl.bodySha256, sha256(control.bytes), 'the control file is not the stored bytes');
    // The links are in the volume the file server reads, and resolve to nothing there.
    const inMedia = stack.sh('media', links.map((l) => `test -L '${l.file.replace('/app/storage/', '/srv/storage/')}' && ! test -e '${l.file.replace('/app/storage/', '/srv/storage/')}' && echo ok`).join('; '));
    assert.equal(inMedia.stdout.trim().split(/\s+/).filter((w) => w === 'ok').length, links.length, `media does not see the links as dangling: ${inMedia.stderr}`);
  } finally {
    remove('node', planted);
  }
});

// --------------------------------------------------------------------------- headers

check('F-30: every kind of answer carries the security headers, and http redirects to https', () => {
  const png1 = png([0x11, 0x22, 0x33]);
  const name = storedName('png');
  plant('node', `/app/storage/avatars/${name}`, png1);
  try {
    const big = JSON.stringify({ email: 'x'.repeat(200 * 1024) });
    const kinds = [
      ['Laravel 200', apiRequest('GET', '/api/health'), 200],
      ['Laravel 401', apiRequest('GET', '/api/user'), 401],
      ['Laravel 405', apiRequest('GET', '/api/login'), 405],
      ['Laravel 422', apiRequest('POST', '/api/login', { json: {} }), 422],
      ['Node 401 through Laravel', apiRequest('GET', '/api/activities'), 401],
      ['Node 404 through Laravel', apiRequest('GET', `/api/stack-${crypto.randomBytes(4).toString('hex')}`), 404],
      // Both answers of the upload route keep its own, stricter policy (sandbox).
      ['caddy file 200', apiRequest('GET', `/storage/avatars/${name}`), 200, 'upload'],
      ['caddy file 404', apiRequest('GET', `/storage/avatars/${storedName('jpg')}`), 404, 'upload'],
      ['caddy 404 under /storage', apiRequest('GET', '/storage/x.php'), 404],
      ['caddy 413 body too large', apiRequest('POST', '/api/login', { body: big, headers: { 'Content-Type': 'application/json' } }), 413],
    ];
    const res = stack.probe(kinds.map(([, spec]) => spec)).results;
    const rules = {
      'Strict-Transport-Security max-age >= 1 year': (r) => Number(/max-age=(\d+)/.exec(header(r, 'strict-transport-security') ?? '')?.[1]) >= 31536000,
      'X-Content-Type-Options nosniff': (r) => header(r, 'x-content-type-options') === 'nosniff',
      'X-Frame-Options DENY': (r) => header(r, 'x-frame-options') === 'DENY',
      'Content-Security-Policy': (r, kind) => (kind === 'upload'
        ? /default-src 'none'/.test(header(r, 'content-security-policy') ?? '') && /sandbox/.test(header(r, 'content-security-policy') ?? '')
        : /frame-ancestors 'none'/.test(header(r, 'content-security-policy') ?? '')),
      'Referrer-Policy no-referrer': (r) => header(r, 'referrer-policy') === 'no-referrer',
      'Permissions-Policy': (r) => /camera=\(\)/.test(header(r, 'permissions-policy') ?? '') && /geolocation=\(\)/.test(header(r, 'permissions-policy') ?? ''),
      'no Server header': (r) => header(r, 'server') === undefined,
      'no X-Powered-By header': (r) => header(r, 'x-powered-by') === undefined,
    };
    const problems = [];
    kinds.forEach(([label, , status, kind], i) => {
      const r = res[i];
      if (r.status !== status) problems.push(`${label}: status ${r.status ?? r.error}, expected ${status}`);
      for (const [rule, ok] of Object.entries(rules)) if (!ok(r, kind)) problems.push(`${label}: ${rule}`);
    });
    console.log(`headers: ${kinds.length} kinds of answer x ${Object.keys(rules).length} rules = ${kinds.length * Object.keys(rules).length} checks`);
    assert.deepEqual(problems, []);

    const redirect = stack.request({ method: 'GET', path: '/api/health', scheme: 'http' });
    assert.ok([301, 308].includes(redirect.status), `http answered ${redirect.status ?? redirect.error}`);
    assert.equal(header(redirect, 'location'), `https://${domain}/api/health`);
  } finally {
    remove('node', [`/app/storage/avatars/${name}`]);
  }
});

check("F-28: Apache's own redirects through the edge keep the public https address, not port 8080", () => {
  // Laravel's public/.htaccess redirects a path with a trailing slash; Apache writes the address.
  const cases = [['GET', '/api/health/'], ['GET', '/api/activities/'], ['POST', '/api/login/']];
  const res = stack.probe(cases.map(([method, p]) => apiRequest(method, p, method === 'GET' ? {} : { json: {} }))).results;
  const wrong = cases.map(([method, p], i) => ({ method, p, r: res[i], want: `https://${domain}${p.slice(0, -1)}` }))
    .filter(({ r, want }) => r.status !== 301 || header(r, 'location') !== want)
    .map(({ method, p, r, want }) => `${method} ${p}: ${r.status ?? r.error} to ${header(r, 'location')} (expected 301 to ${want})`);
  console.log(`trailing-slash redirects: ${cases.length} requests, locations ${JSON.stringify(res.map((r) => header(r, 'location')))}`);
  assert.deepEqual(wrong, [], "redirects that leave the public address (Apache's own port or scheme)");
  for (const r of res) assert.doesNotMatch(header(r, 'location') ?? '', /:8080|^http:/, 'a redirect names port 8080 or plain http');
});

// --------------------------------------------------------------------------- one owner per path

check('F-10: every API route Laravel owns is answered by Laravel through the edge, and other /api paths reach Node', () => {
  const r = stack.exec('api', ['php', 'artisan', 'route:list', '--json']);
  assert.equal(r.status, 0, r.stderr);
  const routes = JSON.parse(r.stdout).filter((x) => x.uri.startsWith('api/') && x.uri !== 'api/{path?}');
  const calls = routes.flatMap((x) => x.method.split('|').filter((m) => m !== 'HEAD').map((method) => ({ method, uri: x.uri })));
  console.log(`Laravel routes under /api: ${routes.length}; ${calls.length} method and path pairs requested through the edge`);
  assert.ok(routes.length >= 10, `only ${routes.length} Laravel routes found`);
  const res = stack.probe(calls.map((c) => apiRequest(c.method, `/${c.uri.replace(/\{[^}]+\}/g, '1')}`, c.method === 'GET' ? {} : { json: {} }))).results;
  const wrong = calls.map((c, i) => ({ c, r: res[i] }))
    .filter(({ r: a }) => a.error || a.status === 404 || a.status >= 500 || header(a, 'x-goenn-backend'))
    .map(({ c, r: a }) => `${c.method} /${c.uri}: ${a.status ?? a.error} ${header(a, 'x-goenn-backend') ?? ''}`);
  assert.deepEqual(wrong, [], 'routes that did not reach Laravel through the edge');
  const control = stack.request(apiRequest('GET', `/api/stack-${crypto.randomBytes(4).toString('hex')}`));
  assert.equal(control.status, 404);
  assert.equal(header(control, 'x-goenn-backend'), 'node-fallback', 'an unknown /api path does not reach Node');
});

check('F-01: other spellings of a Laravel path never reach Node through the edge', () => {
  const user = register('stackvariant');
  const variants = ['/api/Login', '/api//login', '/api/./login', '/api/x/../login', '/api/%4Cogin', '/api/%254Cogin', '/api/login%2F'];
  const res = stack.probe([
    ...variants.map((p) => apiRequest('POST', p, { json: {} })),
    apiRequest('GET', '/api/login'),
    apiRequest('GET', '/api/activities', { token: user.token }),
  ]).results;
  console.log(`variants: ${variants.length} spellings of /api/login, answers ${JSON.stringify(tally(res.slice(0, variants.length)))}`);
  const wrong = variants.map((p, i) => ({ p, r: res[i] }))
    .filter(({ r }) => header(r, 'x-goenn-backend') || r.status !== 404)
    .map(({ p, r }) => `${p}: ${r.status ?? r.error} ${header(r, 'x-goenn-backend') ?? ''}`);
  assert.deepEqual(wrong, [], 'variants that reached Node or did not answer 404');
  assert.equal(res[variants.length].status, 405, 'GET /api/login');
  const node = res[variants.length + 1];
  assert.equal(node.status, 200, `a Node path: ${redact(node)}`);
  assert.equal(header(node, 'x-goenn-backend'), 'node-fallback');
});

// --------------------------------------------------------------------------- end to end

check('F-10: sign-up, an event with an image and the image itself, end to end through the edge', () => {
  const user = register('stackevent');
  const starts = new Date(Date.now() + 86_400_000).toISOString().replace(/T.*$/, 'T18:00:00Z');
  const created = stack.request(imageUpload('/api/activities', user.token, {
    title: 'Stack-Test',
    description: 'Läuft im Container',
    location: 'Göttingen',
    starts_at: starts,
  }, 'banner', png()));
  assert.ok([200, 201].includes(created.status), `event: ${redact(created)}`);
  const banner = created.json?.data?.banner_url ?? '';
  const prefix = `https://${domain}/storage/banners/`;
  assert.ok(banner.startsWith(prefix), `banner_url ${banner}`);
  const image = stack.request(apiRequest('GET', banner.slice(`https://${domain}`.length)));
  console.log(`event ${created.json?.data?.id}: banner ${image.status} ${header(image, 'content-type')} (${image.bodyBytes} bytes)`);
  assert.equal(image.status, 200, redact(image));
  assert.match(header(image, 'content-type') ?? '', /^image\/(png|jpeg|webp)$/);
  assert.equal(header(image, 'x-content-type-options'), 'nosniff');
});

check('F-14: a sign-up without the age confirmation is refused, and the word filter names a blocked username', () => {
  const identity = testIdentity('stackconsent');
  const password = freshPassword();
  const base = { name: identity.name, email: identity.email, password, account_type: 'standard', terms_version: legal.terms_version };
  // A username the filter blocks on its own (a term from shared/blocked-terms.json), so the 422 is
  // about the username and nothing else.
  const term = BLOCKED_TERMS.groups.filter((g) => (g.modes ?? []).includes('username'))
    .flatMap((g) => g.substring ?? []).find((t) => /^[a-z]{4,14}$/.test(t) && findBlockedTerm(`x${t}x`, BLOCKED_TERMS, 'username'));
  assert.ok(term, 'no blocked username term found in shared/blocked-terms.json');
  const blockedName = `x${term}x${uniqueStamp()}`;
  const [noAge, blocked] = stack.probe([
    apiRequest('POST', '/api/register', { json: { ...base, username: identity.username } }),
    apiRequest('POST', '/api/register', { json: { ...base, username: blockedName, email: `filter-${identity.email}`, confirmed_min_age: legal.min_age } }),
  ], { index: 2 }).results;
  assert.equal(noAge.status, 422, redact(noAge));
  assert.ok(noAge.json?.errors?.confirmed_min_age, 'the refusal does not name confirmed_min_age');
  assert.equal(blocked.status, 422, redact(blocked));
  assert.ok(blocked.json?.errors?.username, 'the refusal does not name the username');
  assert.deepEqual(Object.keys(blocked.json.errors), ['username'], 'refused for another reason as well');
});

check('F-09: the reset code mail reaches the CI mail catcher, the code works once, and it is in no container log', async () => {
  const user = register('stackreset', 2);
  const forgot = stack.request(apiRequest('POST', '/api/forgot-password', { json: { email: user.email } }), 2);
  assert.equal(forgot.status, 200, redact(forgot));
  // Mailpit's API, asked from inside the stack (the probe cannot reach the app network).
  const fetchJson = (url) => {
    const r = stack.exec('api', ['php', '-r', 'echo file_get_contents($argv[1]);', url]);
    return r.status === 0 ? JSON.parse(r.stdout) : null;
  };
  const search = `http://mailpit:8025/api/v1/search?query=${encodeURIComponent(`to:"${user.email}"`)}`;
  const found = await waitFor('the reset mail in Mailpit', () => {
    const list = fetchJson(search);
    return list?.messages?.length ? list : null;
  }, { ms: 60_000 });
  assert.equal(found.messages.length, 1, 'one mail for the address');
  const message = fetchJson(`http://mailpit:8025/api/v1/message/${found.messages[0].ID}`);
  const codes = [...new Set([...String(message?.Text ?? '').matchAll(/(?<!\d)(\d{6})(?!\d)/g)].map((m) => m[1]))];
  assert.equal(codes.length, 1, `the mail holds ${codes.length} six-digit numbers`);
  const [code] = codes;
  assert.ok(!String(message.Subject).includes(code), 'the subject holds the code');

  const next = freshPassword();
  const body = { email: user.email, code, password: next, password_confirmation: next };
  const reset = stack.request(apiRequest('POST', '/api/reset-password', { json: body }), 2);
  assert.equal(reset.status, 200, redact(reset));
  const again = stack.request(apiRequest('POST', '/api/reset-password', { json: { ...body, password: `${next}x`, password_confirmation: `${next}x` } }), 2);
  assert.equal(again.status, 422, 'the code worked twice');
  const login = stack.request(apiRequest('POST', '/api/login', { json: { email: user.email, password: next } }), 2);
  assert.equal(login.status, 200, `sign-in with the new password: ${redact(login)}`);

  const logs = stack.compose(['logs', '--no-color'], { profiles: ['tools', 'test'] });
  assert.equal(logs.status, 0, logs.stderr);
  const lines = logs.stdout.split(/\r?\n/);
  const services = new Set(lines.map((l) => /^(\S+?)-\d+\s+\|/.exec(l)?.[1]).filter(Boolean));
  console.log(`logs: ${lines.length} lines of ${services.size} containers searched`);
  assert.ok(lines.length > 10 && services.size >= 5, 'too few logs to search');
  // A fraction of a second (".123456") is not the code.
  const codeAt = new RegExp(`(?<![\\d.])${code}(?!\\d)`);
  const leaks = [];
  lines.forEach((line, i) => {
    const where = `${/^(\S+)\s+\|/.exec(line)?.[1] ?? '?'} line ${i + 1}`;
    if (codeAt.test(line)) leaks.push(`${where}: the reset code`);
    for (const [what, value] of [['a password', user.password], ['a password', next], ['the admin password', S.admin.password]]) {
      if (line.includes(value)) leaks.push(`${where}: ${what}`);
    }
  });
  assert.deepEqual(leaks, []);
});

check("F-31: Node's per-address limit counts the visitor's own address, and a client-sent X-Forwarded-For changes nothing", () => {
  // The webhook's limit: per address only (server/src/rate-limit.js), with nothing in front of it.
  const spec = defaultWriteLimit('webhook');
  const m = /^ip:(\d+)\/(\d+)([smhd])$/.exec(spec);
  assert.ok(m, `the webhook limit is not one address rule: ${spec}`);
  const max = Number(m[1]);
  const windowMs = Number(m[2]) * { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[3]];
  const hook = apiRequest('POST', '/api/webhooks/revenuecat', { json: {} });
  const forged = (address) => ({ ...hook, headers: { ...hook.headers, 'X-Forwarded-For': address } });

  const t0 = Date.now();
  const a = stack.probe([{ ...hook, repeat: max, concurrency: 8 }, hook, forged('203.0.113.7')], { index: 1 });
  const b = stack.probe([hook, forged(a.address[0])], { index: 2 });
  const aAgain = stack.request(hook, 1);
  const elapsed = Date.now() - t0;
  const [burst, over, overForged] = a.results;
  const [bPlain, bAsA] = b.results;
  const counts = burst.statuses.reduce((acc, s) => ({ ...acc, [s]: (acc[s] ?? 0) + 1 }), {});
  console.log(`limit ${spec}: visitor A ${a.address.join(',')} sent ${max} (${JSON.stringify(counts)}), then ${over.status}, forged ${overForged.status}; `
    + `visitor B ${b.address.join(',')}: ${bPlain.status}, claiming A's address ${bAsA.status}; A again ${aAgain.status}; ${elapsed} ms`);
  assert.notEqual(a.address[0], b.address[0], 'the two visitors share an address');
  assert.equal(counts[429] ?? 0, 0, 'limited before the limit');
  assert.equal(Object.keys(counts).length, 1, `mixed answers inside the limit: ${JSON.stringify(counts)}`);
  assert.ok(elapsed < windowMs, `the checks took ${elapsed} ms, longer than the limit's window: the result proves nothing`);
  assert.equal(over.status, 429, 'one more than the limit from the same address');
  assert.equal(header(over, 'x-goenn-backend'), 'node-fallback', "the 429 is not Node's");
  assert.equal(overForged.status, 429, 'a forged X-Forwarded-For moved visitor A into another bucket');
  assert.notEqual(bPlain.status, 429, "visitor B is counted in A's bucket: Node does not count the visitor's own address");
  assert.notEqual(bAsA.status, 429, "visitor B claiming A's address in X-Forwarded-For was counted as A");
  assert.equal(aAgain.status, 429, "A's window had closed before B's checks: the result proves nothing");
});

check('account deletion: Laravel checks, Node deletes over its internal route, and the token opens nothing afterwards', () => {
  const user = register('stackdelete');
  const del = stack.request(apiRequest('DELETE', '/api/me', { token: user.token, json: { password: user.password } }));
  assert.equal(del.status, 200, `DELETE /api/me: ${redact(del)}`);
  const res = stack.probe([
    apiRequest('GET', '/api/user', { token: user.token }),
    apiRequest('GET', '/api/activities', { token: user.token }),
    apiRequest('GET', '/internal/health'),
    apiRequest('DELETE', `/internal/accounts/${user.id ?? 1}`, { json: {} }),
  ]).results;
  console.log(`after the deletion: /api/user ${res[0].status}, /api/activities ${res[1].status}; Node's internal routes from the edge: ${res[2].status}, ${res[3].status}`);
  assert.equal(res[0].status, 401);
  assert.equal(res[1].status, 401);
  assert.equal(query(`SELECT COUNT(*) FROM users WHERE email = '${user.email}'`)[0], '0', 'the account row is still there');
  for (const r of res.slice(2)) {
    assert.ok(r.status === 404 || r.status === 405, `Node's internal route answered ${r.status} through the edge`);
    assert.equal(header(r, 'x-goenn-backend'), undefined, "Node's internal route is reachable through the edge");
  }
});

// --------------------------------------------------------------------------- backups

check('F-17: the backup writes a database dump and an archive of the uploads and private media, with checksums', () => {
  const pubName = storedName('png');
  const privName = storedName('png');
  const planted = [`/app/storage/posts/${pubName}`, `/app/storage-private/evidence/${privName}`];
  for (const file of planted) plant('node', file, png([0x44, 0x55, 0x66]));
  try {
    const run = stack.exec('backup', ['bash', '/opt/deploy/backup.sh', '--once']);
    assert.equal(run.status, 0, `backup.sh --once: ${tail(run.stdout + run.stderr)}`);
    const stamp = /run (\S+) written/.exec(run.stdout)?.[1];
    assert.ok(stamp, `no "written" line: ${tail(run.stdout)}`);
    const files = [`db-${stamp}.sql.gz`, `uploads-${stamp}.tar.gz`, `SHA256SUMS-${stamp}`];
    const listed = stack.exec('backup', ['ls', '-1', '/backups']).stdout.split(/\s+/);
    assert.deepEqual(files.filter((f) => !listed.includes(f)), [], 'missing from /backups');
    assert.equal(stack.sh('backup', `cd /backups && sha256sum --check --quiet SHA256SUMS-${stamp}`).status, 0, 'the checksums do not verify');

    const dumped = stack.sh('backup', `gzip -dc /backups/db-${stamp}.sql.gz | sed -n 's/^-- Table structure for table \`\\(.*\\)\`$/\\1/p'`).stdout.trim().split(/\r?\n/).filter(Boolean).sort();
    const tables = query("SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'").sort();
    console.log(`dump ${stamp}: ${dumped.length} tables; the database has ${tables.length}`);
    assert.ok(tables.length > 10, `only ${tables.length} tables in the database`);
    assert.deepEqual(dumped, tables, 'the dump does not hold exactly the tables of the database');

    const archived = stack.exec('backup', ['tar', '-tzf', `/backups/uploads-${stamp}.tar.gz`]).stdout.split(/\r?\n/).filter(Boolean);
    console.log(`archive ${stamp}: ${archived.length} entries`);
    for (const entry of [`uploads/posts/${pubName}`, `private-media/evidence/${privName}`]) assert.ok(archived.includes(entry), `${entry} is not in the archive`);
  } finally {
    remove('node', planted);
  }
});

check('F-17: pruning deletes only expired sets, and only after a successful run', async () => {
  const days = Number(values.BACKUP_RETENTION_DAYS);
  assert.ok(days >= 1, 'BACKUP_RETENTION_DAYS');
  const now = Math.floor(Date.now() / 1000);
  const set = (stamp) => [`db-${stamp}.sql.gz`, `uploads-${stamp}.tar.gz`, `SHA256SUMS-${stamp}`];
  const old = set('19990101T000000Z');
  const recent = set('19990102T000000Z');
  const touch = stack.sh('backup', [
    `cd /backups && touch ${[...old, ...recent].join(' ')}`,
    `touch -d @${now - (days + 3) * 86400} ${old.join(' ')}`,
    `touch -d @${now - 2 * 86400} ${recent.join(' ')}`,
  ].join(' && '));
  assert.equal(touch.status, 0, touch.stderr);
  const list = () => stack.exec('backup', ['ls', '-1', '/backups']).stdout.split(/\s+/).filter(Boolean);
  const pause = () => new Promise((r) => setTimeout(r, 1100));
  try {
    await pause();
    const failed = stack.compose(['exec', '-T', '-e', 'DB_PASSWORD=wrong-ci-only-not-a-secret', 'backup', 'bash', '/opt/deploy/backup.sh', '--once']);
    const afterFailure = list();
    const checkAfterFailure = stack.exec('backup', ['bash', '/opt/deploy/backup.sh', '--check']).status;
    await pause();
    const ok = stack.exec('backup', ['bash', '/opt/deploy/backup.sh', '--once']);
    const afterSuccess = list();
    const checkAfterSuccess = stack.exec('backup', ['bash', '/opt/deploy/backup.sh', '--check']).status;
    const stamp = /run (\S+) written/.exec(ok.stdout)?.[1];
    console.log(`prune (retention ${days} days): failed run exit ${failed.status}, --check ${checkAfterFailure}; good run exit ${ok.status}, --check ${checkAfterSuccess}; ${/pruned \d+ file\(s\)[^\n]*/.exec(ok.stdout)?.[0]}`);
    assert.notEqual(failed.status, 0, 'a run with a wrong password succeeded');
    assert.deepEqual([...old, ...recent].filter((f) => !afterFailure.includes(f)), [], 'a failed run deleted files');
    assert.equal(checkAfterFailure, 1, '--check after a failed run');
    assert.equal(ok.status, 0, tail(ok.stdout + ok.stderr));
    assert.deepEqual(old.filter((f) => afterSuccess.includes(f)), [], 'expired files were kept');
    assert.deepEqual(recent.filter((f) => !afterSuccess.includes(f)), [], 'files inside the retention were deleted');
    assert.deepEqual(set(stamp).filter((f) => !afterSuccess.includes(f)), [], 'the new set is missing');
    assert.match(ok.stdout, new RegExp(`pruned ${old.length} file\\(s\\)`));
    assert.equal(checkAfterSuccess, 0, '--check after a good run');
  } finally {
    stack.sh('backup', `cd /backups && rm -f ${[...old, ...recent].join(' ')}`);
  }
});

// --------------------------------------------------------------------------- logs

check('F-45: every container rotates its log with the configured limits', () => {
  const all = stack.containers();
  console.log(`log rotation: ${all.length} containers checked (max-size ${values.LOG_MAX_SIZE}, max-file ${values.LOG_MAX_FILES})`);
  assert.ok(all.length >= 8, `only ${all.length} containers`);
  const wrong = all.filter((c) => {
    const log = c.HostConfig.LogConfig ?? {};
    return log.Type !== 'local' || log.Config?.['max-size'] !== values.LOG_MAX_SIZE || log.Config?.['max-file'] !== values.LOG_MAX_FILES;
  }).map((c) => `${c.Name.replace(/^\//, '')}: ${JSON.stringify(c.HostConfig.LogConfig)}`);
  assert.deepEqual(wrong, []);
});

check('F-45: the MySQL binary log keeps exactly the configured retention, not the MySQL default', () => {
  const [row] = query('SELECT @@log_bin, @@binlog_expire_logs_seconds');
  const [logBin, seconds] = row.split(/\s+/).map(Number);
  const days = values.MYSQL_BINLOG_RETENTION_DAYS;
  console.log(`binary log: log_bin ${logBin}, binlog_expire_logs_seconds ${seconds} (MYSQL_BINLOG_RETENTION_DAYS=${days})`);
  if (days === 'off') {
    assert.equal(logBin, 0, 'the binary log is on');
  } else {
    assert.equal(logBin, 1);
    assert.equal(seconds, Number(days) * 86400, 'the retention is not the configured one');
  }
  assert.notEqual(seconds, 2592000, "MySQL's own default (30 days)");
});
