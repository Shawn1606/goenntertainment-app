import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createSessionWatch, endsSession } from './session.ts';

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
