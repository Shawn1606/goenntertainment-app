/**
 * A complete environment for starting the server process in a test (`node src/index.js`).
 *
 * TEST-ONLY values, labelled as such and never used anywhere else. Every setting that the startup
 * gate (src/config.js startupProblems) checks is here with a valid value, so a test that wants to
 * see one problem removes or changes exactly that one input and nothing else decides the outcome.
 * A later required setting gets its entry here in the same change that adds it to the gate.
 *
 * Settings a test removes are set to '' rather than deleted: dotenv (src/index.js) never
 * overwrites a variable that exists, so a developer's server/.env cannot fill the gap.
 */
/** Test-only shared secret for the internal routes (at least 32 characters). */
export const TEST_INTERNAL_SECRET = 'test-only-internal-secret-not-a-secret-0000';

export function startupEnv(overrides = {}) {
  const env = {
    // Database and PATH from the test process (the harness or CI provide them).
    ...process.env,
    NODE_ENV: 'production',
    // Test-only address of "Laravel", the one hop whose forwarding headers count.
    NODE_TRUST_PROXY: '127.0.0.1',
    NODE_INTERNAL_SECRET: TEST_INTERNAL_SECRET,
    // Port 0: the system picks a free one.
    PORT: '0',
    // Moderation off and no key: a started server contacts nobody.
    ANTHROPIC_API_KEY: '',
    ...overrides,
  };
  return env;
}
