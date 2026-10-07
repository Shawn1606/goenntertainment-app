/**
 * Limits for every write route (F-07): per account and per client address.
 *
 * Every POST/PUT/PATCH/DELETE route takes `rateLimit('<class>')` directly after requireAuth (as
 * the first middleware on the unauthenticated webhook), before role checks and before an upload
 * is read, so a limited client is never parsed or checked further. test/write-limits.test.js
 * pins the class of every route and fails when a write route has no limiter. Exempt is only the
 * internal account deletion (routes/internal.js): it needs the shared secret and a one-time grant
 * for exactly that account, Laravel's own `account-sensitive` throttle runs before it, and Laravel
 * calls it without a client address (a per-address bucket there would count Laravel itself).
 *
 * ## Classes and rules
 *
 * Writes are grouped by what they cost and whom they reach (DEFAULT_WRITE_LIMITS below): content
 * that goes to the AI moderation, comments, reactions that notify, relationships, reports, cheap
 * state the app sends by itself, ... Each class has rules `scope:max/window`, e.g.
 * `user:10/1h,ip:60/1h`: at most 10 requests per account and 60 per client address per hour.
 * Every rule must hold; a refused request is not counted. The address rules allow 5 to 10 times
 * the account rules of the same window, so that a school or a mobile carrier behind one address is
 * not limited long before its users are. IPv6 addresses count per /64 (one subscriber's network).
 *
 * The defaults are engineering values. Each class can be set with WRITE_LIMIT_<CLASS> (e.g.
 * WRITE_LIMIT_MODERATED="user:10/1h,user:30/1d,ip:60/1h,ip:300/1d"); an invalid value stops the
 * start (config.js startupProblems). Tests pass their own through createApp({ writeLimits }).
 *
 * ## In memory, one process
 *
 * The counters live in this process's memory. That is exact for the way the server runs: ONE
 * Node process (src/index.js listens once; one node container in deploy/docker-compose.yml).
 * A restart forgets the counters. More processes would each count on their own and multiply
 * every limit by their number: keep it one process, or move the counters to a shared store first.
 *
 * Windows are fixed, starting with a key's first request (like Laravel's limiter): across a
 * window boundary up to twice a limit can pass.
 */
import net from 'node:net';

/**
 * The answer to a limited request - the same text Laravel sends (api/app/Providers/
 * AppServiceProvider.php); the app shows it verbatim. Named mirror, checked by
 * scripts/ci/check-mirrors.mjs.
 */
export const RATE_LIMIT_MESSAGE = 'Zu viele Versuche – bitte warte kurz und probier es dann noch mal.';

/** Default rules per class (see the module comment; listed with their routes in the PR text). */
export const DEFAULT_WRITE_LIMITS = Object.freeze({
  // One AI moderation call each (with an image), and notifications to every follower.
  moderated: 'user:10/1h,user:30/1d,ip:60/1h,ip:300/1d',
  // One AI moderation call each; notifies the owner.
  comment: 'user:20/10m,user:150/1d,ip:200/10m',
  // Word filter only; the burst brake in routes/chat.js stays on top.
  chat: 'user:30/1m,user:1000/1d,ip:300/1m',
  // Likes and their removal: a like/unlike loop notifies on every cycle.
  reaction: 'user:60/10m,user:500/1d,ip:600/10m',
  // Follows, friend requests and their removal: they notify.
  relationship: 'user:30/10m,user:200/1d,ip:300/10m',
  // Blocks: their own budget, so that blocking someone is never refused for following too much.
  block: 'user:30/10m,user:200/1d,ip:300/10m',
  // Reports land in the admins' inbox.
  report: 'user:10/10m,user:50/1d,ip:100/10m',
  // Cheap, idempotent state the app sends by itself (views, read markers, saves, joining).
  state: 'user:120/1m,ip:1200/1m',
  // Deleting, groups, links, boosts.
  content: 'user:60/10m,user:500/1d,ip:600/10m',
  // Account-level requests: a reward redemption, an upgrade request.
  account: 'user:5/10m,user:20/1d,ip:50/10m',
  // Admin actions: caps what a stolen admin token can do in a hurry.
  admin: 'user:120/10m,ip:600/10m',
  // RevenueCat's webhook: no account, per address only.
  webhook: 'ip:120/1m',
});

/** Classes whose routes have no account (no requireAuth): address rules only. */
const ANONYMOUS_CLASSES = new Set(['webhook']);

