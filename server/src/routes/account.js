import crypto from 'node:crypto';
import { Router } from 'express';
import { pool } from '../db.js';
import { requireAuth, checkPassword } from '../auth.js';
import { HttpError } from '../validate.js';
import { deleteUserAccount } from '../account-deletion.js';

const router = Router();

/**
 * Das Wort, das Konten OHNE Passwort (reine Google-Anmeldung) tippen, um das
 * Loeschen zu bestaetigen. Verglichen wird ohne Ruecksicht auf Gross/klein
 * und auch in der Schreibweise ohne Umlaut – wer auf einer Tastatur ohne „Ö"
 * tippt, soll nicht am Loeschen scheitern.
 */
const CONFIRM_WORDS = ['LÖSCHEN', 'LOESCHEN'];

export const MSG_LAST_ADMIN = 'Du bist der letzte Admin – ernenne erst jemand anderen, bevor du dein Konto löschst.';

/**
 * Kopfzeile, mit der Laravel eine vollstaendig bestaetigte Loeschung
 * weiterreicht (api/app/Http/Controllers/AccountController.php).
 */
const GRANT_HEADER = 'x-account-deletion-grant';

/**
 * Loest eine Freigabe von Laravel ein – genau einmal.
 *
 * ## Warum es die Freigabe gibt
 *
 * Bei aktiver Zwei-Faktor-Anmeldung verlangt das Loeschen zusaetzlich einen
 * Code. Pruefen kann ihn nur Laravel (das TOTP-Secret ist mit dessen APP_KEY
 * verschluesselt). Laravel prueft also Passwort, Code und „letzter Admin",
 * legt dann eine Zeile mit purpose 'delete' in two_factor_challenges an und
 * reicht die Anfrage mit dem Klartext-Token in dieser Kopfzeile hierher weiter.
 *
 * Ein geheimer Schluessel zwischen den beiden Servern ist dafuer nicht noetig:
 * Die Datenbank IST der gemeinsame Vertrauensanker. Wer die Kopfzeile selbst
 * setzt, braucht einen Token, dessen Hash in der Tabelle steht – den gibt es
 * nur ueber Laravel, und er gilt zwei Minuten und nur fuer dieses Konto.
 * DELETE ... und affectedRows machen das Einloesen atomar: Zwei gleichzeitige
 * Anfragen mit demselben Token – nur eine gewinnt.
 *
 * `expires_at > NOW()` vergleicht MySQL-Zeit mit MySQL-Zeit: Laravel schreibt
 * den Ablauf fuer diese Zeilen mit NOW() der Datenbank, nicht mit der Uhr von PHP.
 */
async function consumeDeletionGrant(userId, grant) {
  const hash = crypto.createHash('sha256').update(String(grant)).digest('hex');
  const [result] = await pool.query(
    `DELETE FROM two_factor_challenges
      WHERE user_id = ? AND purpose = 'delete' AND token_hash = ? AND expires_at > NOW()`,
    [userId, hash],
  );
  return result.affectedRows === 1;
}

function confirmWordOk(value) {
  if (typeof value !== 'string') return false;
  return CONFIRM_WORDS.includes(value.normalize('NFC').trim().toLocaleUpperCase('de-DE'));
}

/**
 * DELETE /api/me  (geschuetzt) – das eigene Konto endgueltig loeschen.
 *
 * Body: { password } – oder bei Konten ohne Passwort { confirm: "LÖSCHEN" }.
 *
 * Kommt die Anfrage ueber Laravel (der Normalfall fuer die App), hat Laravel
 * alles schon geprueft und schickt eine Freigabe mit; dann bleibt hier nur das
 * Loeschen. Ohne Freigabe prueft dieser Endpunkt selbst – das ist der Weg im
 * Docker-Abbild aus deploy/, in dem NUR dieses Backend laeuft. Zwei-Faktor-
 * Konten kommen diesen Weg nicht: ohne Laravel kein Code, also kein Loeschen
 * an Laravel vorbei.
 */
router.delete('/me', requireAuth, async (req, res, next) => {
  try {
    const b = req.body ?? {};
    const user = req.user;
    const grant = req.get(GRANT_HEADER);

    if (grant) {
      if (!(await consumeDeletionGrant(user.id, grant))) {
        throw new HttpError(403, 'Die Bestätigung ist abgelaufen – bitte versuch es noch einmal.');
      }
    } else {
      if (user.two_factor_method) {
        throw new HttpError(403, 'Bitte lösche dein Konto über die App.');
      }

      if (user.password) {
        if (typeof b.password !== 'string' || b.password === '') {
          throw new HttpError(422, 'Bitte gib dein Passwort ein.', { password: ['Bitte gib dein Passwort ein.'] });
        }
        if (!(await checkPassword(b.password, user.password))) {
          throw new HttpError(422, 'Das Passwort stimmt nicht.', { password: ['Das Passwort stimmt nicht.'] });
        }
      } else if (!confirmWordOk(b.confirm)) {
        const msg = 'Bitte tippe LÖSCHEN ein, um dein Konto zu löschen.';
        throw new HttpError(422, msg, { confirm: [msg] });
      }
    }

    const result = await deleteUserAccount(user.id, { refuseLastAdmin: true });
    if (result === 'last_admin') {
      throw new HttpError(409, MSG_LAST_ADMIN);
    }

    res.json({ message: 'Dein Konto wurde gelöscht.' });
  } catch (err) {
    next(err);
  }
});

export default router;
