/**
 * src/config.js: the startup gate's rules as a pure function (no process, no database).
 * The process-level behaviour is in test/startup-settings.test.js.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_TOKEN_LIFETIME_MINUTES,
  INTERNAL_SECRET_MIN_LENGTH,
  moderationSettings,
  startupProblems,
  tokenLifetimeMinutes,
  trustProxySetting,
  trustProxyValid,
} from '../src/config.js';
import { startupEnv, TEST_ANTHROPIC_API_KEY } from './support/startup-env.js';

const SECRET_OK = 'x'.repeat(INTERNAL_SECRET_MIN_LENGTH);

test('the complete test environment has no startup problem', () => {
  assert.deepEqual(startupProblems(startupEnv()), []);
});

test('NODE_INTERNAL_SECRET: required in production, at least the minimum length everywhere', () => {
  const named = (env) => startupProblems(env).some((p) => p.startsWith('NODE_INTERNAL_SECRET'));

  assert.equal(named({ NODE_ENV: 'production' }), true, 'missing in production');
  assert.equal(named({ NODE_ENV: 'production', NODE_INTERNAL_SECRET: '' }), true, 'empty in production');
  assert.equal(named({ NODE_ENV: 'production', NODE_INTERNAL_SECRET: SECRET_OK.slice(1) }), true, 'one too short');
  assert.equal(named({ NODE_ENV: 'production', NODE_INTERNAL_SECRET: SECRET_OK }), false, 'long enough');

  assert.equal(named({}), false, 'outside production it may be empty');
  assert.equal(named({ NODE_INTERNAL_SECRET: 'short' }), true, 'but a set value must be long enough');
});

test('NODE_TRUST_PROXY: required in production, valid and not "everyone" everywhere', () => {
  const named = (env) => startupProblems(env).some((p) => p.startsWith('NODE_TRUST_PROXY'));

  assert.equal(named({ NODE_ENV: 'production' }), true, 'missing in production');
  assert.equal(named({ NODE_ENV: 'production', NODE_TRUST_PROXY: ' ' }), true, 'blank in production');
  assert.equal(named({ NODE_ENV: 'production', NODE_TRUST_PROXY: '172.30.99.20' }), false, 'one address');
  assert.equal(named({}), false, 'outside production it may be empty');

  for (const bad of ['1', 'true', 'not-an-address', '0.0.0.0/0', '::/0', '172.30.99.20, 0.0.0.0/0']) {
    assert.equal(named({ NODE_TRUST_PROXY: bad }), true, `${bad} must be refused`);
  }
  for (const good of ['loopback', '127.0.0.1', '172.30.99.20', '172.30.99.0/24', '::1']) {
    assert.equal(trustProxyValid(good), true, `${good} must be accepted`);
  }
});

test('trustProxySetting: the setting, else loopback in development and nobody in production', () => {
  assert.equal(trustProxySetting({ NODE_TRUST_PROXY: ' 172.30.99.20 ' }), '172.30.99.20');
  assert.equal(trustProxySetting({}), 'loopback');
  assert.equal(trustProxySetting({ NODE_ENV: 'production' }), false);
});

test('SANCTUM_EXPIRATION: optional, and a set value must be what Laravel accepts too', () => {
  const named = (env) => startupProblems(env).some((p) => p.startsWith('SANCTUM_EXPIRATION'));

  // Unset or empty: the default, 30 days (api/tests/Unit/SessionsLifetimeTest.php, same cases).
  assert.equal(DEFAULT_TOKEN_LIFETIME_MINUTES, 43200);
  assert.equal(tokenLifetimeMinutes({}), 43200);
  assert.equal(tokenLifetimeMinutes({ SANCTUM_EXPIRATION: '' }), 43200);
  assert.equal(named({ NODE_ENV: 'production' }), false, 'not required');

  assert.equal(tokenLifetimeMinutes({ SANCTUM_EXPIRATION: '60' }), 60);
  assert.equal(tokenLifetimeMinutes({ SANCTUM_EXPIRATION: ' 1440 ' }), 1440);
  assert.equal(named({ SANCTUM_EXPIRATION: '60' }), false);

  for (const bad of ['0', '-5', 'abc', '1.5', '60m', '00', '99999999', ' ']) {
    assert.equal(tokenLifetimeMinutes({ SANCTUM_EXPIRATION: bad }), null, `${JSON.stringify(bad)} must be refused`);
    assert.equal(named({ SANCTUM_EXPIRATION: bad }), true, `${JSON.stringify(bad)} must stop the start`);
  }
  const value = '7-test-only-days';
  assert.ok(!startupProblems({ SANCTUM_EXPIRATION: value }).some((p) => p.includes(value)), 'the value is never named');
});

test('problems name settings, never their values', () => {
  const value = 'visible-test-only-value';
  // The moderation key (required in production since F-06) is given, so exactly the two settings
  // that carry the visible value are named.
  const problems = startupProblems({
    NODE_ENV: 'production',
    NODE_TRUST_PROXY: value,
    NODE_INTERNAL_SECRET: value,
    ANTHROPIC_API_KEY: TEST_ANTHROPIC_API_KEY,
  });
  assert.equal(problems.length, 2);
  for (const problem of problems) assert.ok(!problem.includes(value), problem);
});

test('moderationSettings: off only with exactly "false", open on failure only with exactly "true"', () => {
  assert.deepEqual(moderationSettings({}), { enabled: true, hasKey: false, failOpen: false });
  assert.equal(moderationSettings({ MODERATION_ENABLED: 'false' }).enabled, false);
  for (const value of ['', 'true', 'FALSE', '0', 'no']) {
    assert.equal(moderationSettings({ MODERATION_ENABLED: value }).enabled, true, JSON.stringify(value));
  }
  assert.equal(moderationSettings({ MODERATION_FAIL_OPEN: 'true' }).failOpen, true);
  for (const value of ['', 'false', 'TRUE', '1', 'yes', ' true']) {
    assert.equal(moderationSettings({ MODERATION_FAIL_OPEN: value }).failOpen, false, JSON.stringify(value));
  }
  assert.equal(moderationSettings({ ANTHROPIC_API_KEY: '  ' }).hasKey, false);
  assert.equal(moderationSettings({ ANTHROPIC_API_KEY: TEST_ANTHROPIC_API_KEY }).hasKey, true);
});

test('ANTHROPIC_API_KEY: required in production only', () => {
  const named = (env) => startupProblems(env).some((p) => p.startsWith('ANTHROPIC_API_KEY'));
  assert.equal(named({ NODE_ENV: 'production' }), true, 'missing in production');
  assert.equal(named({ NODE_ENV: 'production', ANTHROPIC_API_KEY: ' ' }), true, 'blank in production');
  assert.equal(named({ NODE_ENV: 'production', ANTHROPIC_API_KEY: TEST_ANTHROPIC_API_KEY }), false);
  assert.equal(named({}), false, 'outside production moderation fails closed instead');
});

test('MODERATION_ENABLED: "false" is refused in production; other values than true/false everywhere', () => {
  const named = (env) => startupProblems(env).some((p) => p.startsWith('MODERATION_ENABLED'));
  assert.equal(named({ NODE_ENV: 'production', MODERATION_ENABLED: 'false' }), true);
  assert.equal(named({ NODE_ENV: 'production', MODERATION_ENABLED: 'true' }), false);
  assert.equal(named({ NODE_ENV: 'production' }), false, 'unset means on');
  assert.equal(named({ MODERATION_ENABLED: 'false' }), false, 'development and tests may switch it off');
  for (const value of ['0', 'off', 'FALSE', ' false']) {
    assert.equal(named({ MODERATION_ENABLED: value }), true, JSON.stringify(value));
  }
});

test('MODERATION_FAIL_OPEN: optional, and a set value must be "true" or "false"', () => {
  const named = (env) => startupProblems(env).some((p) => p.startsWith('MODERATION_FAIL_OPEN'));
  for (const value of [undefined, '', 'true', 'false']) {
    assert.equal(named({ NODE_ENV: 'production', MODERATION_FAIL_OPEN: value }), false, JSON.stringify(value));
  }
  const value = 'yes-test-only';
  assert.equal(named({ MODERATION_FAIL_OPEN: value }), true);
  assert.ok(!startupProblems({ MODERATION_FAIL_OPEN: value }).some((p) => p.includes(value)), 'the value is never named');
});
