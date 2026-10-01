/**
 * Anfragen auf eine hoehere Kontostufe – die Nutzer-Seite.
 *
 * ## Warum eine Anfrage und kein Schalter
 *
 * Die Stufe schaltet Rechte frei: Creator darf veroeffentlichen, Business sieht
 * Zahlen und darf Events hervorheben. Wer sich das selbst geben kann, braucht
 * die Stufe nicht – deshalb setzt sie ausschliesslich ein Admin
 * (`PATCH /api/user`, dort auf Admins begrenzt). Hier steht der Weg dorthin:
 * Die Person fragt an, ein Admin bestaetigt oder lehnt ab
 * (`/api/admin/upgrade-requests`, siehe routes/admin.js).
 *
 * Frueher ging dieser Weg per Support-Mail aus der App heraus. Das hat
 * funktioniert, aber niemand konnte sagen, was offen ist: Die Anfrage lag in
 * einem Postfach, die Entscheidung in der Datenbank. Jetzt liegt beides an
 * derselben Stelle.
 *
 * ## Eine Zeile pro Konto
 *
 * Eine neue Anfrage UEBERSCHREIBT die alte (`ON DUPLICATE KEY UPDATE` auf dem
 * eindeutigen `user_id`). Damit kann es nie zwei offene Anfragen desselben
 * Kontos geben – und zwar ohne Nachsehen-dann-Einfuegen, das zwischen den zwei
 * Schritten schiefgehen koennte. Wer zweimal auf denselben Knopf tippt, hat
 * danach genau eine Anfrage; wer sich umentscheidet, ersetzt seine alte.
 */
import { createRouter } from '../router.js';
import { pool, first, toIso } from '../db.js';
import { requireAuth } from '../auth.js';
import { Validator } from '../validate.js';
import { REQUESTABLE_ACCOUNT_TYPES, normalizeAccountType, rankOf, requestableTypesFor } from '../accounts.js';
import { BILLING_PERIODS, normalizeBillingPeriod } from '../subscriptions.js';

const router = createRouter();

/** Laenge der Begruendung – dieselbe Zahl wie die Spalte in schema.sql. */
const MAX_MESSAGE = 500;

/**
 * Eine Anfrage als JSON. Auch von routes/admin.js benutzt, damit die App
 * dieselbe Form bekommt, egal von welcher Seite sie sie liest.
 */
export function transformRequest(row) {
  return {
    id: row.id,
    requested_type: normalizeAccountType(row.requested_type),
    /**
     * Monats- oder Jahresabo. Normalisiert und nicht durchgereicht, damit
     * Bestandszeilen (die Spalte kam erst mit dem Jahresabo dazu) und ein
     * unerwarteter Wert dasselbe ergeben: 'monthly'.
     */
    billing_period: normalizeBillingPeriod(row.billing_period),
    status: row.status,
    message: row.message ?? null,
    /** Grund der Ablehnung – steht in der App unter der abgelehnten Anfrage. */
    decision_note: row.decision_note ?? null,
    created_at: toIso(row.created_at),
    decided_at: toIso(row.decided_at),
  };
}

/** Die eigene Anfrage laden (oder null). */
async function ownRequest(userId) {
  return first('SELECT * FROM account_upgrade_requests WHERE user_id = ?', [userId]);
}

// GET /api/me/upgrade-request  (geschuetzt)
// Der Zustand fuer den Upgrade-Bildschirm: die eigene Anfrage und welche Stufen
// ueberhaupt in Frage kommen.
router.get('/me/upgrade-request', requireAuth, async (req, res, next) => {
  try {
    const row = await ownRequest(req.user.id);
    res.json({
      data: row ? transformRequest(row) : null,
      requestable: requestableTypesFor(req.user.account_type),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/me/upgrade-request  (geschuetzt) – Stufe anfragen.
// Body: { account_type, billing_period?, message? }
router.post('/me/upgrade-request', requireAuth, async (req, res, next) => {
  try {
    const type = typeof req.body?.account_type === 'string' ? req.body.account_type : '';
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    const v = new Validator(req.body ?? {});

    /**
     * Fehlt der Rhythmus GANZ, gilt 'monthly'.
     *
     * Nicht aus Bequemlichkeit: Im Store laufen aeltere Versionen dieser App
     * weiter, die das Feld nicht kennen. Wuerde es Pflicht, koennten deren
     * Nutzer von einem Tag auf den anderen keine Stufe mehr anfragen – und der
     * Fehler stuende in unserem Log, nicht in ihrem Bildschirm.
     *
     * Steht dagegen etwas drin, das wir nicht kennen, ist das ein Fehler und
     * kein Grund zu raten: Ein verschriebenes 'jaehrlich' waere sonst von einem
     * gemeinten 'monthly' nicht mehr zu unterscheiden.
     */
    const rawPeriod = req.body?.billing_period;
    const period =
      rawPeriod === undefined || rawPeriod === null || rawPeriod === ''
        ? 'monthly'
        : String(rawPeriod);
    if (!BILLING_PERIODS.includes(period)) {
      v.add('billing_period', 'Waehle zwischen Monats- und Jahresabo.');
    }

    if (!REQUESTABLE_ACCOUNT_TYPES.includes(type)) {
      v.add('account_type', 'Diese Kontostufe kann man nicht anfragen.');
    } else if (rankOf(type) <= rankOf(req.user.account_type)) {
      // Auch der Gleichstand ist ein Fehler: Eine Anfrage auf die Stufe, die man
      // schon hat, waere eine Anfrage, die niemand bestaetigen kann.
      v.add('account_type', 'Diese Stufe hat dein Konto schon.');
    }
    if (message.length > MAX_MESSAGE) {
      v.add('message', `Die Begruendung fasst hoechstens ${MAX_MESSAGE} Zeichen.`);
    }
    v.throwIfFails();

    // Eine frische Anfrage loescht die alte Entscheidung mit: Sonst stuende
    // unter einer offenen Anfrage noch der Grund der letzten Ablehnung.
    await pool.query(
      `INSERT INTO account_upgrade_requests
         (user_id, requested_type, billing_period, status, message, created_at, updated_at)
       VALUES (?, ?, ?, 'pending', ?, NOW(), NOW())
       ON DUPLICATE KEY UPDATE
         requested_type = ?,
         billing_period = ?,
         status         = 'pending',
         message        = ?,
         decided_by     = NULL,
         decided_at     = NULL,
         decision_note  = NULL,
         updated_at     = NOW()`,
      [
        req.user.id,
        type,
        normalizeBillingPeriod(period),
        message || null,
        type,
        normalizeBillingPeriod(period),
        message || null,
      ],
    );

    res.status(201).json({ data: transformRequest(await ownRequest(req.user.id)) });
  } catch (err) {
    next(err);
  }
});

export default router;
