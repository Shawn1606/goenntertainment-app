/**
 * notifyOnce (src/notifications.js) under concurrency, against the real database (F-07).
 *
 * test/notification-dedup.test.js covers the routes one request at a time. Here the function is
 * called many times at the same moment:
 *   - with the SAME key (recipient, actor, type, target): exactly one row, never two - a
 *     check-then-insert without the named lock lets two calls both find "none yet";
 *   - from DIFFERENT people to the same recipient: every one of them arrives - a single
 *     INSERT ... SELECT ... WHERE NOT EXISTS deadlocks there once the recipient's index range is
 *     the one it reads, and loses a notification each time.
 * The second case needs "popular" actors (many earlier rows each, here fan-out rows to other
 * accounts), so MySQL reads the recipient's index rather than the actor's - the production shape
 * in which the deadlock showed up.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { ensureSchema, pool } from '../src/db.js';
import { notifyOnce } from '../src/notifications.js';
import { deleteTestUsers, insertTestUser } from './support/fixtures.js';

/** Rounds of simultaneous calls, and calls (or actors) per round. */
const ROUNDS = 15;
const PARALLEL = 10;

/** Earlier fan-out rows per actor in the second test: accounts x items (see the head of the file). */
const FANOUT_ACCOUNTS = 5;
const FANOUT_ITEMS = 20;

const createdUserIds = [];

/** Keeps an account id for cleanup and returns it. */
function track(id) {
  createdUserIds.push(id);
  return id;
}

async function countRows(recipientId, where = '', params = []) {
  const [[row]] = await pool.query(`SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? ${where}`, [
    recipientId,
    ...params,
  ]);
  return Number(row.c);
}

before(async () => {
  await ensureSchema();
});

after(async () => {
  try {
    await deleteTestUsers(pool, createdUserIds);
  } finally {
    await pool.end();
  }
});

test(`the same key sent ${PARALLEL} times at once leaves exactly one row (${ROUNDS} rounds)`, async () => {
  const recipient = track(await insertTestUser(pool, 'nobody'));
  const actor = track(await insertTestUser(pool, 'nofan'));

  const counts = [];
  for (let round = 1; round <= ROUNDS; round += 1) {
    await Promise.all(
      Array.from({ length: PARALLEL }, () =>
        notifyOnce({ userId: recipient, actorId: actor, type: 'like', refId: round, title: 'Test' }),
      ),
    );
    counts.push(await countRows(recipient, 'AND ref_id = ?', [round]));
  }
  assert.deepEqual(counts, Array(ROUNDS).fill(1), `rows per round: ${counts.join(',')}`);
});

test(`${PARALLEL} different people notifying one person at once all arrive (${ROUNDS} rounds)`, async () => {
  const recipient = track(await insertTestUser(pool, 'nobody'));
  const actors = [];
  for (let i = 0; i < PARALLEL; i += 1) actors.push(track(await insertTestUser(pool, 'nofan')));

  // Popular actors: earlier fan-out rows to other accounts (see the head of the file).
  const others = [];
  for (let i = 0; i < FANOUT_ACCOUNTS; i += 1) others.push(track(await insertTestUser(pool, 'noother')));
  for (const actor of actors) {
    const rows = [];
    for (let k = 0; k < FANOUT_ITEMS; k += 1) for (const other of others) rows.push([other, actor, 'post', k, 'Test']);
    await pool.query('INSERT INTO notifications (user_id, actor_id, type, ref_id, title) VALUES ?', [rows]);
  }
  await pool.query('ANALYZE TABLE notifications');

  try {
    for (let round = 1; round <= ROUNDS; round += 1) {
      await Promise.all(
        actors.map((actor) => notifyOnce({ userId: recipient, actorId: actor, type: 'like', refId: round, title: 'Test' })),
      );
    }
    assert.equal(await countRows(recipient), ROUNDS * PARALLEL, 'a notification went missing');
  } finally {
    // The setup rows go now, in one statement on this table only, not in the account cleanup's
    // cascade, which other test files' writes run alongside.
    await pool.query('DELETE FROM notifications WHERE user_id IN (?)', [others]);
  }
});

test('notifyOnce never notifies the actor themself and writes nothing without a recipient', async () => {
  const self = track(await insertTestUser(pool, 'nobody'));
  await notifyOnce({ userId: self, actorId: self, type: 'follow', refId: self, title: 'Test' });
  await notifyOnce({ userId: null, actorId: self, type: 'follow', refId: self, title: 'Test' });
  assert.equal(await countRows(self), 0);
});
