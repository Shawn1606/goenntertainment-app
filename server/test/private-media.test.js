/**
 * Evidence and story images are private (F-11; story images also F-13).
 *
 * Private folders (denominator 2, src/storage.js PRIVATE_FOLDERS): `evidence` (ban and timeout
 * evidence from admins, written by POST /api/admin/users/:id/ban and /timeout; the AI
 * moderation's evidence is tested in test/moderation.test.js) and `stories` (POST /api/stories).
 * Neither may be reachable under the public /storage, in any spelling; evidence is served to
 * admins only, a story image to signed-in viewers while the story runs and no block stands
 * between viewer and author. Every refusal is a 404 that says nothing about the reason.
 *
 * The tests read the addresses the API hands out and fetch them over HTTP, so they make no
 * assumption about where a file lies on disk.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { createApp } from '../src/app.js';
import { FUNCTIONAL_WRITE_LIMITS } from './support/app.js';
import { ensureSchema, first, pool } from '../src/db.js';
import { cleanup, createUser } from './support/fixtures.js';
import { PNG_1X1 } from './support/images.js';

const SRC_DIR = path.resolve(import.meta.dirname, '..', 'src');
/** The public tree as the server serves it (cwd = server/, as `npm test` runs). */
const PUBLIC_ROOT = path.resolve(process.cwd(), 'storage');

let base;
let server;
let author;
let viewer;
let admin;
let target;

before(async () => {
  await ensureSchema();
  server = createApp({ writeLimits: FUNCTIONAL_WRITE_LIMITS }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  author = await createUser('pmauthor', { accountType: 'creator' });
  viewer = await createUser('pmviewer');
  admin = await createUser('pmadmin', { isAdmin: true });
  target = await createUser('pmtarget');
});

after(async () => {
  try {
    await cleanup();
  } finally {
    await pool.end();
    server?.close();
  }
});

const get = (url, token) => fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

/** A story by `who` with an image, created through the API; returns its id and image address. */
async function createStory(who = author) {
  const form = new FormData();
  form.append('caption', 'Private Story');
  form.append('image', new Blob([PNG_1X1], { type: 'image/png' }), 'story.png');
  const res = await fetch(`${base}/api/stories`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${who.token}`, Accept: 'application/json' },
    body: form,
  });
  const json = await res.json();
  assert.equal(res.status, 201, JSON.stringify(json));
  assert.ok(json.data.image_url, 'the story has an image address');
  return { id: json.data.id, url: json.data.image_url };
}

/** Bans `target` with an evidence image (as an admin); returns the evidence image address. */
async function banWithEvidence() {
  const form = new FormData();
  form.append('reason', 'Test-Grund');
  form.append('evidence', new Blob([PNG_1X1], { type: 'image/png' }), 'beweis.png');
  const res = await fetch(`${base}/api/admin/users/${target.user.id}/ban`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${admin.token}`, Accept: 'application/json' },
    body: form,
  });
  assert.equal(res.status, 200, JSON.stringify(await res.json()));
  const list = await (await get(`${base}/api/admin/evidence`, admin.token)).json();
  const entry = list.data.find((e) => e.user.id === target.user.id && e.image_url);
  assert.ok(entry, 'the evidence is listed with an image');
  return entry.image_url;
}

/** The stored file name at the end of an address. */
const fileName = (url) => decodeURIComponent(new URL(url).pathname.split('/').pop());

/** Spellings of a public /storage address for a file in a private folder. */
function publicSpellings(folder, name) {
  return [
    `/storage/${folder}/${name}`,
    `/storage/${folder.toUpperCase()}/${name}`,
    `/storage/%${folder.charCodeAt(0).toString(16)}${folder.slice(1)}/${name}`,
    `/storage/%25${folder.charCodeAt(0).toString(16)}${folder.slice(1)}/${name}`,
    `/storage//${folder}/${name}`,
    `/storage/posts/%2e%2e/${folder}/${name}`,
    `/storage/posts%2f..%2f${folder}/${name}`,
  ];
}

