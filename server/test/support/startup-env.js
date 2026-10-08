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

/** Test-only stand-in for the AI moderation key: never a real key. */
export const TEST_ANTHROPIC_API_KEY = 'test-only-fake-key-not-a-secret';

/** A local port nothing listens on: a started server can never reach the model provider. */
export const UNREACHABLE_MODEL_URL = 'http://127.0.0.1:9';

/**
 * Test-only daily AI moderation call limit (required in production, src/config.js). A started
 * test server asks no model at all; this is not a spending decision.
 */
export const TEST_MODERATION_DAILY_CALL_LIMIT = '100000';

/**
 * Test-only retention settings (required in production, src/config.js): ten years each, so the
 * prune a started server runs at once deletes no row another test file wrote. Not a retention
 * decision.
 */
export const TEST_RETENTION = Object.freeze({
  EVIDENCE_RETENTION_DAYS: '3650',
  MODERATION_REPORT_RETENTION_DAYS: '3650',
  TOKEN_RETENTION_DAYS: '3650',
  USAGE_RETENTION_DAYS: '3650',
});

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
    // Production requires the moderation key and refuses MODERATION_ENABLED=false (src/config.js).
    // A fake key and an address where nothing listens: a started server contacts nobody.
    // MODERATION_ENABLED is set because test/test.env switches it off for the other suites.
    ANTHROPIC_API_KEY: TEST_ANTHROPIC_API_KEY,
    ANTHROPIC_BASE_URL: UNREACHABLE_MODEL_URL,
    MODERATION_ENABLED: 'true',
    MODERATION_FAIL_OPEN: '',
    MODERATION_DAILY_CALL_LIMIT: TEST_MODERATION_DAILY_CALL_LIMIT,
    ...TEST_RETENTION,
    ...overrides,
  };
  return env;
}
