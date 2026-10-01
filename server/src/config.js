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
 *   - NODE_INTERNAL_SECRET: shared with Laravel (api/), which sends it on the internal routes
 *     (routes/internal.js), at least INTERNAL_SECRET_MIN_LENGTH characters. Outside production
 *     it may be empty; the internal routes then refuse every call (fail closed).
 */

/** Shortest accepted NODE_INTERNAL_SECRET (`openssl rand -hex 32` gives 64 characters). */
export const INTERNAL_SECRET_MIN_LENGTH = 32;

/** True when the server runs as the production build. */
export function isProduction(env = process.env) {
  return env.NODE_ENV === 'production';
}

/** The shared secret for the internal routes, or '' when none is set. */
export function internalSecret(env = process.env) {
  return String(env.NODE_INTERNAL_SECRET ?? '');
}

/**
 * Names (never values) of the settings that keep the server from starting, with a short hint
 * where a name alone would not say what is wrong. An empty list means: start.
 */
export function startupProblems(env = process.env) {
  const problems = [];
  const production = isProduction(env);

  const secret = internalSecret(env);
  if (secret === '' ? production : secret.length < INTERNAL_SECRET_MIN_LENGTH) {
    problems.push(`NODE_INTERNAL_SECRET (required in production, at least ${INTERNAL_SECRET_MIN_LENGTH} characters)`);
  }

  return problems;
}
