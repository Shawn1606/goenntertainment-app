/**
 * Der Webhook von RevenueCat – die einzige Quelle, die eine Stufe aus einem Abo
 * setzt.
 *
 * ## Warum nicht die App meldet, dass bezahlt wurde
 *
 * Nach einem erfolgreichen Kauf weiss die App es zuerst. Trotzdem darf sie es
 * nicht melden: `POST /api/me/bezahlt` ist ein HTTP-Request, und den schickt
 * jeder mit einem Terminal. Die Stufe schaltet Rechte frei, also muss sie von
 * jemandem kommen, der es wissen KANN – dem Store, ueber RevenueCat. Die App
 * darf hoechstens sagen "sieh nochmal nach" (GET /api/me/subscription).
 *
 * ## Warum hier kein Raw-Body gebraucht wird
 *
 * Bei Stripe muss der Webhook den unveraenderten Body sehen, weil die Signatur
 * darueber gebildet wird – deshalb muss er dort VOR `express.json()` haengen.
 * RevenueCat macht es anders: Es schickt einen frei gewaehlten Wert im
 * `Authorization`-Header, den man im Dashboard eintraegt. Ein gewoehnlicher
 * JSON-Body reicht also, und diese Route kann normal eingehaengt werden.
 *
 * ## Fail closed
 *
 * Fehlt `REVENUECAT_WEBHOOK_TOKEN` in der Umgebung, antwortet die Route mit 503
 * und verarbeitet nichts. Die bequeme Variante ("kein Token gesetzt, dann eben
 * ohne Pruefung") waere ein offenes Tor, mit dem sich jeder eine Stufe schenken
 * koennte – und sie fiele niemandem auf, weil alles funktioniert.
 */
import crypto from 'node:crypto';
import { createRouter } from '../router.js';
import { pool, toIso } from '../db.js';
import { requireAuth } from '../auth.js';
import { applyRevenueCatEvent } from '../subscriptions.js';
import { logError, logInfo } from '../log.js';

const router = createRouter();

/**
 * Vergleich in konstanter Zeit.
 *
 * Ein `===` auf Zeichenketten bricht beim ersten Unterschied ab; aus der
 * Antwortzeit liesse sich der Token Zeichen fuer Zeichen erraten. Die Laengen
 * werden vorher geprueft, weil `timingSafeEqual` bei ungleicher Laenge wirft.
 */
/**
 * The event type for the log: RevenueCat's types are upper-case words with underscores
 * (INITIAL_PURCHASE, EXPIRATION, ...). Anything else is not printed - it is request data.
 */
export function eventTypeForLog(type) {
  return typeof type === 'string' && /^[A-Z_]{1,64}$/.test(type) ? type : '(unknown type)';
}

function tokenMatches(given, expected) {
  const a = Buffer.from(String(given ?? ''));
  const b = Buffer.from(String(expected ?? ''));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// POST /api/webhooks/revenuecat  (oeffentlich, per Token im Header geschuetzt)
router.post('/webhooks/revenuecat', async (req, res, next) => {
  try {
    const expected = process.env.REVENUECAT_WEBHOOK_TOKEN;
    if (!expected) {
      logError('[revenuecat] Webhook abgelehnt', 'REVENUECAT_WEBHOOK_TOKEN fehlt');
      return res.status(503).json({ message: 'Webhook nicht eingerichtet.' });
    }
    if (!tokenMatches(req.get('authorization'), expected)) {
      return res.status(401).json({ message: 'Nicht berechtigt.' });
    }

    const result = await applyRevenueCatEvent(req.body?.event);

    // IMMER 200, wenn der Token stimmte – auch wenn das Ereignis nichts
    // geaendert hat. RevenueCat wiederholt alles, was nicht mit 2xx antwortet:
    // Ein Paywall-Aufruf oder ein Ereignis zu einem geloeschten Konto wuerde
    // sonst tagelang erneut geschickt. Was passiert ist, steht im Log.
    // Only values the code has checked: the type (eventTypeForLog), the account id and the
    // entitlements that exist in this app (applyRevenueCatEvent filters them), never the body.
    const type = eventTypeForLog(req.body?.event?.type);
    if (result.applied) {
      logInfo(
        `[revenuecat] ${type} -> Nutzer ${result.userId}: ${result.entitlements.join(',')} = ${result.status}, Stufe ${result.tier}`,
      );
    } else {
      logInfo(`[revenuecat] ${type} ignoriert: ${result.reason}`);
    }
    return res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});

// GET /api/me/subscription  (geschuetzt) – der eigene Abo-Stand.
// Fuer den Upgrade-Bildschirm: bis wann laeuft was, und haengt eine Zahlung.
router.get('/me/subscription', requireAuth, async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT entitlement, provider, product_id, status, expires_at
         FROM subscriptions
        WHERE user_id = ?
          AND status IN ('active','grace')
          AND (expires_at IS NULL OR expires_at > NOW())
        ORDER BY expires_at IS NULL DESC, expires_at DESC`,
      [req.user.id],
    );
    res.json({
      data: rows.map((row) => ({
        entitlement: row.entitlement,
        provider: row.provider,
        product_id: row.product_id ?? null,
        status: row.status,
        expires_at: toIso(row.expires_at),
      })),
      /** Die Stufe, die daraus gilt – dieselbe, die der Server ueberall prueft. */
      account_type: req.user.account_type,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