test('ban evidence is served to admins only, and never under /storage', async () => {
  const url = await banWithEvidence();
  assert.doesNotMatch(url, /\/storage\//, `the evidence address is not public: ${url}`);

  assert.equal((await get(url)).status, 401, 'no token');
  assert.equal((await get(url, viewer.token)).status, 403, 'not an admin');

  const res = await get(url, admin.token);
  assert.equal(res.status, 200);
  assert.match(String(res.headers.get('content-type')), /^image\/png/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.match(String(res.headers.get('cache-control')), /no-store/);
  assert.ok(Buffer.from(await res.arrayBuffer()).subarray(0, 8).equals(PNG_1X1.subarray(0, 8)), 'a PNG');

  for (const spelling of publicSpellings('evidence', fileName(url))) {
    assert.equal((await fetch(`${base}${spelling}`)).status, 404, spelling);
  }
});

test('an unknown or malformed evidence file name is a 404 for admins too', async () => {
  for (const name of ['0123456789abcdef0123456789abcdef01234567.png', 'x.png', '..%2f..%2fpackage.json', '.env']) {
    const res = await get(`${base}/api/admin/evidence-files/${name}`, admin.token);
    assert.equal(res.status, 404, name);
  }
});

test('a story image is served to signed-in viewers while the story runs, never under /storage', async () => {
  const story = await createStory();
  assert.doesNotMatch(story.url, /\/storage\//, `the story address is not public: ${story.url}`);

  assert.equal((await get(story.url)).status, 401, 'no token');
  const shown = await get(story.url, viewer.token);
  assert.equal(shown.status, 200);
  assert.match(String(shown.headers.get('content-type')), /^image\/png/);
  assert.equal(shown.headers.get('x-content-type-options'), 'nosniff');
  assert.match(String(shown.headers.get('cache-control')), /no-store/);

  for (const spelling of publicSpellings('stories', fileName(story.url))) {
    assert.equal((await fetch(`${base}${spelling}`)).status, 404, spelling);
  }

  // The listings hand out the same private address.
  const bar = await (await get(`${base}/api/stories`, viewer.token)).json();
  assert.equal(bar.data.find((s) => s.id === story.id)?.image_url, story.url);
});

test('an expired story image is no longer downloadable, by anyone', async () => {
  const story = await createStory();
  assert.equal((await get(story.url, viewer.token)).status, 200, 'precondition: shown while it runs');

  await pool.query('UPDATE stories SET expires_at = NOW() - INTERVAL 1 MINUTE WHERE id = ?', [story.id]);
  for (const who of [viewer, author, admin]) {
    const res = await get(story.url, who.token);
    assert.equal(res.status, 404, `expired story for user ${who.user.id}`);
    assert.equal((await res.json()).message, 'Diese Story gibt es nicht mehr.');
  }
});

test('a block hides a story image in both directions (F-13)', async () => {
  const story = await createStory();
  const blocked = await createUser('pmblocked');
  const blocker = await createUser('pmblocker');
  await pool.query('INSERT INTO user_blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, NOW()), (?, ?, NOW())', [
    author.user.id,
    blocked.user.id,
    blocker.user.id,
    author.user.id,
  ]);

  const expired = await get(`${base}/api/media/stories/0123456789abcdef0123456789abcdef01234567.png`, viewer.token);
  const expiredBody = await expired.json();
  for (const who of [blocked, blocker]) {
    const res = await get(story.url, who.token);
    assert.equal(res.status, 404, `user ${who.user.id} is in a block relation with the author`);
    assert.deepEqual(await res.json(), expiredBody, 'the same answer as for a story that does not exist');
  }
  assert.equal((await get(story.url, author.token)).status, 200, 'the author sees their own story');
  assert.equal((await get(story.url, viewer.token)).status, 200, 'anyone else still sees it');
});

test("a banned author's story image is hidden from viewers, not from admins", async () => {
  const banned = await createUser('pmbanned', { accountType: 'creator' });
  const story = await createStory(banned);
  await pool.query('UPDATE users SET banned_until = NOW() + INTERVAL 1 DAY WHERE id = ?', [banned.user.id]);

  assert.equal((await get(story.url, viewer.token)).status, 404, 'the listings hide it, so does the image');
  assert.equal((await get(story.url, admin.token)).status, 200, 'admins moderate stories of banned accounts');
});

test('a deleted story takes its private image with it', async () => {
  const story = await createStory();
  const res = await fetch(`${base}/api/stories/${story.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${author.token}` },
  });
  assert.equal(res.status, 200);
  assert.equal((await get(story.url, admin.token)).status, 404);
});

test('the public tree refuses the private folders in any spelling, even for an old file left there', async () => {
  // A file in the old public place under a name storeImage() never gives (so the start-up move
  // leaves it alone): the route must refuse it by its folder.
  const name = `legacy-test-${process.pid}.png`;
  const planted = [];
  try {
    for (const folder of ['evidence', 'stories']) {
      fs.mkdirSync(path.join(PUBLIC_ROOT, folder), { recursive: true });
      const file = path.join(PUBLIC_ROOT, folder, name);
      fs.writeFileSync(file, PNG_1X1);
      planted.push(file);
      for (const spelling of publicSpellings(folder, name)) {
        assert.equal((await fetch(`${base}${spelling}`)).status, 404, spelling);
      }
    }
    // Positive control: a public folder is still served.
    fs.mkdirSync(path.join(PUBLIC_ROOT, 'posts'), { recursive: true });
    const publicFile = path.join(PUBLIC_ROOT, 'posts', name);
    fs.writeFileSync(publicFile, PNG_1X1);
    planted.push(publicFile);
    assert.equal((await fetch(`${base}/storage/posts/${name}`)).status, 200);
  } finally {
    for (const file of planted) fs.rmSync(file, { force: true });
  }
});

test('the sweep removes expired stories and their image files', async () => {
  // Supplementary: sweepExpiredStories runs hourly and at start (src/index.js); the checked route
  // above is what makes expiry exact.
  const { sweepExpiredStories } = await import('../src/stories.js');
  const { resolveStored } = await import('../src/storage.js');
  const story = await createStory();
  const { image_path: value } = await first('SELECT image_path FROM stories WHERE id = ?', [story.id]);
  const file = resolveStored(value);
  assert.ok(file && fs.existsSync(file), 'precondition: the image is stored');

  await pool.query('UPDATE stories SET expires_at = NOW() - INTERVAL 1 MINUTE WHERE id = ?', [story.id]);
  assert.ok((await sweepExpiredStories()) >= 1, 'the sweep reports what it removed');
  assert.equal(await first('SELECT id FROM stories WHERE id = ?', [story.id]), null, 'the row is gone');
  assert.equal(fs.existsSync(file), false, 'the file is gone');
});

test('files an older version left in public storage move to private storage at start', async () => {
  // Supplementary: migrateLegacyPrivateFiles runs before the server listens (src/index.js).
  const { migrateLegacyPrivateFiles, PRIVATE_ROOT } = await import('../src/storage.js');
  const name = `${'0'.repeat(30)}${String(process.pid).padStart(10, '0').slice(-10)}.png`;
  const legacy = path.join(PUBLIC_ROOT, 'evidence', name);
  const moved = path.join(PRIVATE_ROOT, 'evidence', name);
  fs.mkdirSync(path.dirname(legacy), { recursive: true });
  fs.writeFileSync(legacy, PNG_1X1);
  try {
    // (A server started by another test file may move it first; the outcome is what counts.)
    await migrateLegacyPrivateFiles();
    assert.equal(fs.existsSync(legacy), false, 'gone from the public tree');
    assert.ok(fs.readFileSync(moved).equals(PNG_1X1), 'the same bytes in the private tree');
    const url = `${base}/api/admin/evidence-files/${name}`;
    assert.equal((await get(url, admin.token)).status, 200, 'served through the admin route');
    assert.equal(await migrateLegacyPrivateFiles(), 0, 'a second run has nothing to move');
  } finally {
    fs.rmSync(legacy, { force: true });
    fs.rmSync(moved, { force: true });
  }
});

test('every stored-image address is built in src/media.js (denominator: every source file)', () => {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) files.push(full);
    }
  };
  walk(SRC_DIR);
  assert.ok(files.length > 30, `scanned ${files.length} source files`);
  const builders = files
    .filter((file) => /\/storage\/\$\{/.test(fs.readFileSync(file, 'utf8')))
    .map((file) => path.relative(SRC_DIR, file).replaceAll(path.sep, '/'));
  assert.deepEqual(builders, ['media.js']);
});

