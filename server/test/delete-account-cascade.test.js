/**
 * deleteUserAccount() against the real database (MySQL 8.4 with server/schema.sql): a host whose
 * own event still has rows that point at both the event and the host.
 *
 * Hosts always have such rows: creating an event writes the host's history entry and awards the
 * host points for it (routes/activities.js, rewards.js). On MySQL 8.4 a single DELETE of the user
 * row then failed with ER_NO_REFERENCED_ROW_2, so DELETE /api/me and the admin delete answered 500.
 *
 * The function is called directly (no route), so these tests also hold when the routes move.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { ensureSchema, first, pool } from '../src/db.js';
import { deleteUserAccount } from '../src/account-deletion.js';
import { deleteTestUsers, insertTestUser } from './support/fixtures.js';

const createdUserIds = [];

async function user(prefix) {
  const id = await insertTestUser(pool, prefix, { accountType: 'creator' });
  createdUserIds.push(id);
  return id;
}

async function insertEvent(hostId, banner = null) {
  const [result] = await pool.query(
    `INSERT INTO activities (user_id, title, description, location, starts_at, banner_path, created_at, updated_at)
     VALUES (?, 'Cascade test', 'Test event', 'Teststrasse 1', NOW() + INTERVAL 1 DAY, ?, NOW(), NOW())`,
    [hostId, banner],
  );
  return result.insertId;
}

const insertHistory = (userId, activityId, role, banner = null) =>
  pool.query(
    `INSERT INTO activity_history (user_id, activity_id, role, title, location, starts_at, banner_path, created_at, updated_at)
     VALUES (?, ?, ?, 'Cascade test', 'Teststrasse 1', NOW() + INTERVAL 1 DAY, ?, NOW(), NOW())`,
    [userId, activityId, role, banner],
  );

const insertPoints = (userId, activityId) =>
  pool.query(
    `INSERT INTO reward_points (user_id, points, reason, activity_id, created_at) VALUES (?, 10, 'activity', ?, NOW())`,
    [userId, activityId],
  );

/** 'deleted' on success, otherwise the driver's error code - so a failure names its cause. */
const deleteOutcome = (userId) => deleteUserAccount(userId).catch((err) => err.code ?? err.message);

const count = async (sql, params) => Number((await first(sql, params)).c);

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

test('deleteUserAccount deletes a host whose own event is in their history', async () => {
  const host = await user('fkhosthist');
  const event = await insertEvent(host);
  await insertHistory(host, event, 'host');

  assert.equal(await deleteOutcome(host), 'deleted');
  assert.equal(await first('SELECT id FROM users WHERE id = ?', [host]), null);
  assert.equal(await first('SELECT id FROM activities WHERE id = ?', [event]), null);
  assert.equal(await count('SELECT COUNT(*) AS c FROM activity_history WHERE user_id = ?', [host]), 0);
});

test('deleteUserAccount deletes a host who earned points for their own event', async () => {
  const host = await user('fkhostpoints');
  const event = await insertEvent(host);
  await insertPoints(host, event);

  assert.equal(await deleteOutcome(host), 'deleted');
  assert.equal(await first('SELECT id FROM users WHERE id = ?', [host]), null);
  assert.equal(await count('SELECT COUNT(*) AS c FROM reward_points WHERE user_id = ?', [host]), 0);
});

test("deleteUserAccount keeps a guest's history entry, detached and marked removed", async () => {
  const host = await user('fkhostguests');
  const guest = await user('fkguest');
  const banner = `banners/fk-cascade-${host}.png`; // no file behind it; removal is best effort
  const event = await insertEvent(host, banner);
  await insertHistory(host, event, 'host', banner);
  await insertPoints(host, event);
  await insertHistory(guest, event, 'participant', banner);

  assert.equal(await deleteOutcome(host), 'deleted');

  const kept = await first('SELECT activity_id, removed_at, banner_path FROM activity_history WHERE user_id = ?', [guest]);
  assert.ok(kept, 'the guest keeps the history entry');
  assert.equal(kept.activity_id, null);
  assert.notEqual(kept.removed_at, null);
  assert.equal(kept.banner_path, null);
  assert.ok(await first('SELECT id FROM users WHERE id = ?', [guest]), 'the guest account stays');
});
