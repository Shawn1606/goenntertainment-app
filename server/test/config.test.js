/**
 * src/config.js: the startup gate's rules as a pure function (no process, no database).
 * The process-level behaviour is in test/startup-settings.test.js.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { INTERNAL_SECRET_MIN_LENGTH, startupProblems } from '../src/config.js';
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

test('problems name settings, never their values', () => {
  const value = 'visible-test-only-value';
  const problems = startupProblems({ NODE_ENV: 'production', NODE_INTERNAL_SECRET: value });
  assert.ok(problems.length > 0);
  for (const problem of problems) assert.ok(!problem.includes(value), problem);
});