test('account deletion removes the private files too (story image and evidence)', async () => {
  const leaving = await createUser('pmleaving', { accountType: 'creator' });
  const story = await createStory(leaving);
  const previousTarget = target;
  target = leaving;
  let evidenceUrl;
  try {
    evidenceUrl = await banWithEvidence();
  } finally {
    target = previousTarget;
  }
  const storyRow = await first('SELECT image_path FROM stories WHERE id = ?', [story.id]);
  const evidenceRow = await first('SELECT image_path FROM ban_evidence WHERE user_id = ? AND image_path IS NOT NULL', [
    leaving.user.id,
  ]);
  assert.equal((await get(evidenceUrl, admin.token)).status, 200, 'precondition: the evidence is there');

  const res = await fetch(`${base}/api/admin/users/${leaving.user.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${admin.token}` },
  });
  assert.equal(res.status, 200);

  // Not only unreachable (the rows are gone): the files are gone from the disk.
  const { resolveStored } = await import('../src/storage.js');
  for (const value of [storyRow.image_path, evidenceRow.image_path]) {
    const file = resolveStored(value);
    assert.ok(file, value);
    assert.equal(fs.existsSync(file), false, `${value} must be removed`);
  }
  assert.equal((await get(evidenceUrl, admin.token)).status, 404);
});
