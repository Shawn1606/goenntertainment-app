/**
 * Uploads are real images, stored without metadata (F-11).
 *
 * The upload entry points (denominator: 7 routes on 5 write sites; the sixth write site, the AI
 * moderation's evidence, is tested in test/moderation.test.js): POST /api/activities (banner),
 * /api/me/avatar, /api/me/banner, /api/posts, /api/stories (image), /api/admin/users/:id/ban and
 * /timeout (evidence). Every test sends the same bytes to every route where it can, and reads the
 * stored file back over HTTP from the address the API answers with (with the uploader's token,
 * so it works wherever a file is served).
 *
 * A structural test checks that no source file writes a file except src/storage.js, which takes
 * only images that went through src/images.js.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { createApp } from '../src/app.js';
import { FUNCTIONAL_WRITE_LIMITS } from './support/app.js';
import { ensureSchema, first, pool } from '../src/db.js';
import { cleanup, createUser } from './support/fixtures.js';
import {
  hasMetadataTrace,
  JPEG_8X4,
  JPEG_8X8,
  jpegSize,
  MALFORMED_PNG,
  METADATA_MARKER,
  NOT_AN_IMAGE,
  PNG_1X1,
  pngOfSize,
  WEBP_8X8,
  withJpegExif,
  withPngText,
  withTrailer,
  withWebpExif,
} from './support/images.js';

const MSG_BANNER = 'Das Banner muss ein Bild sein (jpeg, png, webp).';
const MSG_IMAGE = 'Das Bild muss jpeg, png oder webp sein.';
const MSG_EVIDENCE = 'Der Beweis muss ein Bild sein (jpeg, png, webp).';

const SRC_DIR = path.resolve(import.meta.dirname, '..', 'src');

let base;
let server;
let creator;
let admin;
let target;

before(async () => {
  await ensureSchema();
  server = createApp({ writeLimits: FUNCTIONAL_WRITE_LIMITS }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  creator = await createUser('imgcreator', { accountType: 'creator' });
  admin = await createUser('imgadmin', { isAdmin: true });
  target = await createUser('imgtarget');
});

after(async () => {
  try {
    await cleanup();
  } finally {
    await pool.end();
    server?.close();
  }
});

const count = async (sql, params) => Number((await first(sql, params)).c);

/** Evidence ids of the target, newest first. */
async function evidenceIds() {
  const res = await fetch(`${base}/api/admin/evidence`, { headers: { Authorization: `Bearer ${admin.token}` } });
  assert.equal(res.status, 200);
  return (await res.json()).data.filter((e) => e.user.id === target.user.id);
}

function form(fields) {
  const f = new FormData();
  for (const [name, value] of Object.entries(fields)) f.append(name, value);
  return f;
}

/**
 * Every upload route: how to send an image to it, where the API says the stored file is, and a
 * count of what it has stored (to show that a refused upload stored nothing).
 */
