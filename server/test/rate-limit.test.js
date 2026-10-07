/**
 * The write limiter's parts (src/rate-limit.js): rule parsing, settings, address buckets and the
 * counters, with an injected clock. No database, no server. The routes are tested in
 * test/write-limits.test.js.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_WRITE_LIMITS,
  RATE_LIMIT_MESSAGE,
  createLimitStore,
  ipKey,
  parseLimitSpec,
  rateLimit,
  resolveWriteLimits,
  writeLimitSettingProblems,
} from '../src/rate-limit.js';
import { startupProblems } from '../src/config.js';
import { FUNCTIONAL_WRITE_LIMITS } from './support/app.js';
import { startupEnv } from './support/startup-env.js';

/** The documented defaults (the PR table): a change to a number must change this pin too. */
const DOCUMENTED = {
  moderated: 'user:10/1h,user:30/1d,ip:60/1h,ip:300/1d',
  comment: 'user:20/10m,user:150/1d,ip:200/10m',
  chat: 'user:30/1m,user:1000/1d,ip:300/1m',
  reaction: 'user:60/10m,user:500/1d,ip:600/10m',
  relationship: 'user:30/10m,user:200/1d,ip:300/10m',
  block: 'user:30/10m,user:200/1d,ip:300/10m',
  report: 'user:10/10m,user:50/1d,ip:100/10m',
  state: 'user:120/1m,ip:1200/1m',
  content: 'user:60/10m,user:500/1d,ip:600/10m',
  account: 'user:5/10m,user:20/1d,ip:50/10m',
  admin: 'user:120/10m,ip:600/10m',
  webhook: 'ip:120/1m',
};

const H = 3_600_000;

test('the defaults are the documented table', () => {
  assert.deepEqual({ ...DEFAULT_WRITE_LIMITS }, DOCUMENTED);
  assert.ok(Object.isFrozen(DEFAULT_WRITE_LIMITS));
});

test('the 429 text is Laravel\'s, word for word', () => {
  assert.equal(RATE_LIMIT_MESSAGE, 'Zu viele Versuche – bitte warte kurz und probier es dann noch mal.');
});

