/**
 * Guard for the internal routes (routes/internal.js): only Laravel, which knows the shared secret
 * NODE_INTERNAL_SECRET, may call them. The secret travels in the `X-Internal-Secret` header.
 *
 * - No secret configured (or a too short one): every call is refused with 503. The routes fail
 *   closed; production does not start without the secret (config.js).
 * - A missing or wrong header: 404, the same answer as for a path that does not exist, so a
 *   caller learns nothing about the route.
 *
 * Both values are hashed before the comparison, so timingSafeEqual always compares equal lengths
 * and the time taken says nothing about the secret.
 */
import crypto from 'node:crypto';
import { INTERNAL_SECRET_MIN_LENGTH } from './config.js';

export const INTERNAL_SECRET_HEADER = 'x-internal-secret';

const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest();

export function requireInternalSecret(secret) {
  const expected = typeof secret === 'string' && secret.length >= INTERNAL_SECRET_MIN_LENGTH ? sha256(secret) : null;

  return (req, res, next) => {
    if (!expected) return res.status(503).json({ message: 'Serverfehler.' });
    const given = sha256(req.get(INTERNAL_SECRET_HEADER) ?? '');
    if (!crypto.timingSafeEqual(given, expected)) return res.status(404).json({ message: 'Nicht gefunden.' });
    return next();
  };
}
