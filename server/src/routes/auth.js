import { Router } from 'express';
import { pool, first } from '../db.js';
import {
  createToken,
  checkPassword,
  hashPassword,
  serializeUser,
  profileComplete,
  requireAuth,
} from '../auth.js';
import { Validator, HttpError, isEmail, isAlphaDash, missingIds } from '../validate.js';

const router = Router();
const ACCOUNT_TYPES = ['personal', 'business'];

async function tokenResponse(res, userRow, deviceName, status = 200) {
  const token = await createToken(userRow.id, deviceName || 'mobile');
  res.status(status).json({
    user: serializeUser(userRow),
    token,
    profile_complete: await profileComplete(userRow),
  });
}

// POST /api/register
router.post('/register', async (req, res, next) => {
  try {
    const b = req.body ?? {};
    const v = new Validator(b);

    if (!b.name || typeof b.name !== 'string') v.add('name', 'Der Name ist erforderlich.');
    if (!b.username || typeof b.username !== 'string') {
      v.add('username', 'Der Benutzername ist erforderlich.');
    } else if (b.username.length < 3 || b.username.length > 30 || !isAlphaDash(b.username)) {
      v.add('username', 'Der Benutzername ist ungueltig (3-30 Zeichen, nur Buchstaben/Zahlen/-_).');
    }
    if (!isEmail(b.email)) v.add('email', 'Bitte eine gueltige E-Mail-Adresse angeben.');
    if (!b.password || String(b.password).length < 8 || !/[a-zA-Z]/.test(b.password) || !/\d/.test(b.password)) {
      v.add('password', 'Das Passwort muss mindestens 8 Zeichen mit Buchstaben und Zahlen haben.');
    }
    if (!ACCOUNT_TYPES.includes(b.account_type)) v.add('account_type', 'Ungueltiger Kontotyp.');

    // Eindeutigkeit
    if (!v.errors.username && b.username) {
      if (await first('SELECT id FROM users WHERE username = ?', [b.username])) {
        v.add('username', 'Dieser Benutzername ist bereits vergeben.');
      }
    }
    if (!v.errors.email && isEmail(b.email)) {
      if (await first('SELECT id FROM users WHERE email = ?', [b.email])) {
        v.add('email', 'Diese E-Mail-Adresse ist bereits registriert.');
      }
    }

    const interests = Array.isArray(b.interests) ? b.interests.map(Number) : [];
    if (interests.length > 0 && (await missingIds('interests', interests)).length > 0) {
      v.add('interests', 'Mindestens ein Interesse existiert nicht.');
    }

    v.throwIfFails();

    const passwordHash = await hashPassword(String(b.password));
    const [result] = await pool.query(
      `INSERT INTO users (name, username, email, password, account_type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NOW(), NOW())`,
      [b.name, b.username, b.email, passwordHash, b.account_type],
    );

    if (interests.length > 0) {
      const rows = interests.map(() => '(?, ?, NOW(), NOW())').join(', ');
      const params = interests.flatMap((id) => [result.insertId, id]);
      await pool.query(
        `INSERT INTO interest_user (user_id, interest_id, created_at, updated_at) VALUES ${rows}`,
        params,
      );
    }

    const user = await first('SELECT * FROM users WHERE id = ?', [result.insertId]);
    await tokenResponse(res, user, b.device_name, 201);
  } catch (err) {
    next(err);
  }
});

// POST /api/login
router.post('/login', async (req, res, next) => {
  try {
    const b = req.body ?? {};
    const v = new Validator(b);
    if (!isEmail(b.email)) v.add('email', 'Bitte eine gueltige E-Mail-Adresse angeben.');
    if (!b.password) v.add('password', 'Das Passwort ist erforderlich.');
    v.throwIfFails();

    const user = await first('SELECT * FROM users WHERE email = ?', [b.email]);
    if (!user || !(await checkPassword(String(b.password), user.password))) {
      throw new HttpError(422, 'Diese Zugangsdaten passen nicht zu unseren Aufzeichnungen.', {
        email: ['Diese Zugangsdaten passen nicht zu unseren Aufzeichnungen.'],
      });
    }

    await tokenResponse(res, user, b.device_name);
  } catch (err) {
    next(err);
  }
});

// POST /api/logout  (geschuetzt)
router.post('/logout', requireAuth, async (req, res, next) => {
  try {
    await pool.query('DELETE FROM personal_access_tokens WHERE id = ?', [req.tokenId]);
    res.json({ message: 'Abgemeldet.' });
  } catch (err) {
    next(err);
  }
});

// GET /api/user  (geschuetzt)
router.get('/user', requireAuth, async (req, res, next) => {
  try {
    res.json({
      user: serializeUser(req.user),
      profile_complete: await profileComplete(req.user),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