function uploadRoutes() {
  const eventFields = () => ({
    title: 'Bildertest',
    description: 'Wir testen Bilder.',
    location: 'Teststrasse 1, 50667 Koeln',
    starts_at: new Date(Date.now() + 86_400_000).toISOString(),
  });
  const evidenceUrl = async (before) => {
    const known = new Set(before.map((e) => e.id));
    const created = (await evidenceIds()).find((e) => !known.has(e.id));
    return created?.image_url ?? null;
  };
  return [
    {
      name: 'POST /api/activities',
      path: '/api/activities',
      token: creator.token,
      field: 'banner',
      message: MSG_BANNER,
      fields: eventFields,
      url: async (json) => json.data.banner_url,
      stored: () => count('SELECT COUNT(*) AS c FROM activities WHERE user_id = ?', [creator.user.id]),
    },
    {
      name: 'POST /api/me/avatar',
      path: '/api/me/avatar',
      token: creator.token,
      field: 'image',
      message: MSG_IMAGE,
      fields: () => ({}),
      url: async (json) => json.user.avatar,
      stored: async () => (await first('SELECT avatar FROM users WHERE id = ?', [creator.user.id])).avatar,
    },
    {
      name: 'POST /api/me/banner',
      path: '/api/me/banner',
      token: creator.token,
      field: 'image',
      message: MSG_IMAGE,
      fields: () => ({}),
      url: async (json) => json.user.banner,
      stored: async () => (await first('SELECT banner FROM users WHERE id = ?', [creator.user.id])).banner,
    },
    {
      name: 'POST /api/posts',
      path: '/api/posts',
      token: creator.token,
      field: 'image',
      message: MSG_IMAGE,
      fields: () => ({ body: 'Mit Bild' }),
      url: async (json) => json.data.image_url,
      stored: () => count('SELECT COUNT(*) AS c FROM posts WHERE user_id = ?', [creator.user.id]),
    },
    {
      name: 'POST /api/stories',
      path: '/api/stories',
      token: creator.token,
      field: 'image',
      message: MSG_IMAGE,
      fields: () => ({ caption: 'Mit Bild' }),
      url: async (json) => json.data.image_url,
      stored: () => count('SELECT COUNT(*) AS c FROM stories WHERE user_id = ?', [creator.user.id]),
    },
    {
      name: 'POST /api/admin/users/:id/ban',
      path: `/api/admin/users/${target.user.id}/ban`,
      token: admin.token,
      field: 'evidence',
      message: MSG_EVIDENCE,
      evidence: true,
      fields: () => ({ reason: 'Test-Grund' }),
      url: async (json, before) => evidenceUrl(before),
      stored: () => count('SELECT COUNT(*) AS c FROM ban_evidence WHERE user_id = ?', [target.user.id]),
    },
    {
      name: 'POST /api/admin/users/:id/timeout',
      path: `/api/admin/users/${target.user.id}/timeout`,
      token: admin.token,
      field: 'evidence',
      message: MSG_EVIDENCE,
      evidence: true,
      fields: () => ({ reason: 'Test-Grund', minutes: '5' }),
      url: async (json, before) => evidenceUrl(before),
      stored: () => count('SELECT COUNT(*) AS c FROM ban_evidence WHERE user_id = ?', [target.user.id]),
    },
  ];
}

/** Sends `bytes` (declared as `mime`) to a route; returns the status and the parsed answer. */
async function send(route, bytes, mime, filename = 'bild') {
  const before = route.evidence ? await evidenceIds() : null;
  const f = form(route.fields());
  f.append(route.field, new Blob([bytes], { type: mime }), filename);
  const res = await fetch(`${base}${route.path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${route.token}`, Accept: 'application/json' },
    body: f,
  });
  return { status: res.status, json: await res.json(), before };
}

