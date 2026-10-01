/**
 * Internal routes: called by Laravel (api/) and by the container health check, never by the app.
 *
 * Mounted under /internal (app.js), outside /api: Laravel's public fallback forwards only paths
 * under /api (api/app/Http/Controllers/NodeFallbackController.php), so nothing from outside reaches
 * these routes through Laravel. Calls that change data also need the shared secret
 * (internal-secret.js).
 */
import crypto from 'node:crypto';
import { Router } from 'express';
import { pool } from '../db.js';
import { HttpError } from '../validate.js';
import { deleteUserAccount } from '../account-deletion.js';
import { requireInternalSecret } from '../internal-secret.js';

export const MSG_LAST_ADMIN = 'Du bist der letzte Admin – ernenne erst jemand anderen, bevor du dein Konto löschst.';

/**
 * Kopfzeile, mit der Laravel eine vollstaendig bestaetigte Loeschung
 * weiterreicht (api/app/Support/NodeInternal.php).
 */
const GRANT_HEADER = 'x-account-deletion-grant';

/**
 * Loest eine Freigabe von Laravel ein – genau einmal.
 *
 * Bei aktiver Zwei-Faktor-Anmeldung verlangt das Loeschen zusaetzlich einen
 * Code. Pruefen kann ihn nur Laravel (das TOTP-Secret ist mit dessen APP_KEY
 * verschluesselt). Laravel prueft also Passwort, Code und „letzter Admin",
 * legt dann eine Zeile mit purpose 'delete' in two_factor_challenges an und
 * reicht den Klartext-Token in dieser Kopfzeile hierher weiter.
 *
 * The grant is the second lock next to the shared secret: it holds only for this account, for
 * two minutes, once. DELETE ... und affectedRows machen das Einloesen atomar: Zwei
 * gleichzeitige Anfragen mit demselben Token – nur eine gewinnt.
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

/** The internal router; `secret` is NODE_INTERNAL_SECRET (config.js). */
export function internalRouter({ secret } = {}) {
  const router = Router({ caseSensitive: true, strict: true });

  // GET /internal/health – container health check: the process answers and reaches the database.
  router.get('/health', async (req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ ok: true });
    } catch {
      res.status(500).json({ ok: false });
    }
  });

  /**
   * DELETE /internal/accounts/:id – das Konto endgueltig loeschen (Daten und Dateien).
   *
   * Laravel has checked everything before (password or confirmation word, last admin, 2FA code;
   * api/app/Http/Controllers/AccountController.php) and sends the shared secret and a one-time
   * grant for exactly this account. What is left here is the deletion itself
   * (account-deletion.js, the same code the admin panel uses).
   */
  router.delete('/accounts/:id(\\d+)', requireInternalSecret(secret), async (req, res, next) => {
    try {
      const userId = Number(req.params.id);
      const grant = req.get(GRANT_HEADER);
      if (!grant || !(await consumeDeletionGrant(userId, grant))) {
        throw new HttpError(403, 'Die Bestätigung ist abgelaufen – bitte versuch es noch einmal.');
      }

      const result = await deleteUserAccount(userId, { refuseLastAdmin: true });
      if (result === 'last_admin') throw new HttpError(409, MSG_LAST_ADMIN);
      if (result === 'not_found') throw new HttpError(404, 'Nicht gefunden.');

      res.json({ message: 'Dein Konto wurde gelöscht.' });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