test('the functional test limits are the defaults times 1000, windows unchanged', () => {
  const times1000 = (spec) => spec.replace(/:(\d+)\//g, (_, n) => `:${Number(n) * 1000}/`);
  assert.deepEqual(
    { ...FUNCTIONAL_WRITE_LIMITS },
    Object.fromEntries(Object.entries(DEFAULT_WRITE_LIMITS).map(([cls, spec]) => [cls, times1000(spec)])),
  );
});

test('every class has an address rule, and every class with an account an account rule', () => {
  const limits = resolveWriteLimits({}, {});
  for (const [cls, rules] of Object.entries(limits)) {
    assert.ok(rules.some((r) => r.scope === 'ip'), `${cls}: no ip rule`);
    if (cls === 'webhook') assert.ok(!rules.some((r) => r.scope === 'user'), 'webhook has no account');
    else assert.ok(rules.some((r) => r.scope === 'user'), `${cls}: no user rule`);
  }
  // Address rules allow at least five times the account rule of the same window.
  for (const [cls, rules] of Object.entries(limits)) {
    const user = rules.filter((r) => r.scope === 'user');
    for (const ip of rules.filter((r) => r.scope === 'ip')) {
      const same = user.find((u) => u.windowMs === ip.windowMs);
      if (same) assert.ok(ip.max >= 5 * same.max, `${cls}: ip ${ip.max} vs user ${same.max}`);
    }
  }
});

test('parseLimitSpec reads scope:max/window lists and refuses everything else', () => {
  assert.deepEqual(parseLimitSpec('user:10/1h, ip:60/30m'), [
    { scope: 'user', max: 10, windowMs: H },
    { scope: 'ip', max: 60, windowMs: 30 * 60_000 },
  ]);
  assert.deepEqual(parseLimitSpec('ip:1/1s'), [{ scope: 'ip', max: 1, windowMs: 1000 }]);
  for (const bad of ['', ' ', 'user:10', 'user:0/1h', 'user:-1/1h', 'user:10/0h', 'user:10/1w', 'admin:10/1h',
    'user:10/1h,', 'user:1.5/1h', 'user:10/31d', 'user:10/1h,user:20/60m', 'user:10/1h;ip:1/1h', 'user:01/1h']) {
    assert.throws(() => parseLimitSpec(bad), Error, JSON.stringify(bad));
  }
  assert.throws(() => parseLimitSpec(undefined));
});

test('resolveWriteLimits: createApp option before WRITE_LIMIT_* before the default', () => {
  const env = { WRITE_LIMIT_CHAT: 'user:5/1m,ip:50/1m', WRITE_LIMIT_STATE: '  ' };
  const limits = resolveWriteLimits(env, { comment: 'user:1/1h,ip:10/1h', chat: 'user:2/1m,ip:20/1m' });
  assert.deepEqual(limits.comment, parseLimitSpec('user:1/1h,ip:10/1h'));
  assert.deepEqual(limits.chat, parseLimitSpec('user:2/1m,ip:20/1m'), 'the option wins over the environment');
  assert.deepEqual(resolveWriteLimits(env, {}).chat, parseLimitSpec('user:5/1m,ip:50/1m'), 'the environment over the default');
  assert.deepEqual(limits.state, parseLimitSpec(DEFAULT_WRITE_LIMITS.state), 'an empty variable is unset');
  assert.deepEqual(Object.keys(limits).sort(), Object.keys(DEFAULT_WRITE_LIMITS).sort());
});

test('resolveWriteLimits refuses unknown classes and rules that do not fit a class', () => {
  assert.throws(() => resolveWriteLimits({}, { comments: 'user:1/1h,ip:1/1h' }), /unknown class comments/);
  assert.throws(() => resolveWriteLimits({}, { comment: 'user:1/1h' }), /comment: needs at least one ip rule/);
  assert.throws(() => resolveWriteLimits({}, { comment: 'ip:1/1h' }), /comment: needs at least one user rule/);
  assert.throws(() => resolveWriteLimits({}, { webhook: 'user:1/1h,ip:1/1h' }), /webhook: has no account/);
  assert.throws(() => resolveWriteLimits({ WRITE_LIMIT_CHATS: 'user:1/1h,ip:1/1h' }, {}), /WRITE_LIMIT_CHATS \(unknown/);
});

test('invalid WRITE_LIMIT_* settings stop the start, named without their value', () => {
  const value = 'user:not-a-rule-7d3e';
  const problems = startupProblems(startupEnv({ WRITE_LIMIT_MODERATED: value, WRITE_LIMIT_NOPE: 'ip:1/1h' }));
  assert.equal(problems.length, 2, problems.join('\n'));
  assert.ok(problems.some((p) => p.startsWith('WRITE_LIMIT_MODERATED (')));
  assert.ok(problems.some((p) => p.startsWith('WRITE_LIMIT_NOPE (unknown')));
  assert.ok(!problems.join('\n').includes('not-a-rule-7d3e'), 'the value must never be printed');
  assert.deepEqual(writeLimitSettingProblems({ WRITE_LIMIT_CHAT: 'user:5/1m,ip:50/1m', WRITE_LIMIT_STATE: '' }), []);
  assert.deepEqual(startupProblems(startupEnv({ WRITE_LIMIT_CHAT: 'user:5/1m,ip:50/1m' })), []);
});

test('ipKey: IPv4 as is, IPv4-mapped as IPv4, IPv6 per /64, nothing as one bucket', () => {
  assert.equal(ipKey('203.0.113.7'), '203.0.113.7');
  assert.equal(ipKey('::ffff:203.0.113.7'), '203.0.113.7');
  assert.equal(ipKey('::FFFF:cb00:7107'), '203.0.113.7');
  assert.equal(ipKey('2001:db8:1:2:aaaa::1'), '2001:db8:1:2::/64');
  assert.equal(ipKey('2001:0db8:0001:0002:ffff:ffff:ffff:ffff'), '2001:db8:1:2::/64');
  assert.equal(ipKey('2001:db8:1:2::'), '2001:db8:1:2::/64');
  assert.equal(ipKey('2001:db8::1'), '2001:db8:0:0::/64');
  assert.equal(ipKey('fe80::1%eth0'), 'fe80:0:0:0::/64');
  assert.equal(ipKey('64:ff9b::192.0.2.1'), '64:ff9b:0:0::/64');
  assert.notEqual(ipKey('2001:db8:1:2::1'), ipKey('2001:db8:1:3::1'));
  for (const nothing of [undefined, null, '', 'not-an-address']) assert.equal(ipKey(nothing), 'unknown');
});

/** A store with a hand-moved clock. */
function storeWith(limits) {
  let t = 1_000_000;
  const store = createLimitStore({ limits: resolveWriteLimits({}, limits), now: () => t });
  return { store, advance: (ms) => (t += ms) };
}

test('the store counts only allowed requests, and every rule must hold', () => {
  const { store } = storeWith({ comment: 'user:2/1h,ip:3/1h' });
  assert.equal(store.consume('comment', 1, '198.51.100.1').allowed, true);
  assert.equal(store.consume('comment', 1, '198.51.100.1').allowed, true);
  const refused = store.consume('comment', 1, '198.51.100.1');
  assert.equal(refused.allowed, false);
  assert.ok(refused.retryAfterSec >= 3599 && refused.retryAfterSec <= 3600, String(refused.retryAfterSec));
  // The refused request was not counted against the address: another account still has 1 left.
  assert.equal(store.consume('comment', 2, '198.51.100.1').allowed, true);
  assert.equal(store.consume('comment', 3, '198.51.100.1').allowed, false, 'address limit 3 reached');
});

test('the account counter follows the account across addresses; classes count apart', () => {
  const { store } = storeWith({ reaction: 'user:2/1h,ip:100/1h' });
  assert.equal(store.consume('reaction', 7, '198.51.100.1').allowed, true);
  assert.equal(store.consume('reaction', 7, '2001:db8::1').allowed, true);
  assert.equal(store.consume('reaction', 7, '203.0.113.9').allowed, false);
  assert.equal(store.consume('state', 7, '203.0.113.9').allowed, true, 'another class has its own counter');
});

test('a window ends: the counter starts again, Retry-After shrinks with time', () => {
  const { store, advance } = storeWith({ report: 'user:1/10m,ip:100/10m' });
  assert.equal(store.consume('report', 1, '198.51.100.1').allowed, true);
  advance(4 * 60_000);
  assert.equal(store.consume('report', 1, '198.51.100.1').retryAfterSec, 360);
  advance(6 * 60_000);
  assert.equal(store.consume('report', 1, '198.51.100.1').allowed, true);
});

test('the longest blocking rule decides Retry-After', () => {
  const { store, advance } = storeWith({ moderated: 'user:1/1h,user:2/1d,ip:100/1h' });
  store.consume('moderated', 1, '198.51.100.1');
  advance(H);
  store.consume('moderated', 1, '198.51.100.1');
  advance(H);
  const r = store.consume('moderated', 1, '198.51.100.1');
  assert.equal(r.allowed, false);
  assert.equal(r.retryAfterSec, 22 * 3600, 'the day rule (22 h left), not the hour rule (1 h)');
});

test('expired counters are swept, and the store never grows past its bound', () => {
  let t = 0;
  const limits = resolveWriteLimits({}, { state: 'user:1/1m,ip:1000/1m' });
  const store = createLimitStore({ limits, now: () => t, maxEntries: 50 });
  for (let i = 0; i < 20; i += 1) store.consume('state', i, `198.51.100.${i}`);
  assert.equal(store.size(), 40, 'one account and one address counter per request');
  t += 61_000;
  store.sweep();
  assert.equal(store.size(), 0);
  for (let i = 0; i < 100; i += 1) store.consume('state', i, `198.51.100.${i}`);
  assert.ok(store.size() <= 50, `size ${store.size()}`);
});

test('a class with account rules refuses to count a request without an account', () => {
  const { store } = storeWith({});
  assert.throws(() => store.consume('comment', null, '198.51.100.1'), /needs an authenticated user/);
  assert.equal(store.consume('webhook', null, '198.51.100.1').allowed, true);
});

test('rateLimit() refuses an unknown class at startup and tags its middleware', () => {
  assert.throws(() => rateLimit('comments'), /Unknown rate limit class/);
  assert.equal(rateLimit('comment').rateLimitClass, 'comment');
});

test('the middleware answers 429 with the message and Retry-After, and fails closed without counters', () => {
  const { store } = storeWith({ chat: 'user:1/1m,ip:100/1m' });
  const mw = rateLimit('chat');
  const req = { app: { locals: { writeLimits: store } }, user: { id: 1 }, ip: '198.51.100.1', resume() { this.resumed = true; } };
  const res = {
    headers: {},
    set(k, v) {
      this.headers[k] = v;
    },
    status(code) {
      this.code = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  let passed = 0;
  mw(req, res, (err) => {
    assert.equal(err, undefined);
    passed += 1;
  });
  mw(req, res, () => assert.fail('the second request passed'));
  assert.equal(passed, 1);
  assert.equal(res.code, 429);
  assert.deepEqual(res.body, { message: RATE_LIMIT_MESSAGE });
  assert.equal(res.headers['Retry-After'], '60');
  assert.equal(req.resumed, true, 'an unread body is discarded');

  let failure;
  mw({ app: { locals: {} }, user: { id: 1 }, ip: '198.51.100.1' }, res, (err) => (failure = err));
  assert.match(String(failure?.message), /write limiter missing/);
});
