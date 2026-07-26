import { Router } from 'express';
import { pool, first } from '../db.js';
import { createToken, serializeUser, profileComplete } from '../auth.js';
import { Validator, HttpError } from '../validate.js';

const router = Router();

/**
 * POST /api/auth/google
 * Die App holt sich bei Google einen access_token und schickt ihn hierher.
 * Wir pruefen ihn direkt bei Google, legen den User bei Bedarf an und geben
 * einen eigenen Token zurueck (gleiche Logik wie der alte Laravel-Controller).
 */
router.post('/google', async (req, res, next) => {
  try {
    const b = req.body ?? {};
    const v = new Validator(b);
    if (!b.access_token || typeof b.access_token !== 'string') {
      v.add('access_token', 'access_token ist erforderlich.');
    }
    v.throwIfFails();

    const resp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${b.access_token}` },
    });
    if (!resp.ok) {
      throw new HttpError(422, 'Google-Anmeldung fehlgeschlagen.', {
        access_token: ['Der Google-Token ist ungueltig oder abgelaufen.'],
      });
    }
    const g = await resp.json(); // { sub, email, name, picture, ... }

    let user = await first('SELECT * FROM users WHERE google_id = ?', [g.sub]);

    if (!user) {
      user = await first('SELECT * FROM users WHERE email = ?', [g.email]);
      if (user) {
        await pool.query('UPDATE users SET google_id = ?, avatar = ?, updated_at = NOW() WHERE id = ?', [
          g.sub,
          g.picture ?? null,
          user.id,
        ]);
      } else {
        const [result] = await pool.query(
          `INSERT INTO users (name, email, google_id, avatar, email_verified_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, NOW(), NOW(), NOW())`,
          [g.name ?? 'Google User', g.email, g.sub, g.picture ?? null],
        );
        user = await first('SELECT * FROM users WHERE id = ?', [result.insertId]);
      }
      user = await first('SELECT * FROM users WHERE id = ?', [user.id]);
    }

    const token = await createToken(user.id, b.device_name || 'mobile');
    res.json({
      user: serializeUser(user),
      token,
      profile_complete: await profileComplete(user),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
