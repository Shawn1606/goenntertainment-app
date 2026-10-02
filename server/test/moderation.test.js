/**
 * AI moderation (F-06) against a local stand-in for the model provider (test/support/model-mock.js).
 *
 * The other suites run with moderation switched off (test/test.env); this file switches it on
 * with a fake key and points the provider's address (ANTHROPIC_BASE_URL) at the stand-in on
 * 127.0.0.1. assertLoopbackBaseUrl() refuses any other address before anything is sent, and the
 * tests assert that their requests reached the stand-in, so nothing can leave the machine.
 *
 * Fail closed: when the model cannot be asked (an error, a timeout, no key), content is refused
 * unless MODERATION_FAIL_OPEN is exactly 'true'.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { FUNCTIONAL_WRITE_LIMITS } from './support/app.js';
import { hasMetadataTrace, JPEG_8X8, PNG_1X1, withJpegExif } from './support/images.js';
import { assertLoopbackBaseUrl, startModelMock, verdict } from './support/model-mock.js';

/** What test/test.env gave this process, before this file changes it. */
const INHERITED_MODERATION_ENABLED = process.env.MODERATION_ENABLED;

const MSG_UNAVAILABLE = 'Die Inhaltspruefung ist gerade nicht erreichbar. Bitte versuche es spaeter erneut.';
const MSG_REFUSAL = 'Der Inhalt konnte nicht geprueft werden und wurde vorsichtshalber abgelehnt.';

const mock = await startModelMock();

// The environment is set before the server's modules are loaded (a server that reads its settings
// at import sees them too). Values are set, never deleted: dotenv would fill a deleted variable
// from a developer's server/.env.
process.env.ANTHROPIC_API_KEY = 'test-only-fake-key-not-a-secret';
process.env.ANTHROPIC_BASE_URL = assertLoopbackBaseUrl(mock.url);
process.env.MODERATION_ENABLED = 'true';
process.env.MODERATION_FAIL_OPEN = '';
process.env.MODERATION_FALLBACKS = 'false';
process.env.MODERATION_TIMEOUT_MS = '1500';

const { createApp } = await import('../src/app.js');
const { ensureSchema, first, pool } = await import('../src/db.js');
const { cleanup, createUser } = await import('./support/fixtures.js');

let base;
let server;
let creator;
const userIds = [];

