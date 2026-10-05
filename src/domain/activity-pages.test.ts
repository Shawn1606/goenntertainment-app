import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ACTIVITY_PAGE_SIZE,
  activityListPath,
  collectPages,
  MAX_ACTIVITY_PAGES,
  mergeById,
  type ActivityPage,
} from './activity-pages.ts';

/** A server stand-in: answers the pages in order, keyed by the cursor that asks for them. */
function pagedServer(pages: ActivityPage<number>[], cursors: (string | null)[]) {
  const asked: (string | null)[] = [];
  const fetchPage = async (cursor: string | null) => {
    asked.push(cursor);
    const index = cursors.indexOf(cursor);
    assert.ok(index >= 0, `asked for a page nobody named: ${cursor}`);
    return pages[index];
  };
  return { asked, fetchPage };
}

test('a page asks for the largest page size, with the flags and the cursor as given', () => {
  assert.equal(activityListPath({}, null), `/activities?limit=${ACTIVITY_PAGE_SIZE}`);
  assert.equal(activityListPath({ mine: true }, null), '/activities?limit=100&mine=1');
  assert.equal(activityListPath({ past: true }, 'MjAyNi0xMC0wNSAxMjowMDowMHw3'), '/activities?limit=100&past=1&cursor=MjAyNi0xMC0wNSAxMjowMDowMHw3');
  // A cursor is passed back as it came, never cut or read: encoded where it would change the query.
  assert.equal(activityListPath({}, 'a+b/c=&d'), '/activities?limit=100&cursor=a%2Bb%2Fc%3D%26d');
  assert.equal(activityListPath({ past: false, mine: false }, ''), '/activities?limit=100');
});

test('collectPages follows next_cursor to the last page and keeps the order', async () => {
  const server = pagedServer(
    [
      { data: [1, 2], next_cursor: 'c1' },
      { data: [3, 4], next_cursor: 'c2' },
      { data: [5], next_cursor: null },
    ],
    [null, 'c1', 'c2'],
  );
  assert.deepEqual(await collectPages(server.fetchPage), [1, 2, 3, 4, 5]);
  assert.deepEqual(server.asked, [null, 'c1', 'c2']);
});

test('collectPages ends after one answer from a server without pages', async () => {
  const server = pagedServer([{ data: [1, 2, 3] }], [null]);
  assert.deepEqual(await collectPages(server.fetchPage), [1, 2, 3]);
  assert.deepEqual(server.asked, [null]);
});

test('an empty list is one request and no events', async () => {
  const server = pagedServer([{ data: [], next_cursor: null }], [null]);
  assert.deepEqual(await collectPages(server.fetchPage), []);
  assert.equal(server.asked.length, 1);
});

test('collectPages refuses a cursor that comes back, instead of looping or shortening the list', async () => {
  const server = pagedServer(
    [
      { data: [1], next_cursor: 'c1' },
      { data: [2], next_cursor: 'c1' },
    ],
    [null, 'c1'],
  );
  await assert.rejects(collectPages(server.fetchPage), /same page twice/);
  assert.deepEqual(server.asked, [null, 'c1']);
});

test('collectPages stops with an error after MAX_ACTIVITY_PAGES pages, never with a shortened list', async () => {
  let calls = 0;
  const endless = async () => {
    calls += 1;
    return { data: [calls], next_cursor: `c${calls}` };
  };
  await assert.rejects(collectPages(endless), /more than 1000 pages/);
  assert.equal(calls, MAX_ACTIVITY_PAGES);
});

test('a failed page fails the whole list (no first page standing in for all of it)', async () => {
  const fetchPage = async (cursor: string | null) => {
    if (cursor === 'c1') throw new Error('offline');
    return { data: [1], next_cursor: 'c1' };
  };
  await assert.rejects(collectPages(fetchPage), /offline/);
});

test('mergeById keeps each event once, the first copy, in order', () => {
  const a = { id: 1, from: 'upcoming' };
  const b = { id: 2, from: 'upcoming' };
  const bAgain = { id: 2, from: 'past' };
  const c = { id: 3, from: 'past' };
  assert.deepEqual(mergeById([a, b], [bAgain, c]), [a, b, c]);
  assert.deepEqual(mergeById([], [c]), [c]);
  assert.deepEqual(mergeById(), []);
});
