import crypto from 'node:crypto';
import { Router } from 'express';
import { pool, first } from '../db.js';
import { hashPassword, checkPassword } from '../auth.js';
import { Validator, HttpError, isEmail } from '../validate.js';
import { passwordProblem } from '../password-policy.js';

const router = Router();

// Wie Laravel: Reset-Links laufen nach 60 Minuten ab.
const EXPIRE_MINUTES = 60;

/** Zufaelliger 64-Zeichen-Token (Klartext geht an den Nutzer, gehasht in die DB). */
function makeResetToken() {
  return crypto.randomBytes(48).toString('base64url').slice(0, 64);
}

/**
 * POST /api/forgot-password
 * Nimmt eine E-Mail entgegen und legt (falls das Konto existiert) einen Reset-Token an.
 * Antwortet IMMER neutral – so verraet die API nicht, ob eine E-Mail registriert ist.
 *
 * Hinweis: Der eigentliche Mail-Versand braucht einen SMTP-Zugang und ist ein
 * eigenes Ticket. Bis dahin wird der Link/Token nur in die Server-Konsole geloggt,
 * damit man den Ablauf testen kann.
 */
router.post('/forgot-password', async (req, res, next) => {
  try {
    const b = req.body ?? {};
    const v = new Validator(b);
    if (!isEmail(b.email)) v.add('email', 'Bitte eine gueltige E-Mail-Adresse angeben.');
    v.throwIfFails();

    const user = await first('SELECT id FROM users WHERE email = ?', [b.email]);
    if (user) {
      const token = makeResetToken();
      const tokenHash = await hashPassword(token);
      // Token gehasht speichern; created_at fuer die Ablauf-Pruefung.
      await pool.query(
        `INSERT INTO password_reset_tokens (email, token, created_at)
           VALUES (?, ?, NOW())
         ON DUPLICATE KEY UPDATE token = VALUES(token), created_at = NOW()`,
        [b.email, tokenHash],
      );
      // TODO(eigenes Ticket): echten Mail-Versand anbinden (SMTP).
      console.log(`[forgot-password] Reset-Token fuer ${b.email}: ${token}`);
    }

    res.json({
      status: 'sent',
      message: 'Falls ein Konto existiert, ist eine E-Mail zum Zuruecksetzen unterwegs.',
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/reset-password
 * Setzt mit gueltigem Token ein neues Passwort. Erwartet: email, token, password,
 * password_confirmation. Verbraucht den Token (Einmal-Nutzung).
 */
router.post('/reset-password', async (req, res, next) => {
  try {
    const b = req.body ?? {};
    const v = new Validator(b);

    if (!b.token) v.add('token', 'Der Token fehlt.');
    if (!isEmail(b.email)) v.add('email', 'Bitte eine gueltige E-Mail-Adresse angeben.');
    // Dieselbe Regel wie bei der Registrierung (src/password-policy.js) – hier
    // zunaechst OHNE Benutzernamen, der kommt erst nach der Token-Pruefung
    // dazu (Begruendung dort).
    const passwordError = passwordProblem(b.password, {
      email: typeof b.email === 'string' ? b.email : null,
    });
    if (passwordError) v.add('password', passwordError);
    if (b.password_confirmation !== undefined && b.password !== b.password_confirmation) {
      v.add('password', 'Die Passwoerter stimmen nicht ueberein.');
    }
    v.throwIfFails();

    const row = await first(
      'SELECT email, token, created_at FROM password_reset_tokens WHERE email = ?',
      [b.email],
    );

    // Gleiche neutrale Fehlermeldung wie Laravel: Token ungueltig ODER abgelaufen.
    const invalid = () =>
      new HttpError(422, 'Dieser Link zum Zuruecksetzen ist ungueltig.', {
        email: ['Dieser Link zum Zuruecksetzen ist ungueltig.'],
      });

    if (!row || !(await checkPassword(String(b.token), row.token))) {
      throw invalid();
    }

    const ageMs = Date.now() - new Date(`${String(row.created_at).replace(' ', 'T')}Z`).getTime();
    if (ageMs > EXPIRE_MINUTES * 60 * 1000) {
      await pool.query('DELETE FROM password_reset_tokens WHERE email = ?', [b.email]);
      throw invalid();
    }

    /**
     * Benutzername im Passwort? Erst JETZT, mit gueltigem Token.
     *
     * Vorher waere die Meldung ein Orakel: Wer zu einer fremden Adresse
     * Passwoerter durchprobiert, erfuehre aus „darf deinen Benutzernamen nicht
     * enthalten", dass es das Konto gibt – und Stueck fuer Stueck, wie es heisst.
     * Genau das soll die neutrale Antwort von /forgot-password verhindern.
     */
    const owner = await first('SELECT username FROM users WHERE email = ?', [b.email]);
    const personalError = passwordProblem(b.password, { username: owner?.username ?? null, email: b.email });
    if (personalError) {
      throw new HttpError(422, personalError, { password: [personalError] });
    }

    // Neues Passwort setzen + alle bestehenden Tokens/Reset-Zeile entwerten.
    const newHash = await hashPassword(String(b.password));
    await pool.query('UPDATE users SET password = ?, remember_token = NULL, updated_at = NOW() WHERE email = ?', [
      newHash,
      b.email,
    ]);
    await pool.query('DELETE FROM password_reset_tokens WHERE email = ?', [b.email]);

    res.json({ status: 'reset', message: 'Dein Passwort wurde zurueckgesetzt.' });
  } catch (err) {
    next(err);
  }
});

export default router;