/** Uploads `bytes` and reads the stored file back: its address, type and bytes. */
async function uploadAndFetch(route, bytes, mime) {
  const sent = await send(route, bytes, mime);
  assert.ok([200, 201].includes(sent.status), `${route.name}: ${sent.status} ${JSON.stringify(sent.json)}`);
  const url = await route.url(sent.json, sent.before);
  assert.ok(url, `${route.name}: no address for the stored file`);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${route.token}` } });
  assert.equal(res.status, 200, `${route.name}: fetching ${url}`);
  return { url, type: res.headers.get('content-type'), bytes: Buffer.from(await res.arrayBuffer()) };
}

test('bytes that are not an image are refused at every upload route, and nothing is stored', async () => {
  const routes = uploadRoutes();
  assert.equal(routes.length, 7, 'denominator: every upload route');
  for (const route of routes) {
    const before = await route.stored();
    const sent = await send(route, NOT_AN_IMAGE, 'image/png', 'bild.png');
    assert.equal(sent.status, 422, `${route.name}: ${JSON.stringify(sent.json)}`);
    assert.equal(sent.json.message, route.message, route.name);
    if (!route.evidence) assert.deepEqual(sent.json.errors?.[route.field], [route.message], route.name);
    assert.deepEqual(await route.stored(), before, `${route.name}: nothing may be stored`);
  }
});

test('a PNG signature with broken image data is refused', async () => {
  const route = uploadRoutes().find((r) => r.name === 'POST /api/me/avatar');
  const sent = await send(route, MALFORMED_PNG, 'image/png', 'kaputt.png');
  assert.equal(sent.status, 422, JSON.stringify(sent.json));
  assert.deepEqual(sent.json.errors.image, [MSG_IMAGE]);
});

test('an image over the pixel limit is refused before it is decoded', async () => {
  const route = uploadRoutes().find((r) => r.name === 'POST /api/me/avatar');
  // 8001 x 6250 = 50,006,250 pixels, a few kilobytes as a file.
  const sent = await send(route, pngOfSize(8001, 6250), 'image/png', 'riesig.png');
  assert.equal(sent.status, 422, JSON.stringify(sent.json));
  assert.deepEqual(sent.json.errors.image, [MSG_IMAGE]);
});

test('JPEG EXIF and GPS data are removed at every upload route', async () => {
  const withExif = withJpegExif(JPEG_8X8);
  assert.ok(hasMetadataTrace(withExif), 'precondition: the upload carries the metadata');
  const routes = uploadRoutes();
  assert.equal(routes.length, 7, 'denominator: every upload route');
  for (const route of routes) {
    const stored = await uploadAndFetch(route, withExif, 'image/jpeg');
    assert.equal(stored.bytes[0], 0xff, `${route.name}: still a JPEG`);
    assert.equal(hasMetadataTrace(stored.bytes), false, `${route.name}: metadata left in ${stored.url}`);
  }
});

test('the EXIF orientation is applied before the metadata goes', async () => {
  const route = uploadRoutes().find((r) => r.name === 'POST /api/posts');
  const stored = await uploadAndFetch(route, withJpegExif(JPEG_8X4, { orientation: 6 }), 'image/jpeg');
  // 8 wide and 4 high, rotated by 90 degrees: the stored picture stands upright.
  assert.deepEqual(jpegSize(stored.bytes), { width: 4, height: 8 });
  assert.equal(hasMetadataTrace(stored.bytes), false);
});

test('PNG text and eXIf chunks are removed', async () => {
  const route = uploadRoutes().find((r) => r.name === 'POST /api/me/avatar');
  const stored = await uploadAndFetch(route, withPngText(PNG_1X1), 'image/png');
  assert.equal(hasMetadataTrace(stored.bytes), false, stored.url);
  assert.ok(!stored.bytes.includes(Buffer.from(METADATA_MARKER)), stored.url);
});

test('WebP EXIF is removed, and a WebP is stored as .webp', async () => {
  const route = uploadRoutes().find((r) => r.name === 'POST /api/posts');
  const stored = await uploadAndFetch(route, withWebpExif(WEBP_8X8), 'image/webp');
  assert.match(stored.url, /\.webp$/);
  assert.equal(stored.bytes.toString('latin1', 8, 12), 'WEBP');
  assert.equal(hasMetadataTrace(stored.bytes), false, stored.url);
});

test('bytes appended after the image are not stored', async () => {
  const route = uploadRoutes().find((r) => r.name === 'POST /api/me/banner');
  const trailer = 'TRAILING-PAYLOAD-0000';
  const stored = await uploadAndFetch(route, withTrailer(PNG_1X1, trailer), 'image/png');
  assert.ok(!stored.bytes.includes(Buffer.from(trailer)), stored.url);
});

test('the stored extension and type follow the bytes, not the declared type', async () => {
  const route = uploadRoutes().find((r) => r.name === 'POST /api/me/avatar');
  const stored = await uploadAndFetch(route, PNG_1X1, 'image/jpeg');
  assert.match(stored.url, /\.png$/);
  assert.match(String(stored.type), /^image\/png/);
});

test('a declared type that is not an image is still refused first (regression)', async () => {
  const route = uploadRoutes().find((r) => r.name === 'POST /api/posts');
  const sent = await send(route, PNG_1X1, 'application/pdf', 'datei.pdf');
  assert.equal(sent.status, 422);
  assert.deepEqual(sent.json.errors.image, [MSG_IMAGE]);
});

test('only src/storage.js writes files (denominator: every source file)', () => {
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
  const writers = files
    .filter((file) => /\b(writeFile|writeFileSync|createWriteStream|appendFile|appendFileSync)\s*\(/.test(fs.readFileSync(file, 'utf8')))
    .map((file) => path.relative(SRC_DIR, file).replaceAll(path.sep, '/'));
  assert.deepEqual(writers, ['storage.js']);
});
