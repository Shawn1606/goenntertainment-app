import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createSessionWatch, endsSession, signOutLocally } from './session.ts';

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

/** Sign-out steps that record their order; `storage` makes removing the stored token fail. */
function signOutSteps(storage: 'works' | 'fails' = 'works') {
  const calls: string[] = [];
  const steps = {
    forget: () => {
      calls.push('forget');
    },
    clearStorage: async () => {
      calls.push('clearStorage');
      if (storage === 'fails') throw new Error('storage unavailable');
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
  assert.deepEqual(deliberate.calls, ['forget', 'clearStorage'], 'a deliberate sign-out shows no notice');

  const rejected = signOutSteps();
  await signOutLocally(rejected.steps, true);
  assert.deepEqual(rejected.calls, ['forget', 'clearStorage', 'notice']);
});

test('after a 401 a storage error still signs out and tells the person why', async () => {
  const { steps, calls } = signOutSteps('fails');
  await assert.doesNotReject(signOutLocally(steps, true));
  assert.deepEqual(calls, ['forget', 'clearStorage', 'notice'], 'the session must be forgotten even when the storage fails');
});

test('a deliberate sign-out passes a storage error on, after forgetting the session', async () => {
  const { steps, calls } = signOutSteps('fails');
  await assert.rejects(signOutLocally(steps, false), /storage unavailable/);
  assert.deepEqual(calls, ['forget', 'clearStorage'], 'the session must be forgotten even when the storage fails');
});