const UNIT_MS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
const MAX_WINDOW_MS = 30 * UNIT_MS.d;
const MAX_COUNT = 1_000_000_000;
const RULE = /^(user|ip):([1-9]\d{0,9})\/([1-9]\d{0,6})([smhd])$/;

/**
 * Parses `scope:max/window[,...]` (window = number + s|m|h|d), strictly: anything else throws.
 * Returns [{ scope, max, windowMs }].
 */
export function parseLimitSpec(spec) {
  if (typeof spec !== 'string' || spec.trim() === '') throw new Error('empty rule list');
  const rules = spec.split(',').map((part) => {
    const m = RULE.exec(part.trim());
    if (!m) throw new Error('a rule is not scope:max/window');
    const max = Number(m[2]);
    const windowMs = Number(m[3]) * UNIT_MS[m[4]];
    if (max > MAX_COUNT) throw new Error('a maximum is too large');
    if (windowMs > MAX_WINDOW_MS) throw new Error('a window is longer than 30 days');
    return { scope: m[1], max, windowMs };
  });
  const seen = new Set();
  for (const r of rules) {
    const key = `${r.scope}/${r.windowMs}`;
    if (seen.has(key)) throw new Error('two rules with the same scope and window');
    seen.add(key);
  }
  return rules;
}

/** Parses the rules of one class and checks that they fit it (see the module comment). */
function rulesForClass(cls, spec) {
  const rules = parseLimitSpec(spec);
  const scopes = new Set(rules.map((r) => r.scope));
  if (!scopes.has('ip')) throw new Error('needs at least one ip rule');
  if (ANONYMOUS_CLASSES.has(cls) && scopes.has('user')) throw new Error('has no account: ip rules only');
  if (!ANONYMOUS_CLASSES.has(cls) && !scopes.has('user')) throw new Error('needs at least one user rule');
  return rules;
}

const ENV_PREFIX = 'WRITE_LIMIT_';
const envName = (cls) => `${ENV_PREFIX}${cls.toUpperCase()}`;

/**
 * The rules per class: `overrides` (createApp's writeLimits) before the environment
 * (WRITE_LIMIT_<CLASS>, empty = unset) before DEFAULT_WRITE_LIMITS. Throws on an unknown class or
 * an invalid rule list, naming the class or setting, never the value.
 */
export function resolveWriteLimits(env = process.env, overrides = {}) {
  for (const cls of Object.keys(overrides ?? {})) {
    if (!Object.hasOwn(DEFAULT_WRITE_LIMITS, cls)) throw new Error(`writeLimits: unknown class ${cls}`);
  }
  const problems = writeLimitSettingProblems(env);
  if (problems.length > 0) throw new Error(`Invalid write limit settings: ${problems.join('; ')}`);

  const limits = {};
  for (const [cls, fallback] of Object.entries(DEFAULT_WRITE_LIMITS)) {
    const fromEnv = String(env[envName(cls)] ?? '').trim();
    const spec = overrides?.[cls] ?? (fromEnv !== '' ? fromEnv : fallback);
    try {
      limits[cls] = rulesForClass(cls, spec);
    } catch (err) {
      throw new Error(`writeLimits.${cls}: ${err.message}`);
    }
  }
  return limits;
}

/**
 * Names of WRITE_LIMIT_* settings that are unknown or invalid (for config.js startupProblems;
 * names and the reason only, never the value).
 */
export function writeLimitSettingProblems(env = process.env) {
  const problems = [];
  for (const name of Object.keys(env).filter((key) => key.startsWith(ENV_PREFIX)).sort()) {
    const cls = name.slice(ENV_PREFIX.length).toLowerCase();
    if (!Object.hasOwn(DEFAULT_WRITE_LIMITS, cls)) {
      problems.push(`${name} (unknown write limit class)`);
      continue;
    }
    const value = String(env[name] ?? '').trim();
    if (value === '') continue;
    try {
      rulesForClass(cls, value);
    } catch (err) {
      problems.push(`${name} (${err.message}; rules are scope:max/window, e.g. user:10/1h,ip:60/1h)`);
    }
  }
  return problems;
}

