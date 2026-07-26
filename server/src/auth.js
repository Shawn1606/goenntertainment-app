import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { pool, first } from './db.js';

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

/** Prueft bcrypt-Passwoerter; normalisiert Laravels $2y$-Praefix fuer bcryptjs. */
export function checkPassword(plain, hash) {
  if (!hash) {
    return false;
  }
  const normalized = hash.startsWith('$2y$') ? `$2b$${hash.slice(4)}` : hash;
  return bcrypt.compareSync(plain, normalized);
}

export function hashPassword(plain) {
  return bcrypt.hashSync(plain, 12);
}

/** Entfernt sensible Felder aus einer User-Zeile (wie Laravels $hidden). */
export function serializeUser(row) {
  if (!row) {
    return null;
  }
  const { password, remember_token, ...safe } = row;
  return safe;
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

    await pool.query('UPDATE personal_access_tokens SET last_used_at = NOW() WHERE id = ?', [id]);

    req.user = user;
    req.tokenId = token.id;
    return next();
  } catch (err) {
    return next(err);
  }
}
