/**
 * Settings the server checks before it starts, in one place.
 *
 * index.js asks startupProblems() once, before it builds the app, and exits with the NAMES of
 * every missing or invalid setting. Values are never printed: some of them are secrets. Later
 * settings that the server cannot run without belong in this function too, so that one gate
 * decides the start (and a test that starts the server with server/test/support/startup-env.js
 * changes exactly one input).
 *
 * Required in production (NODE_ENV=production, set by server/Dockerfile and the compose):
 *   - NODE_TRUST_PROXY: the address of Laravel (api/), the one hop whose X-Forwarded-For Node
 *     believes (see trustProxySetting). Outside production the default is 'loopback'.
 *   - NODE_INTERNAL_SECRET: shared with Laravel (api/), which sends it on the internal routes
 *     (routes/internal.js), at least INTERNAL_SECRET_MIN_LENGTH characters. Outside production
 *     it may be empty; the internal routes then refuse every call (fail closed).
 *
 * Optional, checked when set:
 *   - WRITE_LIMIT_<CLASS>, the write limits per class (rate-limit.js);
 *   - SANCTUM_EXPIRATION, the access-token lifetime in minutes (tokenLifetimeMinutes).
 */
import express from 'express';
import { writeLimitSettingProblems } from './rate-limit.js';

/** Shortest accepted NODE_INTERNAL_SECRET (`openssl rand -hex 32` gives 64 characters). */
export const INTERNAL_SECRET_MIN_LENGTH = 32;

/**
 * The access-token lifetime when SANCTUM_EXPIRATION is unset: 30 days, in minutes. Named mirror of
 * DEFAULT_LIFETIME_MINUTES in api/app/Support/Sessions.php (scripts/ci/check-mirrors.mjs).
 */
export const DEFAULT_TOKEN_LIFETIME_MINUTES = 43200;

/**
 * An accepted SANCTUM_EXPIRATION: a positive whole number of minutes, at most seven digits. Named
 * mirror of the pattern in Sessions::lifetimeFromEnv (scripts/ci/check-mirrors.mjs).
 */
export const TOKEN_LIFETIME_PATTERN = /^[1-9]\d{0,6}$/;

/**
 * The access-token lifetime in minutes (F-20), from SANCTUM_EXPIRATION - the setting Laravel reads
 * for the same purpose (App\Support\Sessions::lifetimeFromEnv, the same rule): unset or empty means
 * the default; a value that is not a positive whole number gives null, and the server does not
 * start with it (startupProblems). Expiry is never switched off.
 */
export function tokenLifetimeMinutes(env = process.env) {
  const raw = env.SANCTUM_EXPIRATION;
  if (raw === undefined || raw === null || raw === '') return DEFAULT_TOKEN_LIFETIME_MINUTES;
  const trimmed = String(raw).trim();
  return TOKEN_LIFETIME_PATTERN.test(trimmed) ? Number(trimmed) : null;
}

/** True when the server runs as the production build. */
export function isProduction(env = process.env) {
  return env.NODE_ENV === 'production';
}

/** The shared secret for the internal routes, or '' when none is set. */
export function internalSecret(env = process.env) {
  return String(env.NODE_INTERNAL_SECRET ?? '');
}

/**
 * Express's 'trust proxy' value: whose X-Forwarded-For (and -Proto, -Host) Node believes (F-31).
 *
 * Node sits behind Laravel, and Laravel sends the client address it established itself. So Node
 * trusts exactly that one hop: NODE_TRUST_PROXY, addresses or ranges in the syntax of Express's
 * 'trust proxy' (e.g. 172.30.42.20, or 'loopback'). Then `req.ip` is the client's address and
 * not Laravel's, and per-address rate limits count clients. From any other peer the headers are
 * ignored and `req.ip` is the peer itself.
 *
 * Not set: 'loopback' in development (`php artisan serve` calls Node on 127.0.0.1); in
 * production nobody (false) - but production does not start without it (startupProblems).
 */
export function trustProxySetting(env = process.env) {
  const value = String(env.NODE_TRUST_PROXY ?? '').trim();
  if (value !== '') return value;
  return isProduction(env) ? false : 'loopback';
}

/** Public documentation addresses: a 'trust proxy' value that trusts them trusts the internet. */
const PUBLIC_PROBES = ['203.0.113.1', '2001:db8::1'];

/**
 * Whether a NODE_TRUST_PROXY value is usable: Express accepts it, and it does not trust every
 * address (such as 0.0.0.0/0), which would let any client choose its own address again. A bare
 * number is refused too: it reads like a hop count, but from the environment it is a string,
 * which Express takes as an address.
 */
export function trustProxyValid(value) {
  if (/^\s*\d+\s*$/.test(String(value))) return false;
  let trust;
  try {
    trust = express().set('trust proxy', value).get('trust proxy fn');
  } catch {
    return false;
  }
  return !PUBLIC_PROBES.some((address) => trust(address, 0));
}

/**
 * Names (never values) of the settings that keep the server from starting, with a short hint
 * where a name alone would not say what is wrong. An empty list means: start.
 */
export function startupProblems(env = process.env) {
  const problems = [];
  const production = isProduction(env);

  const trustProxy = String(env.NODE_TRUST_PROXY ?? '').trim();
  if (trustProxy === '' ? production : !trustProxyValid(trustProxy)) {
    problems.push("NODE_TRUST_PROXY (required in production: Laravel's address, never all addresses)");
  }

  const secret = internalSecret(env);
  if (secret === '' ? production : secret.length < INTERNAL_SECRET_MIN_LENGTH) {
    problems.push(`NODE_INTERNAL_SECRET (required in production, at least ${INTERNAL_SECRET_MIN_LENGTH} characters)`);
  }

  // Optional everywhere (the code has defaults), but a set value must be valid (rate-limit.js).
  problems.push(...writeLimitSettingProblems(env));

  // Optional too; a set value must be valid, exactly as Laravel requires (tokenLifetimeMinutes).
  if (tokenLifetimeMinutes(env) === null) {
    problems.push('SANCTUM_EXPIRATION (optional; when set, a positive whole number of minutes)');
  }

  return problems;
}
