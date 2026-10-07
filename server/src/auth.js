import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { tokenLifetimeMinutes } from './config.js';
import { pool, first } from './db.js';
import { mediaUrl } from './media.js';

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/*
 * Tokens are issued by Laravel (Sanctum) only: sign-up and sign-in are Laravel's routes. Node
 * reads them (requireAuth below) and deletes them (bans, account deletion).
 * The server tests write tokens of the same format themselves (test/support/fixtures.js).
 */

/**
 * The owner type of every token Laravel issues: `App\Models\User` (Sanctum's morph type). A token
 * of any other type is not an account's token. Named mirror: api/app/Models/User.php (the class
 * name) and TOKENABLE_TYPE in test/support/fixtures.js.
 */
export const TOKENABLE_TYPE = 'App\\Models\\User';

/**
 * Kostenfaktor fuer bcrypt. 10 ist weiterhin sicher (Laravel-Standard) und rund
 * 4x schneller als 12 (~80 ms statt ~310 ms mit reinem bcryptjs).
 */
const BCRYPT_ROUNDS = 10;

/** Async (bcrypt.hash statt hashSync) – blockiert den Event-Loop nicht. */
export function hashPassword(plain) {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

// Ein „echter" Bann setzt banned_until weit in die Zukunft; ein Timeout einen
// konkreten Zeitpunkt. NULL bedeutet aktiv.
export const PERMANENT_BAN_UNTIL = '9999-12-31 00:00:00';

/** Ist der Nutzer aktuell gesperrt? (banned_until liegt in der Zukunft, UTC.) */
export function isBanned(user) {
  if (!user || !user.banned_until) {
    return false;
  }
  // banned_until kommt als UTC-String 'YYYY-MM-DD HH:MM:SS' (dateStrings:true).
  const until = new Date(`${String(user.banned_until).replace(' ', 'T')}Z`);
  return until.getTime() > Date.now();
}

/**
 * Sperrt einen Nutzer bis `until` (SQL-String 'YYYY-MM-DD HH:MM:SS', UTC) mit Grund
 * und meldet ihn sofort ab. Wird vom Admin-Panel und von der KI-Moderation genutzt.
 */
export async function setBan(userId, until, reason) {
  await pool.query('UPDATE users SET banned_until = ?, ban_reason = ?, updated_at = NOW() WHERE id = ?', [
    until,
    reason,
    userId,
  ]);
  // Bestehende Tokens entwerten -> sofort abgemeldet.
  await pool.query('DELETE FROM personal_access_tokens WHERE tokenable_type = ? AND tokenable_id = ?', [
    TOKENABLE_TYPE,
    userId,
  ]);
}

/**
 * Legt einen Beweis-Datensatz zu einer Sperr-Aktion an.
 * `source`: 'admin' = von Hand gesetzt, 'ai' = automatisch durch die KI-Moderation
 * (dann ist adminId null). `until` nur bei Timeouts.
 */
export async function recordBanEvidence({ userId, adminId, source = 'admin', action, reason, until, imagePath }) {
  await pool.query(
    `INSERT INTO ban_evidence (user_id, admin_id, source, action, reason, banned_until, image_path, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
    [userId, adminId ?? null, source, action, reason, until ?? null, imagePath ?? null],
  );
}

/**
 * Entfernt sensible Felder aus einer User-Zeile (wie Laravels $hidden).
 *
 * `req` ist optional, sollte aber immer mitkommen: Nur damit werden Profilbild
 * und Banner zu fertigen Adressen (siehe src/media.js). Ohne `req` bleiben die
 * rohen Spaltenwerte stehen – brauchbar fuer Aufrufer ausserhalb einer Anfrage,
 * fuer eine API-Antwort aber zu wenig.
 */
export function serializeUser(row, req = null) {
  if (!row) {
    return null;
  }
  // Die Zwei-Faktor-Spalten ausser `two_factor_method` bleiben draussen – genau
  // wie im #[Hidden] von api/app/Models/User.php. Secret und Codes sind zwar
  // verschluesselt, aber verschluesselt ist nicht dasselbe wie „darf raus":
  // Jede Kopie ausserhalb der DB ist eine, die man nicht mehr zurueckholt.
  // `google_id` too (same list): Google sign-in was removed; the column is inert.
  const {
    password,
    remember_token,
    two_factor_secret,
    two_factor_recovery_codes,
    two_factor_confirmed_at,
    two_factor_last_step,
    google_id,
    ...safe
  } = row;
  // is_admin kommt aus der DB als 0/1 (oder fehlt bei alten DBs) -> echter Boolean.
  return {
    ...safe,
    is_admin: Boolean(safe.is_admin),
    ...(req
      ? { avatar: mediaUrl(req, safe.avatar), banner: mediaUrl(req, safe.banner ?? null) }
      : {}),
  };
}

/** Laedt die Interessen eines Nutzers (id, name, slug, icon) als Array. */
export async function loadUserInterests(userId) {
  const [rows] = await pool.query(
    `SELECT i.id, i.name, i.slug, i.icon
       FROM interest_user iu
       JOIN interests i ON i.id = iu.interest_id
      WHERE iu.user_id = ?
      ORDER BY i.name`,
    [userId],
  );
  return rows;
}

/** User-Objekt fuer API-Antworten – wie serializeUser, aber inkl. Interessen. */
export async function userPayload(row, req = null) {
  const safe = serializeUser(row, req);
  if (!safe) {
    return null;
  }
  return { ...safe, interests: await loadUserInterests(row.id) };
}

/**
 * The token-validity rule (F-20), one rule on both backends - a named mirror of Laravel's:
 *   - the token belongs to an account: `tokenable_type` App\Models\User;
 *   - it has an expiry date that has not passed: AppServiceProvider (api/app/Providers) refuses a
 *     token without `expires_at`, Sanctum's guard one whose `expires_at` has passed;
 *   - it was issued within the lifetime: Sanctum's guard refuses a token whose `created_at` is
 *     older than sanctum.expiration, which is SANCTUM_EXPIRATION (tokenLifetimeMinutes here). So a
 *     lower setting ends older sessions at once on both backends, whatever their stored
 *     `expires_at` says (both containers read the same setting: deploy/docker-compose.yml).
 * Laravel writes both dates when it issues a token (App\Support\Sessions). The comparisons run in
 * SQL against the database clock, the clock Laravel's dates are read against too (production runs
 * both in UTC). api/tests/Feature/TokenLifetimeTest.php and test/token-expiry.test.js pin the same
 * cases; scripts/ci/check-mirrors.mjs keeps the lifetime's default, its format and its setting
 * equal on both sides.
 */
const TOKEN_IS_VALID_SQL = `tokenable_type = ?
          AND expires_at IS NOT NULL AND expires_at > NOW()
          AND created_at > NOW() - INTERVAL ? MINUTE`;

/**
 * Express-Middleware: verlangt einen gueltigen Bearer-Token (Sanctum-kompatibel).
 * Setzt req.user (DB-Zeile) und req.tokenId.
 *
 * Valid: see TOKEN_IS_VALID_SQL. With an invalid SANCTUM_EXPIRATION (the server does not start
 * with one) no token is accepted: the request fails instead of falling back to some lifetime.
 */
export async function requireAuth(req, res, next) {
  try {
    const header = req.get('authorization') ?? '';
    const bearer = header.startsWith('Bearer ') ? header.slice(7) : null;
    const sep = bearer ? bearer.indexOf('|') : -1;

    if (!bearer || sep < 1) {
      return res.status(401).json({ message: 'Unauthenticated.' });
    }

    const id = bearer.slice(0, sep);
    const plain = bearer.slice(sep + 1);
    if (!/^\d{1,20}$/.test(id)) {
      return res.status(401).json({ message: 'Unauthenticated.' });
    }

    const lifetime = tokenLifetimeMinutes();
    if (lifetime === null) {
      throw new Error('SANCTUM_EXPIRATION is not a positive whole number of minutes');
    }

    const token = await first(
      `SELECT * FROM personal_access_tokens
        WHERE id = ? AND token = ? AND ${TOKEN_IS_VALID_SQL}`,
      [id, sha256(plain), TOKENABLE_TYPE, lifetime],
    );
    if (!token) {
      return res.status(401).json({ message: 'Unauthenticated.' });
    }

    const user = await first('SELECT * FROM users WHERE id = ?', [token.tokenable_id]);
    if (!user) {
      return res.status(401).json({ message: 'Unauthenticated.' });
    }

    // Gesperrte Nutzer: Token entwerten und abweisen.
    if (isBanned(user)) {
      await pool.query('DELETE FROM personal_access_tokens WHERE id = ?', [id]);
      return res.status(403).json({ message: 'Dein Konto ist gesperrt.' });
    }

    await pool.query('UPDATE personal_access_tokens SET last_used_at = NOW() WHERE id = ?', [id]);

    req.user = user;
    req.tokenId = token.id;
    return next();
  } catch (err) {
    return next(err);
  }
}

/**
 * Express-Middleware: verlangt einen Admin. Muss NACH requireAuth laufen
 * (nutzt req.user). Antwortet mit 403, wenn der Nutzer kein Admin ist.
 */
export function requireAdmin(req, res, next) {
  if (!req.user || !req.user.is_admin) {
    return res.status(403).json({ message: 'Kein Admin-Zugang.' });
  }
  return next();
}
