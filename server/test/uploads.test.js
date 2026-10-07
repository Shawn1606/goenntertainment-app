/**
 * Multipart uploads are bounded (F-02) and their errors are the client's (F-38): every upload
 * route reads at most one image in its own field and a fixed number of short, flat text fields;
 * anything else is answered with 400 or 413 (an oversized image with the route's own 422), fast,
 * and never with a 500.
 *
 * The upload routes (denominator: 4 forms on 7 routes): POST /api/activities (banner),
 * POST /api/admin/users/:id/ban and /timeout (evidence), POST /api/me/avatar, /api/me/banner and
 * /api/posts (image), POST /api/stories (image).
 *
 * The huge-array-index test runs the server in a child process: if the server's event loop
 * stalls, the test process can still give up and kill it.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { createApp } from '../src/app.js';
import { FUNCTIONAL_WRITE_LIMITS } from './support/app.js';
import { ensureSchema, pool } from '../src/db.js';
import { cleanup, createUser } from './support/fixtures.js';

const MSG_TOO_LARGE = 'Die Anfrage ist zu groß.';
const MSG_UNREADABLE = 'Die Anfrage konnte nicht gelesen werden.';
const MSG_IMAGE = 'Das Bild darf hoechstens 5 MB gross sein.';
const MSG_BANNER = 'Das Banner-Bild darf hoechstens 5 MB gross sein.';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==',
  'base64',
);
/** One byte over the 5 MB limit. */
const OVERSIZED = Buffer.alloc(5 * 1024 * 1024 + 1, 0x61);

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
  creator = await createUser('uploadcreator', { accountType: 'creator' });
  admin = await createUser('uploadadmin', { isAdmin: true });
  target = await createUser('uploadtarget');
});

after(async () => {
  try {
    await cleanup();
  } finally {
    await pool.end();
    server?.close();
  }
});

const sendForm = (url, token, form, init = {}) =>
  fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form, ...init });

/** The fields of a valid event form (no banner). */
function eventForm() {
  const form = new FormData();
  form.append('title', 'Kickerabend');
  form.append('description', 'Wir spielen Kicker.');
  form.append('location', 'Teststrasse 1, 50667 Koeln');
  form.append('starts_at', new Date(Date.now() + 86_400_000).toISOString());
  return form;
}

const png = () => new Blob([PNG_1X1], { type: 'image/png' });

/** Every upload route with the token allowed to use it, its file field and a form-maker. */
function uploadRoutes() {
  return [
    { path: '/api/activities', token: creator.token, field: 'banner', form: eventForm, sizeMessage: MSG_BANNER },
    { path: `/api/admin/users/${target.user.id}/ban`, token: admin.token, field: 'evidence', form: () => reasonForm(), sizeMessage: MSG_IMAGE },
    { path: `/api/admin/users/${target.user.id}/timeout`, token: admin.token, field: 'evidence', form: () => reasonForm({ minutes: '5' }), sizeMessage: MSG_IMAGE },
    { path: '/api/me/avatar', token: creator.token, field: 'image', form: () => new FormData(), sizeMessage: MSG_IMAGE },
    { path: '/api/me/banner', token: creator.token, field: 'image', form: () => new FormData(), sizeMessage: MSG_IMAGE },
    { path: '/api/posts', token: creator.token, field: 'image', form: () => textForm('body', 'Hallo'), sizeMessage: MSG_IMAGE },
    { path: '/api/stories', token: creator.token, field: 'image', form: () => textForm('caption', 'Hallo'), sizeMessage: MSG_IMAGE },
  ];
}

function reasonForm(extra = {}) {
  const form = new FormData();
  form.append('reason', 'Test-Grund');
  for (const [key, value] of Object.entries(extra)) form.append(key, value);
  return form;
}

function textForm(name, value) {
  const form = new FormData();
  form.append(name, value);
  return form;
}

test('an image over 5 MB keeps each route its own 422 message at its own field', async () => {
  const routes = uploadRoutes();
  assert.equal(routes.length, 7);
  for (const route of routes) {
    const form = route.form();
    form.append(route.field, new Blob([OVERSIZED], { type: 'image/png' }), 'gross.png');
    const res = await sendForm(`${base}${route.path}`, route.token, form);
    assert.equal(res.status, 422, route.path);
    const body = await res.json();
    assert.equal(body.message, route.sizeMessage, route.path);
    assert.deepEqual(body.errors, { [route.field]: [route.sizeMessage] }, route.path);
  }
});

test('a second file is answered with 413 on every upload route', async () => {
  for (const route of uploadRoutes()) {
    const form = route.form();
    form.append(route.field, png(), 'eins.png');
    form.append(route.field, png(), 'zwei.png');
    const res = await sendForm(`${base}${route.path}`, route.token, form);
    assert.equal(res.status, 413, route.path);
    assert.equal((await res.json()).message, MSG_TOO_LARGE, route.path);
  }
});

test('a file in a field the route does not read is answered with 400 on every upload route', async () => {
  for (const route of uploadRoutes()) {
    const form = route.form();
    form.append('anderes_feld', png(), 'bild.png');
    const res = await sendForm(`${base}${route.path}`, route.token, form);
    assert.equal(res.status, 400, route.path);
    assert.equal((await res.json()).message, MSG_UNREADABLE, route.path);
  }
});

