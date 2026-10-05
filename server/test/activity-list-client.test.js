/**
 * The app's event list against the real route (F-12).
 *
 * The app loads the list with src/domain/activity-pages.ts: activityListPath builds each request
 * and collectPages asks for one page after the other until no `next_cursor` comes back. This test
 * runs exactly those two functions against the real route over HTTP, with more events than one page
 * holds. The pieces that the unit tests of the app only stub are checked together here: the page
 * size and the cursor of the server against what the app asks for and sends back, that the second
 * page is really requested (with the cursor of the first answer), and that no event is missing or
 * repeated. A client that kept only the first page would show a part of the list without an error.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { ACTIVITY_PAGE_SIZE, activityListPath, collectPages } from '../../src/domain/activity-pages.ts';
import { PAGE_SIZE_MAX } from '../src/activity-pages.js';
import { createApp } from '../src/app.js';
import { ensureSchema, pool } from '../src/db.js';
import { FUNCTIONAL_WRITE_LIMITS } from './support/app.js';
import { cleanup, createUser } from './support/fixtures.js';

let base;
let server;

before(async () => {
  await ensureSchema();
  server = createApp({ writeLimits: FUNCTIONAL_WRITE_LIMITS }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  try {
    await cleanup();
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  }
});

/** `count` upcoming events of `hostId`, one minute apart, written straight to the database. */
async function upcomingEvents(hostId, count) {
  const ids = [];
  for (let from = 0; from < count; from += 100) {
    const rows = [];
    const values = [];
    for (let i = from; i < Math.min(count, from + 100); i += 1) {
      rows.push("(?, ?, 'Testbeschreibung', 'Teststrasse 1', UTC_TIMESTAMP() + INTERVAL ? MINUTE, 0, NOW(), NOW())");
      values.push(hostId, `Seite ${i}`, 24 * 60 + i);
    }
    const [result] = await pool.query(
      `INSERT INTO activities (user_id, title, description, location, starts_at, is_permanent, created_at, updated_at)
       VALUES ${rows.join(', ')}`,
      values,
    );
    for (let i = 0; i < rows.length; i += 1) ids.push(result.insertId + i);
  }
  return ids;
}

test("the app's page size is the largest page the route serves", () => {
  assert.equal(ACTIVITY_PAGE_SIZE, PAGE_SIZE_MAX);
});

test('the app asks for every page: more events than one page holds all arrive, once each', async () => {
  const host = await createUser('pgcliHost');
  const viewer = await createUser('pgcliView');
  const wanted = await upcomingEvents(host.user.id, ACTIVITY_PAGE_SIZE * 2 + 7);

  const requests = [];
  const answers = [];
  const items = await collectPages(async (cursor) => {
    const path = activityListPath({}, cursor);
    requests.push(path);
    const res = await fetch(`${base}/api${path}`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${viewer.token}` },
    });
    assert.equal(res.status, 200, `GET /api${path}`);
    const body = await res.json();
    answers.push(body);
    return body;
  });

  // The second page is really requested, with the cursor of the first answer, and so on.
  assert.ok(requests.length >= 3, `only ${requests.length} request(s) for ${wanted.length} events`);
  assert.ok(answers[0].next_cursor, 'the first page named no next page');
  assert.equal(requests[0], `/activities?limit=${ACTIVITY_PAGE_SIZE}`);
  assert.equal(requests[1], activityListPath({}, answers[0].next_cursor));
  assert.equal(answers[0].data.length, ACTIVITY_PAGE_SIZE, 'the first page is not full');
  assert.equal(answers.at(-1).next_cursor ?? null, null, 'the last answer still names a next page');

  // Every event arrives, and none twice.
  const listed = items.map((a) => a.id);
  assert.equal(new Set(listed).size, listed.length, 'an event came on two pages');
  const missing = wanted.filter((id) => !listed.includes(id));
  assert.deepEqual(missing, [], `${missing.length} of ${wanted.length} events never arrived`);
  console.log(`${requests.length} requests, ${items.length} events listed, ${wanted.length} of them this test's`);
});
