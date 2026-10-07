/**
 * src/config.js: the startup gate's rules as a pure function (no process, no database).
 * The process-level behaviour is in test/startup-settings.test.js.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_TOKEN_LIFETIME_MINUTES,
  INTERNAL_SECRET_MIN_LENGTH,
  startupProblems,
  tokenLifetimeMinutes,
  trustProxySetting,
  trustProxyValid,
} from '../src/config.js';
import { startupEnv } from './support/startup-env.js';

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
  const problems = startupProblems({ NODE_ENV: 'production', NODE_TRUST_PROXY: value, NODE_INTERNAL_SECRET: value });
  assert.equal(problems.length, 2);
  for (const problem of problems) assert.ok(!problem.includes(value), problem);
});