test('more text fields than a route reads are answered with 413', async () => {
  const cases = [
    ['/api/activities', creator.token, eventForm, 21],
    ['/api/me/avatar', creator.token, () => new FormData(), 4],
    ['/api/posts', creator.token, () => new FormData(), 4],
    ['/api/stories', creator.token, () => new FormData(), 4],
    [`/api/admin/users/${target.user.id}/ban`, admin.token, () => new FormData(), 5],
  ];
  for (const [route, token, makeForm, total] of cases) {
    const form = makeForm();
    let i = 0;
    while ([...form.keys()].length < total) form.append(`extra${(i += 1)}`, 'x');
    const res = await sendForm(`${base}${route}`, token, form);
    assert.equal(res.status, 413, route);
    assert.equal((await res.json()).message, MSG_TOO_LARGE, route);
  }
});

test('a text field over 16 KB is answered with 413', async () => {
  const form = eventForm();
  form.set('description', 'x'.repeat(16 * 1024 + 1));
  const res = await sendForm(`${base}/api/activities`, creator.token, form);
  assert.equal(res.status, 413);
  assert.equal((await res.json()).message, MSG_TOO_LARGE);
});

test('a field name over 64 bytes is answered with 413', async () => {
  const form = eventForm();
  form.append('n'.repeat(65), 'x');
  const res = await sendForm(`${base}/api/activities`, creator.token, form);
  assert.equal(res.status, 413);
  assert.equal((await res.json()).message, MSG_TOO_LARGE);
});

test('a field name nested deeper than name[] is answered with 400', async () => {
  const form = eventForm();
  form.append('interests[a][b]', '1');
  const res = await sendForm(`${base}/api/activities`, creator.token, form);
  assert.equal(res.status, 400);
  assert.equal((await res.json()).message, MSG_UNREADABLE);
});

test('a multipart body without a boundary or cut off is answered with 400, not 500', async () => {
  const noBoundary = await fetch(`${base}/api/posts`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${creator.token}`, 'Content-Type': 'multipart/form-data' },
    body: 'irgendwas',
  });
  assert.equal(noBoundary.status, 400);
  assert.equal((await noBoundary.json()).message, MSG_UNREADABLE);

  const boundary = 'fixture-boundary-1234';
  const truncated = `--${boundary}\r\nContent-Disposition: form-data; name="body"\r\n\r\nHallo`;
  const cut = await fetch(`${base}/api/posts`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${creator.token}`, 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body: truncated,
  });
  assert.equal(cut.status, 400);
  assert.equal((await cut.json()).message, MSG_UNREADABLE);
});

test('the form the app sends still works: 5 + 5 interests and a banner', async () => {
  const [rows] = await pool.query('SELECT id FROM interests ORDER BY id LIMIT 5');
  const form = eventForm();
  for (const row of rows) form.append('interests[]', String(row.id));
  for (const name of ['Kicker', 'Billard', 'Darts', 'Karten', 'Schach']) form.append('custom_interests[]', name);
  form.append('max_participants', '8');
  form.append('banner', png(), 'banner.png');
  const res = await sendForm(`${base}/api/activities`, creator.token, form);
  assert.equal(res.status, 201, JSON.stringify(await res.clone().json()));
  const { data } = await res.json();
  assert.equal(data.interests.length, rows.length);
  assert.match(String(data.banner_url), /\/storage\/banners\/[0-9a-f]+\.png$/);
  // The stored banner file stays with the event's history; remove the test's copy.
  const file = path.join(process.cwd(), 'storage', String(data.banner_url).slice(String(data.banner_url).indexOf('/storage/') + 9));
  fs.rmSync(file, { force: true });
});

test('more than 5 interests or typed interests are refused before any loop runs over them', async () => {
  for (const name of ['interests[]', 'custom_interests[]']) {
    const form = eventForm();
    for (let i = 1; i <= 6; i += 1) form.append(name, name === 'interests[]' ? String(i) : `Eigenes ${i}`);
    const res = await sendForm(`${base}/api/activities`, creator.token, form);
    assert.equal(res.status, 422, name);
    assert.deepEqual((await res.json()).errors.interests, ['Du kannst hoechstens 5 Interessen auswaehlen.'], name);
  }
});

/** Starts the server in a child process; resolves with its address and a kill function. */
function startChildServer() {
  const appUrl = new URL('../src/app.js', import.meta.url).href;
  const code = `const { createApp } = await import(process.argv[1]);
const server = createApp({ writeLimits: JSON.parse(process.argv[2]) })
  .listen(0, '127.0.0.1', () => process.stdout.write('PORT ' + server.address().port + '\\n'));`;
  const args = ['--input-type=module', '-e', code, appUrl, JSON.stringify(FUNCTIONAL_WRITE_LIMITS)];
  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve, reject) => {
    let out = '';
    child.once('exit', (exitCode) => reject(new Error(`child server exited with ${exitCode}`)));
    child.stdout.on('data', (chunk) => {
      out += chunk;
      const m = /PORT (\d+)/.exec(out);
      if (m) resolve({ url: `http://127.0.0.1:${m[1]}`, kill: () => child.kill('SIGKILL') });
    });
  });
}

test('a multipart field with a huge array index is answered with 4xx in under 2 s', async () => {
  const child = await startChildServer();
  try {
    const form = eventForm();
    form.append('interests[4000000000]', '1');
    const started = Date.now();
    let res;
    try {
      res = await sendForm(`${child.url}/api/activities`, creator.token, form, { signal: AbortSignal.timeout(2000) });
    } catch (err) {
      assert.fail(`no answer within 2 s (${err?.name}): the server is still busy with the field`);
    }
    const ms = Date.now() - started;
    assert.ok(res.status >= 400 && res.status < 500, `answered ${res.status}`);
    assert.ok(ms < 2000, `took ${ms} ms`);
  } finally {
    child.kill();
  }
});
