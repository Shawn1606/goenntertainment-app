/**
 * GET /api/activities: upcoming events, the viewer's own history, bounded pages (F-12).
 *
 * The list used to answer every event ever created, past ones included, each with its participant
 * list, in one response. Now it answers the upcoming events by default (a dated event drops out
 * three hours after its start, the app's own rule; a permanent offer never does), the viewer's own
 * past events only on request (`past=1`), and one bounded page at a time with a cursor to the next
 * one (src/activity-pages.js). Who may see the participants is not decided here; the block rule
 * for them (F-13) is checked on the paged list too.
 *
 * Events are written straight to the database, relative to the database clock in UTC, so the
 * time window is tested to the minute. The test database is shared with other files: each test
 * walks every page (test/support/activity-list.js) and checks its own events, or reads a scope
 * that holds only its own accounts' events.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from '../src/app.js';
import { ensureSchema, first, pool } from '../src/db.js';
import { FUNCTIONAL_WRITE_LIMITS } from './support/app.js';
import { activityPages, listedActivities } from './support/activity-list.js';
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

/**
 * An event of `hostId`. `minutes`: its start relative to now (UTC, database clock); `at`: an exact
 * start instead ('YYYY-MM-DD HH:MM:SS', UTC); `permanent`: a permanent offer.
 */
async function event(hostId, title, { minutes = 24 * 60, at = null, permanent = false } = {}) {
  const startsAt = at === null ? 'UTC_TIMESTAMP() + INTERVAL ? MINUTE' : '?';
  const [result] = await pool.query(
    `INSERT INTO activities (user_id, title, description, location, starts_at, is_permanent, created_at, updated_at)
     VALUES (?, ?, 'Testbeschreibung', 'Teststrasse 1', ${startsAt}, ?, NOW(), NOW())`,
    [hostId, title, at === null ? minutes : at, permanent ? 1 : 0],
  );
  return result.insertId;
}

const join = (activityId, userId) =>
  pool.query('INSERT INTO activity_user (activity_id, user_id, created_at, updated_at) VALUES (?, ?, NOW(), NOW())', [
    activityId,
    userId,
  ]);

const get = async (path, token) => {
  const res = await fetch(`${base}${path}`, { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } });
  return { status: res.status, body: await res.json() };
};

const ids = (list) => list.map((a) => a.id);
const sorted = (list) => [...list].sort((a, b) => a - b);
/** The ids of `list` that are among `wanted`, in the order of `list`. */
const only = (list, wanted) => ids(list).filter((id) => wanted.includes(id));

test('the list holds upcoming events only: a dated event drops out three hours after its start', async () => {
  const host = await createUser('listhost');
  const viewer = await createUser('listview');
  const e = {
    pastDay: await event(host.user.id, 'Gestern', { minutes: -24 * 60 }),
    justOver: await event(host.user.id, 'Vor 3 Std 1 Min', { minutes: -181 }),
    stillOn: await event(host.user.id, 'Vor 2 Std 59 Min', { minutes: -179 }),
    tomorrow: await event(host.user.id, 'Morgen', { minutes: 24 * 60 }),
    // Its starts_at is only the time it was created (schema.sql): a month ago, and still on.
    permanent: await event(host.user.id, 'Freibad', { minutes: -30 * 24 * 60, permanent: true }),
  };
  const { cutoff } = await first("SELECT DATE_FORMAT(UTC_TIMESTAMP() - INTERVAL 3 HOUR, '%Y-%m-%dT%H:%i:%sZ') AS cutoff");

  const listed = await listedActivities(base, viewer.token);
  const seen = new Set(ids(listed));
  assert.ok(!seen.has(e.pastDay), 'an event of yesterday is listed');
  assert.ok(!seen.has(e.justOver), 'an event that started 3 hours and 1 minute ago is listed');
  assert.ok(seen.has(e.stillOn), 'an event that started 2 hours and 59 minutes ago is missing');
  assert.ok(seen.has(e.tomorrow), "tomorrow's event is missing");
  assert.ok(seen.has(e.permanent), 'the permanent offer is missing');

  // Denominator: the whole list, not only this test's events.
  assert.ok(listed.length >= 3, `only ${listed.length} events listed`);
  const over = listed.filter((a) => !a.is_permanent && Date.parse(a.starts_at) <= Date.parse(cutoff));
  assert.deepEqual(ids(over), [], `${listed.length} listed events checked; these are over`);
});

