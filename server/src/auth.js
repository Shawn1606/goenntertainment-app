import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { pool, first } from './db.js';
import { mediaUrl } from './media.js';

const TOKENABLE_TYPE = 'App\\Models\\User';

/** Zufaelliger 40-Zeichen-String wie Laravels Str::random(40). */
function randomTokenString(length = 40) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += chars[bytes[i] % chars.length];
  }
  return out;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/**
 * Legt einen persoenlichen Zugriffs-Token an – gleiches Format wie Laravel Sanctum:
 * gespeichert wird nur der sha256-Hash, zurueckgegeben wird "{id}|{klartext}".
 */
export async function createToken(userId, name = 'mobile') {
  const plain = randomTokenString();
  const [result] = await pool.query(
    `INSERT INTO personal_access_tokens
       (tokenable_type, tokenable_id, name, token, abilities, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NOW(), NOW())`,
    [TOKENABLE_TYPE, userId, name, sha256(plain), '["*"]'],
  );
  return `${result.insertId}|${plain}`;
}

/**
 * Kostenfaktor fuer bcrypt. 10 ist weiterhin sicher (Laravel-Standard) und rund
 * 4x schneller als 12 (~80 ms statt ~310 ms mit reinem bcryptjs).
 */
const BCRYPT_ROUNDS = 10;

/**
 * Prueft bcrypt-Passwoerter; normalisiert Laravels $2y$-Praefix fuer bcryptjs.
 * Async (bcrypt.compare statt compareSync), damit der Event-Loop nicht blockiert –
 * sonst haengen waehrend eines Logins ALLE anderen Anfragen.
 */
export function checkPassword(plain, hash) {
  if (!hash) {
    return Promise.resolve(false);
  }
  const normalized = hash.startsWith('$2y$') ? `$2b$${hash.slice(4)}` : hash;
  return bcrypt.compare(plain, normalized);
}

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
 * Sperr-Details fuer die Anzeige beim Login: Grund, Ende (ISO) und ob dauerhaft.
 * permanent = banned_until liegt >100 Jahre in der Zukunft (echter Bann).
 */
export function banInfo(user) {
  const untilMs = user?.banned_until
    ? new Date(`${String(user.banned_until).replace(' ', 'T')}Z`).getTime()
    : 0;
  const permanent = untilMs > Date.now() + 100 * 365 * 24 * 3600 * 1000;
  return {
    reason: user?.ban_reason ?? null,
    permanent,
    banned_until: permanent || !untilMs ? null : `${String(user.banned_until).replace(' ', 'T')}Z`,
  };
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
  await pool.query('DELETE FROM personal_access_tokens WHERE tokenable_id = ?', [userId]);
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
  const { password, remember_token, ...safe } = row;
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

/** Profil vollstaendig: Username + Kontotyp gesetzt und mind. 3 Interessen. */
export async function profileComplete(user) {
  if (!user || user.username === null || user.account_type === null) {
    return false;
  }
  const row = await first(
    'SELECT COUNT(*) AS c FROM interest_user WHERE user_id = ?',
    [user.id],
  );
  return Number(row?.c ?? 0) >= 3;
}

/**
 * Express-Middleware: verlangt einen gueltigen Bearer-Token (Sanctum-kompatibel).
 * Setzt req.user (DB-Zeile) und req.tokenId.
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

    const token = await first(
      'SELECT * FROM personal_access_tokens WHERE id = ? AND token = ?',
      [id, sha256(plain)],
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