/** The eight 16-bit groups of an IPv6 address (lower-case hex, no leading zeros). */
function ipv6Groups(address) {
  let text = address.toLowerCase();
  const v4 = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map(Number);
    text = `${text.slice(0, -v4[0].length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = text.split('::');
  const left = head ? head.split(':') : [];
  const right = tail === undefined ? null : tail ? tail.split(':') : [];
  const groups = right === null ? left : [...left, ...Array(8 - left.length - right.length).fill('0'), ...right];
  return groups.map((g) => parseInt(g, 16).toString(16));
}

/**
 * The address bucket of a client: IPv4 as is (also when written IPv4-mapped, ::ffff:a.b.c.d),
 * IPv6 per /64, anything else (no address) one shared bucket.
 */
export function ipKey(ip) {
  const raw = String(ip ?? '').trim();
  if (net.isIPv4(raw)) return raw;
  const address = raw.split('%')[0];
  if (net.isIPv6(address)) {
    const groups = ipv6Groups(address);
    if (groups.slice(0, 5).every((g) => g === '0') && groups[5] === 'ffff') {
      const [hi, lo] = [parseInt(groups[6], 16), parseInt(groups[7], 16)];
      return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
    }
    return `${groups.slice(0, 4).join(':')}::/64`;
  }
  return 'unknown';
}

/** Expired counters are dropped at most this often (on the next request after it). */
const SWEEP_EVERY_MS = 60_000;

/**
 * The counters. `limits` from resolveWriteLimits; `now` injectable for tests; `maxEntries` bounds
 * the memory: past it, expired counters go first, then the oldest ones.
 */
export function createLimitStore({ limits, now = Date.now, maxEntries = 200_000 }) {
  const entries = new Map(); // key -> { count, resetAt }
  let nextSweep = now() + SWEEP_EVERY_MS;

  function sweep(t = now()) {
    for (const [key, entry] of entries) if (entry.resetAt <= t) entries.delete(key);
  }

  function keyOf(cls, rule, userId, address) {
    const who = rule.scope === 'user' ? `u:${userId}` : `ip:${address}`;
    return `${cls}|${who}|${rule.windowMs}`;
  }

  /**
   * Counts one request of `cls` by account `userId` from address `ip`, if every rule still has
   * room: { allowed: true } - or { allowed: false, retryAfterSec } without counting anything.
   */
  function consume(cls, userId, ip) {
    const rules = limits[cls];
    if (!rules) throw new Error(`Unknown rate limit class: ${cls}`);
    const t = now();
    if (t >= nextSweep) {
      sweep(t);
      nextSweep = t + SWEEP_EVERY_MS;
    }
    if (userId === null || userId === undefined) {
      if (rules.some((r) => r.scope === 'user')) throw new Error(`rate limit class ${cls} needs an authenticated user`);
    }
    const address = ipKey(ip);
    const keys = rules.map((rule) => keyOf(cls, rule, userId, address));

    let waitMs = 0;
    rules.forEach((rule, i) => {
      const entry = entries.get(keys[i]);
      if (entry && entry.resetAt > t && entry.count >= rule.max) waitMs = Math.max(waitMs, entry.resetAt - t);
    });
    if (waitMs > 0) return { allowed: false, retryAfterSec: Math.max(1, Math.ceil(waitMs / 1000)) };

    rules.forEach((rule, i) => {
      const entry = entries.get(keys[i]);
      if (entry && entry.resetAt > t) {
        entry.count += 1;
      } else {
        entries.delete(keys[i]); // re-inserted at the end: Map order stays oldest window first
        entries.set(keys[i], { count: 1, resetAt: t + rule.windowMs });
      }
    });
    if (entries.size > maxEntries) {
      sweep(t);
      for (const key of entries.keys()) {
        if (entries.size <= maxEntries) break;
        entries.delete(key);
      }
    }
    return { allowed: true, retryAfterSec: 0 };
  }

  return { consume, sweep, size: () => entries.size, limits };
}

/**
 * The middleware for one route: `rateLimit('comment')`. Throws at startup for an unknown class.
 * The counters are the app's (createApp sets app.locals.writeLimits).
 */
export function rateLimit(cls) {
  if (!Object.hasOwn(DEFAULT_WRITE_LIMITS, cls)) throw new Error(`Unknown rate limit class: ${cls}`);
  const middleware = (req, res, next) => {
    const store = req.app?.locals?.writeLimits;
    if (!store) return next(new Error('write limiter missing: createApp() sets app.locals.writeLimits'));
    let result;
    try {
      result = store.consume(cls, req.user?.id ?? null, req.ip);
    } catch (err) {
      return next(err);
    }
    if (result.allowed) return next();
    // An upload that is refused here is never read: discard it, so the client gets the 429
    // instead of a connection reset.
    req.resume();
    res.set('Retry-After', String(result.retryAfterSec));
    return res.status(429).json({ message: RATE_LIMIT_MESSAGE });
  };
  middleware.rateLimitClass = cls;
  return middleware;
}