test("past=1 lists only the viewer's own past events, hosted or joined, latest first", async () => {
  const host = await createUser('listpasthost');
  const guest = await createUser('listpastguest');
  const stranger = await createUser('listpastother');
  const recent = await event(host.user.id, 'Vor 5 Std', { minutes: -5 * 60 });
  const older = await event(host.user.id, 'Vorgestern', { minutes: -2 * 24 * 60 });
  const upcoming = await event(host.user.id, 'Morgen', { minutes: 24 * 60 });
  const permanent = await event(host.user.id, 'Bowling', { minutes: -24 * 60, permanent: true });
  await join(recent, guest.user.id);
  const mine = [recent, older, upcoming, permanent];

  const forHost = await listedActivities(base, host.token, 'past=1');
  assert.deepEqual(only(forHost, mine), [recent, older], 'the host: both past events, latest first, nothing else');

  const forGuest = await listedActivities(base, guest.token, 'past=1');
  assert.deepEqual(only(forGuest, mine), [recent], 'the guest: the past event they joined');
  assert.ok(forGuest.every((a) => a.is_joined || a.host?.id === guest.user.id), "the guest gets someone else's event");

  assert.deepEqual(await listedActivities(base, stranger.token, 'past=1'), [], 'a stranger gets past events');

  // The history pages too, latest first.
  const pages = await activityPages(base, host.token, 'past=1&limit=1');
  assert.ok(pages.every((page) => page.data.length <= 1), 'a page is larger than asked for');
  assert.deepEqual(only(pages.flatMap((page) => page.data), mine), [recent, older]);
});

test('mine=1 lists only the upcoming events the viewer hosts or joined', async () => {
  const host = await createUser('listminehost');
  const guest = await createUser('listmineguest');
  const other = await createUser('listmineother');
  const hosted = await event(host.user.id, 'Eigenes Event', { minutes: 2 * 24 * 60 });
  const joined = await event(other.user.id, 'Dabei', { minutes: 3 * 24 * 60 });
  const foreign = await event(other.user.id, 'Fremd', { minutes: 3 * 24 * 60 });
  const over = await event(other.user.id, 'Vorbei', { minutes: -24 * 60 });
  await join(hosted, guest.user.id);
  await join(joined, host.user.id);
  await join(over, host.user.id);

  const forHost = await listedActivities(base, host.token, 'mine=1');
  assert.deepEqual(sorted(ids(forHost)), sorted([hosted, joined]), 'the host: the own and the joined upcoming event');
  const forGuest = await listedActivities(base, guest.token, 'mine=1');
  assert.deepEqual(ids(forGuest), [hosted], 'the guest: the joined event only');
  assert.ok(!ids(await listedActivities(base, other.token, 'mine=1')).includes(hosted), "the other host gets the host's event");
  assert.ok(ids(await listedActivities(base, other.token, 'mine=1')).includes(foreign), 'control: the other host');
});

test('a page holds 50 events without limit and never more than 100, whatever is asked for', async () => {
  const host = await createUser('listbulkhost');
  const viewer = await createUser('listbulkview');
  // 101 upcoming events of one host, in one statement: more than the largest page.
  const rows = Array.from({ length: 101 }, (_, i) => [host.user.id, `Reihe ${i}`, 'Testbeschreibung', 'Teststrasse 1', 2 * 24 * 60 + i]);
  await pool.query(
    `INSERT INTO activities (user_id, title, description, location, starts_at, created_at, updated_at)
     VALUES ${rows.map(() => '(?, ?, ?, ?, UTC_TIMESTAMP() + INTERVAL ? MINUTE, NOW(), NOW())').join(', ')}`,
    rows.flat(),
  );

  const cases = [
    ['limit=1000', 100],
    ['limit=101', 100],
    ['', 50],
    ['limit=3', 3],
    ['limit=abc', 50],
    ['limit=0', 1],
  ];
  for (const [query, size] of cases) {
    for (const scope of ['', 'mine=1&']) {
      const token = scope ? host.token : viewer.token;
      const res = await get(`/api/activities?${scope}${query}`, token);
      assert.equal(res.status, 200, `${scope}${query}`);
      assert.equal(res.body.data.length, size, `?${scope}${query}: ${res.body.data.length} events in one answer`);
      assert.equal(typeof res.body.next_cursor, 'string', `?${scope}${query}: no next page named`);
    }
  }

  // The host's own list ends: the last page names no next one.
  const pages = await activityPages(base, host.token, 'mine=1&limit=1000');
  assert.deepEqual(pages.map((page) => page.data.length), [100, 1]);
  assert.equal(pages.at(-1).next_cursor, null);
});

