import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createSessionWatch, endsSession, signOutLocally } from './session.ts';
// Newer functions through the namespace: this file still loads where they are missing, and their
// tests then fail on an assertion.
import * as session from './session.ts';

const CURRENT = 'fixture-token-current-not-a-secret';
const OLDER = 'fixture-token-older-not-a-secret';

test('a 401 to a request with the current token ends the session', () => {
  assert.equal(endsSession(401, CURRENT, CURRENT), true);
});

test('a 401 to an older token (a request from before a new sign-in) does not', () => {
  assert.equal(endsSession(401, OLDER, CURRENT), false);
});

test('a 401 without a token (sign-in, sign-up) never ends a session', () => {
  for (const token of [null, undefined, '']) {
    assert.equal(endsSession(401, token, CURRENT), false, String(token));
  }
  assert.equal(endsSession(401, CURRENT, null), false, 'nobody is signed in');
});

test('other statuses never end a session', () => {
  for (const status of [0, 200, 400, 403, 404, 409, 422, 429, 500, 503]) {
    assert.equal(endsSession(status, CURRENT, CURRENT), false, String(status));
  }
});

test('the watch forwards only 401s to requests that carried a token', () => {
  const watch = createSessionWatch();
  const seen: string[] = [];
  watch.subscribe((token) => seen.push(token));

  watch.report(200, CURRENT);
  watch.report(403, CURRENT);
  watch.report(401, null);
  watch.report(401, '');
  watch.report(401, CURRENT);
  watch.report(401, OLDER);

  assert.deepEqual(seen, [CURRENT, OLDER]);
});

test('unsubscribing stops the reports, and other listeners keep theirs', () => {
  const watch = createSessionWatch();
  const first: string[] = [];
  const second: string[] = [];
  const stopFirst = watch.subscribe((token) => first.push(token));
  watch.subscribe((token) => second.push(token));

  watch.report(401, CURRENT);
  stopFirst();
  watch.report(401, OLDER);

  assert.deepEqual(first, [CURRENT]);
  assert.deepEqual(second, [CURRENT, OLDER]);
});

test('a listener that unsubscribes while being called does not skip the others', () => {
  const watch = createSessionWatch();
  const calls: string[] = [];
  const stop = watch.subscribe(() => {
    calls.push('first');
    stop();
  });
  watch.subscribe(() => calls.push('second'));

  watch.report(401, CURRENT);
  watch.report(401, CURRENT);

  assert.deepEqual(calls, ['first', 'second', 'second']);
});

/**
 * Sign-out steps that record their order; `storage` makes removing the stored token fail,
 * `device` removing the offline copy of bookings and pass (F-44).
 */
function signOutSteps(storage: 'works' | 'fails' = 'works', device: 'works' | 'fails' = 'works') {
  const calls: string[] = [];
  const steps = {
    forget: () => {
      calls.push('forget');
    },
    clearStorage: async () => {
      calls.push('clearStorage');
      if (storage === 'fails') throw new Error('storage unavailable');
    },
    clearDeviceData: async () => {
      calls.push('clearDeviceData');
      if (device === 'fails') throw new Error('device storage unavailable');
    },
    notice: async () => {
      calls.push('notice');
    },
  };
  return { steps, calls };
}

test('signing out forgets the session in memory before the storage is touched', async () => {
  const deliberate = signOutSteps();
  await signOutLocally(deliberate.steps, false);
  assert.deepEqual(deliberate.calls, ['forget', 'clearStorage', 'clearDeviceData'], 'a deliberate sign-out shows no notice');

  const rejected = signOutSteps();
  await signOutLocally(rejected.steps, true);
  assert.deepEqual(rejected.calls, ['forget', 'clearStorage', 'clearDeviceData', 'notice']);
});

test('after a 401 a storage error still signs out and tells the person why', async () => {
  const { steps, calls } = signOutSteps('fails');
  await assert.doesNotReject(signOutLocally(steps, true));
  assert.deepEqual(calls, ['forget', 'clearStorage', 'clearDeviceData', 'notice'], 'the session must be forgotten even when the storage fails');
});

test('a deliberate sign-out passes a storage error on, after forgetting the session', async () => {
  const { steps, calls } = signOutSteps('fails');
  await assert.rejects(signOutLocally(steps, false), /storage unavailable/);
  assert.deepEqual(calls, ['forget', 'clearStorage', 'clearDeviceData'], 'the session must be forgotten even when the storage fails');
});

test('every sign-out removes the offline copy, also when removing the token failed (F-44)', async () => {
  for (const [storage, rejected] of [
    ['works', false],
    ['works', true],
    ['fails', false],
    ['fails', true],
  ] as const) {
    const { steps, calls } = signOutSteps(storage);
    await signOutLocally(steps, rejected).catch(() => {});
    assert.ok(calls.includes('clearDeviceData'), `no removal of the offline copy (token storage ${storage}, ${rejected ? '401' : 'deliberate'})`);
    assert.ok(calls.indexOf('forget') < calls.indexOf('clearDeviceData'), 'the session must be forgotten first');
  }
});

test('a failing removal of the offline copy never fails or stops a sign-out (F-44)', async () => {
  const deliberate = signOutSteps('works', 'fails');
  await assert.doesNotReject(signOutLocally(deliberate.steps, false));
  assert.deepEqual(deliberate.calls, ['forget', 'clearStorage', 'clearDeviceData']);

  const rejected = signOutSteps('works', 'fails');
  await assert.doesNotReject(signOutLocally(rejected.steps, true));
  assert.deepEqual(rejected.calls, ['forget', 'clearStorage', 'clearDeviceData', 'notice'], 'the person must still be told why');

  // A token storage error is still passed on, not hidden by the device step.
  const both = signOutSteps('fails', 'fails');
  await assert.rejects(signOutLocally(both.steps, false), (err) => err instanceof Error && err.message === 'storage unavailable');
});

/*
 * The account id stored beside the token (F-44): when the stored session is rejected at app start
 * (the account was deleted, or the token revoked, while the app was closed), it says whose search
 * history to remove - also on phones, whose storage cannot list its keys.
 */

test('the account id stored beside the token reads back only as a valid account id (F-44)', () => {
  assert.equal(typeof session.parseSessionUserId, 'function', 'no way to read back the stored account id');
  assert.equal(session.parseSessionUserId('7'), 7);
  assert.equal(session.parseSessionUserId('123456'), 123456);
  for (const raw of [null, undefined, '', '0', '-3', '7.5', '07', '7a', ' 7', 'abc', '9007199254740993']) {
    assert.equal(session.parseSessionUserId(raw), null, `${JSON.stringify(raw)} is no account id`);
  }
});

test('the stored account id is written as it is read back (F-44)', () => {
  assert.equal(typeof session.serializeSessionUserId, 'function', 'no way to store the account id');
  assert.equal(session.serializeSessionUserId(7), '7');
  assert.equal(session.parseSessionUserId(session.serializeSessionUserId(42)), 42);
  for (const id of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2]) {
    assert.equal(session.serializeSessionUserId(id), null, `${id} is no account id and is not stored`);
  }
});
