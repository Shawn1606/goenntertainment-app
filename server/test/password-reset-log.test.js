/**
 * POST /api/forgot-password must never write the reset token to the log: whoever can read the
 * server output could reset the password and take over the account. Against the real database
 * (the token's hash is read back to recognise the token in the captured output).
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from '../src/app.js';
import { ensureSchema, first, pool } from '../src/db.js';
import { checkPassword } from '../src/auth.js';
import { deleteTestUsers, insertTestUser } from './support/fixtures.js';

let base;
let server;
const createdUserIds = [];
const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug'];

/** Runs `fn` while every console method writes into `lines` instead of the terminal. */
async function capturingConsole(lines, fn) {
  const originals = Object.fromEntries(CONSOLE_METHODS.map((m) => [m, console[m]]));
  for (const m of CONSOLE_METHODS) console[m] = (...args) => lines.push(args.map(String).join(' '));
  try {
    return await fn();
  } finally {
    Object.assign(console, originals);
  }
}

before(async () => {
  await ensureSchema();
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  try {
    if (createdUserIds.length) {
      await pool.query(
        'DELETE FROM password_reset_tokens WHERE email IN (SELECT email FROM users WHERE id IN (?))',
        [createdUserIds],
      );
    }
    await deleteTestUsers(pool, createdUserIds);
  } finally {
    await pool.end();
    server?.close();
  }
});

test('POST /api/forgot-password never writes the reset token to the log', async () => {
  const userId = await insertTestUser(pool, 'resetlog');
  createdUserIds.push(userId);
  const { email } = await first('SELECT email FROM users WHERE id = ?', [userId]);

  const lines = [];
  const res = await capturingConsole(lines, () =>
    fetch(`${base}/api/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    }),
  );
  assert.equal(res.status, 200);

  // Denominator: a token was issued (its hash is in the table), so there was one to leak.
  const row = await first('SELECT token FROM password_reset_tokens WHERE email = ?', [email]);
  assert.ok(row, 'no reset token was issued');

  for (const line of lines) {
    for (const candidate of line.match(/[A-Za-z0-9_-]{32,}/g) ?? []) {
      assert.equal(await checkPassword(candidate, row.token), false, 'the reset token was written to the log');
    }
    assert.ok(!line.includes(email), 'the reset request was logged with the address');
  }
});