test('the next page starts right after the last one: no gap, no repeat, also when events change in between', async () => {
  const host = await createUser('listkeyshost');
  const viewer = await createUser('listkeysview');
  // Twelve events at three start times, four each: the order within one time is the id.
  const { t } = await first("SELECT DATE_FORMAT(UTC_TIMESTAMP() + INTERVAL 5 DAY, '%Y-%m-%d %H:%i:00') AS t");
  const at = (minutes) => new Date(Date.parse(`${t.replace(' ', 'T')}Z`) + minutes * 60000).toISOString().slice(0, 19).replace('T', ' ');
  const e = [];
  for (const minutes of [0, 1, 2]) {
    for (let i = 0; i < 4; i += 1) e.push(await event(host.user.id, `Takt ${minutes}.${i}`, { at: at(minutes) }));
  }

  // The whole default list in pages of 5: every page within its size, no event twice, this test's
  // events in their order.
  const pages = await activityPages(base, viewer.token, 'limit=5');
  assert.ok(pages.length >= 3, `only ${pages.length} pages`);
  assert.ok(pages.every((page) => page.data.length <= 5), 'a page is larger than asked for');
  const all = ids(pages.flatMap((page) => page.data));
  assert.equal(new Set(all).size, all.length, `${all.length} events listed, some twice`);
  assert.deepEqual(only(pages.flatMap((page) => page.data), e), e);

  // The host's own list. After the first page two served events and one not yet served are
  // deleted, and one earlier and one later event are added. The next pages go on exactly after the
  // last served event (a position, not an offset, which would now skip one).
  const first5 = await get('/api/activities?mine=1&limit=5', host.token);
  assert.deepEqual(ids(first5.body.data), e.slice(0, 5));
  await pool.query('DELETE FROM activities WHERE id IN (?, ?, ?)', [e[1], e[3], e[7]]);
  await event(host.user.id, 'Frueher', { at: at(-60) });
  const later = await event(host.user.id, 'Spaeter', { at: at(3) });
  const second = await get(`/api/activities?mine=1&limit=5&cursor=${encodeURIComponent(first5.body.next_cursor)}`, host.token);
  assert.deepEqual(ids(second.body.data), [e[5], e[6], e[8], e[9], e[10]]);
  const third = await get(`/api/activities?mine=1&limit=5&cursor=${encodeURIComponent(second.body.next_cursor)}`, host.token);
  assert.deepEqual(ids(third.body.data), [e[11], later]);
  assert.equal(third.body.next_cursor, null);
});

test('a cursor or flag the route did not make is refused, and the list does not start over', async () => {
  const viewer = await createUser('listbadview');
  const encode = (text) => Buffer.from(text, 'utf8').toString('base64url');
  const cases = [
    ['cursor=abc', 'cursor'],
    [`cursor=${encode('2026-13-01 00:00:00|5')}`, 'cursor'],
    [`cursor=${encode('2026-10-01 25:00:00|5')}`, 'cursor'],
    [`cursor=${encode('2026-10-01 00:00:00|0')}`, 'cursor'],
    [`cursor=${encode('2026-10-01 00:00:00|5 OR 1=1')}`, 'cursor'],
    [`cursor=${'A'.repeat(65)}`, 'cursor'],
    ['cursor=ab%2Bc', 'cursor'],
    ['cursor=a&cursor=b', 'cursor'],
    ['past=yes', 'past'],
    ['past=1&past=1', 'past'],
    ['mine=2', 'mine'],
  ];
  for (const [query, field] of cases) {
    const res = await get(`/api/activities?${query}`, viewer.token);
    assert.equal(res.status, 422, `?${query} answered ${res.status}`);
    assert.deepEqual(Object.keys(res.body.errors ?? {}), [field], `?${query}`);
    assert.equal(res.body.data, undefined, `?${query} listed events`);
  }
});

test('a block still hides the participant on every page and in the history (F-13)', async () => {
  const host = await createUser('listblkhost');
  const blocker = await createUser('listblka');
  const blocked = await createUser('listblkb');
  const upcoming = await event(host.user.id, 'Kommt noch', { minutes: 24 * 60 });
  const over = await event(host.user.id, 'War schon', { minutes: -24 * 60 });
  for (const id of [upcoming, over]) {
    for (const who of [host, blocker, blocked]) await join(id, who.user.id);
  }
  const res = await fetch(`${base}/api/blocks`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${blocker.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: blocked.user.id }),
  });
  assert.equal(res.status, 201);

  for (const [query, id] of [['', upcoming], ['past=1&limit=1', over]]) {
    const listed = (await listedActivities(base, blocked.token, query)).find((a) => a.id === id);
    assert.ok(listed, `?${query}: the event is missing`);
    assert.ok(!ids(listed.participants).includes(blocker.user.id), `?${query}: the blocker is listed`);
    assert.equal(listed.participants_count, 3, `?${query}: the count is capacity and stays true`);
    const control = (await listedActivities(base, host.token, query)).find((a) => a.id === id);
    assert.deepEqual(sorted(ids(control.participants)), sorted([host.user.id, blocker.user.id, blocked.user.id]), 'control: the host');
  }
});
