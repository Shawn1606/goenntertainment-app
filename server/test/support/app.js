/**
 * Test support for building the app.
 *
 * FUNCTIONAL_WRITE_LIMITS: TEST-ONLY write limits for the functional suites - every default rule
 * of src/rate-limit.js with its maximum times 1000, windows unchanged. Those suites are about what
 * the routes do, not about limits, and all their requests come from one address (127.0.0.1): with
 * the production per-address rules they would be refused part-way through. This does not loosen a
 * test - no functional suite asserted limits; the real limits are tested with their real numbers
 * in test/write-limits.test.js and test/rate-limit.test.js.
 *
 * Every createApp() call in server/test passes `writeLimits` (these or its own);
 * test/write-limits.test.js checks that, so a new test file cannot forget it.
 *
 * Written out (not computed from src/rate-limit.js) so this file loads with any server version;
 * test/rate-limit.test.js checks that it equals the defaults x1000.
 */
export const FUNCTIONAL_WRITE_LIMITS = Object.freeze({
  moderated: 'user:10000/1h,user:30000/1d,ip:60000/1h,ip:300000/1d',
  comment: 'user:20000/10m,user:150000/1d,ip:200000/10m',
  chat: 'user:30000/1m,user:1000000/1d,ip:300000/1m',
  reaction: 'user:60000/10m,user:500000/1d,ip:600000/10m',
  relationship: 'user:30000/10m,user:200000/1d,ip:300000/10m',
  block: 'user:30000/10m,user:200000/1d,ip:300000/10m',
  report: 'user:10000/10m,user:50000/1d,ip:100000/10m',
  state: 'user:120000/1m,ip:1200000/1m',
  content: 'user:60000/10m,user:500000/1d,ip:600000/10m',
  account: 'user:5000/10m,user:20000/1d,ip:50000/10m',
  admin: 'user:120000/10m,ip:600000/10m',
  webhook: 'ip:120000/1m',
});