before(async () => {
  await ensureSchema();
  server = createApp({ writeLimits: FUNCTIONAL_WRITE_LIMITS }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  creator = await createUser('modcreator', { accountType: 'creator', created: userIds });
});

after(async () => {
  try {
    if (userIds.length > 0) await pool.query('DELETE FROM moderation_reports WHERE user_id IN (?)', [userIds]);
    await cleanup();
  } finally {
    await pool.end();
    server?.close();
    await mock.close();
  }
});

/** Runs `fn` with some environment values changed, and restores them afterwards. */
async function withEnv(values, fn) {
  const saved = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  try {
    return await fn();
  } finally {
    Object.assign(process.env, saved);
  }
}

/** A post as the app sends it (multipart, text only). */
function createPost(token, body) {
  const form = new FormData();
  form.append('body', body);
  return fetch(`${base}/api/posts`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
}

/** A post with an image (multipart, as the app sends it). */
function createImagePost(token, bytes, mime) {
  const form = new FormData();
  form.append('body', 'Mit Bild');
  form.append('image', new Blob([bytes], { type: mime }), 'bild');
  return fetch(`${base}/api/posts`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
}

/** The image block of the last request that reached the stand-in. */
function lastImageBlock() {
  const call = mock.messageCalls().at(-1);
  return call?.body?.messages?.[0]?.content?.find((block) => block.type === 'image') ?? null;
}

const postCount = async (userId) => Number((await first('SELECT COUNT(*) AS c FROM posts WHERE user_id = ?', [userId])).c);
const lastReport = (userId) =>
  first('SELECT verdict, action FROM moderation_reports WHERE user_id = ? ORDER BY id DESC LIMIT 1', [userId]);

/** Posts once and returns the status, the answer and how many calls reached the stand-in. */
async function postAndCount(token, body) {
  const callsBefore = mock.messageCalls().length;
  const res = await createPost(token, body);
  const json = await res.json();
  return { status: res.status, json, calls: mock.messageCalls().length - callsBefore };
}

test('the other suites run with moderation switched off (test/test.env)', () => {
  assert.equal(INHERITED_MODERATION_ENABLED, 'false');
});

test('the stand-in accepts only a loopback address', () => {
  for (const url of ['https://api.anthropic.com', 'http://10.0.0.1:8080', 'http://localhost:8080', 'http://127.0.0.1', 'http://127.0.0.1.example.invalid:80']) {
    assert.throws(() => assertLoopbackBaseUrl(url), /loopback/, url);
  }
  assert.equal(assertLoopbackBaseUrl('http://127.0.0.1:9'), 'http://127.0.0.1:9');
});

test('a harmless verdict lets the content through (positive control)', async () => {
  mock.respond({ verdict: verdict({ severity: 0 }) });
  const r = await postAndCount(creator.token, 'Wer kommt mit zum Bouldern?');
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.ok(r.calls >= 1, 'the check reached the local stand-in');
  assert.equal((await lastReport(creator.user.id)).verdict, 'ok');
});

test('a provider error refuses the content when MODERATION_FAIL_OPEN is not set', async () => {
  mock.respond({ status: 500 });
  const before = await postCount(creator.user.id);
  const r = await postAndCount(creator.token, 'Ein ganz normaler Beitrag');
  assert.ok(r.calls >= 1, 'the check reached the local stand-in');
  assert.equal(r.status, 422, JSON.stringify(r.json));
  assert.equal(r.json.message, MSG_UNAVAILABLE);
  assert.equal(await postCount(creator.user.id), before, 'nothing was stored');
  assert.deepEqual({ ...(await lastReport(creator.user.id)) }, { verdict: 'error', action: 'blocked' });
});

test('a provider timeout refuses the content when MODERATION_FAIL_OPEN is not set', async () => {
  mock.respond({ hang: true });
  const before = await postCount(creator.user.id);
  const r = await postAndCount(creator.token, 'Noch ein ganz normaler Beitrag');
  assert.ok(r.calls >= 1, 'the check reached the local stand-in');
  assert.equal(r.status, 422, JSON.stringify(r.json));
  assert.equal(r.json.message, MSG_UNAVAILABLE);
  assert.equal(await postCount(creator.user.id), before, 'nothing was stored');
});

test('MODERATION_FAIL_OPEN=true lets the content through when the provider fails', async () => {
  mock.respond({ status: 500 });
  await withEnv({ MODERATION_FAIL_OPEN: 'true' }, async () => {
    const r = await postAndCount(creator.token, 'Durchgelassen trotz Ausfall');
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.deepEqual({ ...(await lastReport(creator.user.id)) }, { verdict: 'error', action: 'none' });
  });
});

test('every other MODERATION_FAIL_OPEN value keeps moderation closed', async () => {
  mock.respond({ status: 500 });
  for (const value of ['false', '1', 'yes', 'TRUE', ' true']) {
    await withEnv({ MODERATION_FAIL_OPEN: value }, async () => {
      const r = await postAndCount(creator.token, `Wert ${JSON.stringify(value)}`);
      assert.equal(r.status, 422, `MODERATION_FAIL_OPEN=${JSON.stringify(value)}: ${JSON.stringify(r.json)}`);
      assert.equal(r.json.message, MSG_UNAVAILABLE);
    });
  }
});

test('without an API key content is refused, unless moderation is switched off on purpose', async () => {
  mock.respond({ verdict: verdict({ severity: 0 }) });
  await withEnv({ ANTHROPIC_API_KEY: '' }, async () => {
    const before = await postCount(creator.user.id);
    const refused = await postAndCount(creator.token, 'Ohne Schluessel');
    assert.equal(refused.status, 422, JSON.stringify(refused.json));
    assert.equal(refused.json.message, MSG_UNAVAILABLE);
    assert.equal(refused.calls, 0, 'nothing is sent without a key');
    assert.equal(await postCount(creator.user.id), before, 'nothing was stored');

    await withEnv({ MODERATION_ENABLED: 'false' }, async () => {
      const off = await postAndCount(creator.token, 'Pruefung bewusst aus');
      assert.equal(off.status, 201, JSON.stringify(off.json));
      assert.equal(off.calls, 0);
    });
  });
});

test('the image sent to the model is the re-encoded one, typed by its bytes (F-11)', async () => {
  mock.respond({ verdict: verdict({ severity: 0 }) });
  const withExif = withJpegExif(JPEG_8X8);
  assert.ok(hasMetadataTrace(withExif), 'precondition: the upload carries EXIF and GPS data');

  const jpeg = await createImagePost(creator.token, withExif, 'image/jpeg');
  assert.equal(jpeg.status, 201, JSON.stringify(await jpeg.json()));
  const jpegBlock = lastImageBlock();
  assert.ok(jpegBlock, 'the image reached the local stand-in');
  assert.equal(jpegBlock.source.media_type, 'image/jpeg');
  assert.equal(hasMetadataTrace(Buffer.from(jpegBlock.source.data, 'base64')), false, 'no metadata goes to the model');

  // PNG bytes declared as a JPEG: the model is told what the bytes are.
  const png = await createImagePost(creator.token, PNG_1X1, 'image/jpeg');
  assert.equal(png.status, 201, JSON.stringify(await png.json()));
  assert.equal(lastImageBlock().source.media_type, 'image/png');
});

test('a refusal by the provider still refuses the content', async () => {
  mock.respond({ refusal: true });
  const r = await postAndCount(creator.token, 'Wird nicht geprueft');
  assert.ok(r.calls >= 1, 'the check reached the local stand-in');
  assert.equal(r.status, 422, JSON.stringify(r.json));
  assert.equal(r.json.message, MSG_REFUSAL);
});
