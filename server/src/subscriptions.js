/**
 * Abos: was ein In-App-Kauf freischaltet – und wer die Stufe am Ende setzt.
 *
 * Die App verkauft ueber Apple und Google (In-App-Kauf; Stripe darf das laut
 * Apple 3.1.1 nicht, siehe die Preise in src/domain/account.ts). RevenueCat
 * fasst beide Laeden zusammen und meldet Aenderungen per Webhook an
 * routes/revenuecat.js. Hier steht, was daraus folgt.
 *
 * Dieselben reinen Funktionen gibt es in der App unter
 * src/domain/subscription.ts – die App entscheidet damit, was sie anzeigt,
 * dieser Server entscheidet, was gilt. Wer eine aendert, muss beide anfassen;
 * test/subscriptions.test.js und src/domain/subscription.test.ts halten das fest.
 *
 * ## Der Client wird nicht gefragt
 *
 * Die Stufe setzt AUSSCHLIESSLICH der Webhook. Ein "ich habe bezahlt" aus der
 * App ist kein Beleg – es ist ein HTTP-Request, den jeder schicken kann. Die App
 * darf nach einem Kauf hoechstens sagen "sieh nochmal nach", und der Server
 * schaut dann bei sich.
 */
import { pool, first } from './db.js';
import { ACCOUNT_TYPES, normalizeAccountType, rankOf } from './accounts.js';

/** Stufen, die man kaufen kann – Standard kostet nichts (gleiche Liste wie die App). */
export const PURCHASABLE_ENTITLEMENTS = ACCOUNT_TYPES.filter((type) => type !== 'standard');

/**
 * Die zwei Zahlungsrhythmen. Gegenstueck zu src/domain/billing-period.ts in der App.
 *
 * ## Warum hier nur die Namen stehen und keine Preise
 *
 * Ein Jahresabo schaltet NICHTS anderes frei als das Monatsabo derselben Stufe:
 * Beide haengen bei RevenueCat am selben Entitlement (`creator`), und deshalb
 * aendert der Rhythmus an `tierFromEntitlements` und an der Tabelle
 * `subscriptions` keine Zeile. Der Server muss ihn nur EINLESEN koennen – fuer
 * die Anfrage aus dem Upgrade-Bildschirm (routes/upgrades.js), damit der Admin
 * sieht, was gewuenscht war.
 *
 * Preise stehen bewusst nicht hier: Abgebucht wird im Store, und der kennt
 * seine Preise je Land und Waehrung besser als wir. Die Zahlen in der App
 * (src/domain/account.ts) sind die Anzeige, nicht die Abrechnung.
 */
export const BILLING_PERIODS = ['monthly', 'yearly'];

/**
 * Rhythmus einlesen – im Zweifel **monatlich**.
 *
 * Dieselbe Richtung wie bei den Kontostufen: Was unverstaendlich ankommt, fuehrt
 * zur kleineren Verpflichtung. Niemand soll wegen eines vertippten Feldes als
 * Jahreskunde in der Admin-Liste stehen.
 */
export function normalizeBillingPeriod(raw) {
  return raw === 'yearly' ? 'yearly' : 'monthly';
}

/**
 * Ereignisse, die den Zugang WEGNEHMEN. Absichtlich eine kurze Liste.
 *
 * `CANCELLATION` steht hier NICHT drin, und das ist der wichtigste Satz in
 * dieser Datei: Eine Kuendigung schaltet nur die automatische Verlaengerung ab.
 * Bezahlt ist bis zum Ende der laufenden Periode, und genau dann kommt
 * `EXPIRATION`. Wer bei `CANCELLATION` abschaltet, nimmt Leuten Wochen weg, die
 * sie bezahlt haben – und erfaehrt es erst aus den Beschwerden.
 *
 * `BILLING_ISSUE` fehlt aus demselben Grund: Die Zahlung haengt, der Store
 * versucht es erneut, der Zugang laeuft weiter. Scheitert es endgueltig, kommt
 * `EXPIRATION`.
 */
const REVOKING_EVENTS = new Set(['EXPIRATION', 'SUBSCRIPTION_PAUSED']);

/** Ereignisse, die den Zugang GEBEN oder bestaetigen. */
const GRANTING_EVENTS = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'UNCANCELLATION',
  'NON_RENEWING_PURCHASE',
  'PRODUCT_CHANGE',
  'SUBSCRIPTION_EXTENDED',
  'TRANSFER',
  'TEMPORARY_ENTITLEMENT_GRANT',
  'REFUND_REVERSED',
]);

/** Zahlung haengt – Zugang bleibt, aber sichtbar als solches vermerkt. */
const GRACE_EVENTS = new Set(['BILLING_ISSUE']);

/**
 * Welcher Status aus einem Ereignistyp folgt – oder `null`, wenn das Ereignis
 * die Stufe nicht beruehrt.
 *
 * `null` ist der haeufigste Fall und kein Fehler: RevenueCat schickt auch
 * Paywall-Aufrufe, Testereignisse und Experimente. Alles, was hier nicht
 * ausdruecklich steht, aendert nichts – im Zweifel wird kein Zugang genommen.
 */
export function statusForEventType(type) {
  if (REVOKING_EVENTS.has(type)) return 'expired';
  if (GRANTING_EVENTS.has(type)) return 'active';
  if (GRACE_EVENTS.has(type)) return 'grace';
  return null;
}

/** Kennen wir dieses Entitlement? Unbekanntes wird verworfen, nicht geraten. */
export function isKnownEntitlement(id) {
  return typeof id === 'string' && PURCHASABLE_ENTITLEMENTS.includes(id);
}

/**
 * Welche Stufe eine Menge aktiver Entitlements freischaltet – die hoechste.
 *
 * Beim Wechsel von Creator auf Business melden beide Stores fuer den Rest der
 * Periode BEIDE Abos als aktiv. Und dasselbe Konto kann auf dem iPhone und auf
 * Android gekauft haben. In beiden Faellen ist mehr bezahlt worden, also gilt
 * das Bessere.
 */
export function tierFromEntitlements(entitlementIds) {
  if (!Array.isArray(entitlementIds)) return 'standard';
  let best = 'standard';
  for (const id of entitlementIds) {
    if (isKnownEntitlement(id) && rankOf(id) > rankOf(best)) best = id;
  }
  return best;
}

/**
 * Die Stufe, die gilt: das Bessere aus Admin-Vergabe und laufendem Abo.
 *
 * Ein Abo kann eine vergebene Stufe anheben, aber niemals senken – sonst
 * verliert ein Partnerkonto mit dauerhaftem Business seine Stufe, sobald ein
 * zusaetzlich getesteter Monat Business Plus ablaeuft. Ausfuehrlich begruendet
 * an der Spalte `users.granted_account_type` in schema.sql.
 */
export function effectiveTier(grantedType, subscribedType) {
  const granted = normalizeAccountType(grantedType);
  const subscribed = normalizeAccountType(subscribedType);
  return rankOf(subscribed) > rankOf(granted) ? subscribed : granted;
}

/** Store-Name von RevenueCat in unsere Spalte. Unbekanntes bleibt lesbar. */
export function providerFromStore(store) {
  const known = {
    APP_STORE: 'app_store',
    MAC_APP_STORE: 'app_store',
    PLAY_STORE: 'play_store',
    STRIPE: 'stripe',
    PROMOTIONAL: 'promotional',
  };
  return known[String(store ?? '').toUpperCase()] ?? 'unknown';
}

/** Millisekunden von RevenueCat in eine DB-DateTime (UTC) – oder null. */
export function msToDateTime(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Rechnet `users.account_type` neu aus und schreibt sie.
 *
 * Die EINZIGE Stelle, die diese Spalte aus einem Abo heraus setzt. Gelesen wird
 * dabei der Stand der Datenbank und nicht das gerade eingetroffene Ereignis:
 * Ein Konto kann mehrere Abos haben, und nur die Summe ergibt die Stufe.
 *
 * `grace` zaehlt als bezahlt – die Zahlung haengt, der Zugang laeuft weiter.
 */
export async function recomputeAccountType(userId) {
  const [rows] = await pool.query(
    `SELECT entitlement FROM subscriptions
      WHERE user_id = ?
        AND status IN ('active','grace')
        AND (expires_at IS NULL OR expires_at > NOW())`,
    [userId],
  );
  const user = await first('SELECT granted_account_type FROM users WHERE id = ?', [userId]);
  const tier = effectiveTier(
    user?.granted_account_type,
    tierFromEntitlements(rows.map((row) => row.entitlement)),
  );
  await pool.query('UPDATE users SET account_type = ?, updated_at = NOW() WHERE id = ?', [
    tier,
    userId,
  ]);
  return tier;
}

/**
 * Ein Webhook-Ereignis verarbeiten. Gibt zurueck, was daraus geworden ist –
 * das landet im Log und beantwortet spaeter die Frage "warum hat der die Stufe".
 *
 * ## Warum `event_at` verglichen wird
 *
 * Webhooks kommen nicht in der Reihenfolge an, in der sie entstanden sind, und
 * werden bei einem Fehler erneut geschickt. Ein verspaetetes `EXPIRATION` nach
 * einem schon verarbeiteten `RENEWAL` wuerde ein frisch bezahltes Konto
 * abschalten. Deshalb wird ein Ereignis verworfen, das aelter ist als das
 * zuletzt verarbeitete. Ein doppelt geliefertes Ereignis schreibt denselben
 * Stand nochmal – das ist harmlos, weil hier Zustand gesetzt und nichts
 * angehaengt wird.
 */
export async function applyRevenueCatEvent(event) {
  const status = statusForEventType(event?.type);
  if (!status) return { applied: false, reason: 'event-type-ignored' };

  const userId = Number(event?.app_user_id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return { applied: false, reason: 'app-user-id-invalid' };
  }
  if (!(await first('SELECT id FROM users WHERE id = ?', [userId]))) {
    return { applied: false, reason: 'user-unknown' };
  }

  // Nur Entitlements, die es in dieser App gibt. Ein Ereignis ohne bekanntes
  // Entitlement (etwa aus einem alten Versuch) aendert nichts.
  const entitlements = (Array.isArray(event?.entitlement_ids) ? event.entitlement_ids : []).filter(
    isKnownEntitlement,
  );
  if (entitlements.length === 0) {
    return { applied: false, reason: 'no-known-entitlement' };
  }

  const eventAt = msToDateTime(event?.event_timestamp_ms);
  const expiresAt = msToDateTime(event?.expiration_at_ms);
  const provider = providerFromStore(event?.store);
  const productId = typeof event?.product_id === 'string' ? event.product_id.slice(0, 191) : null;

  for (const entitlement of entitlements) {
    await pool.query(
      `INSERT INTO subscriptions
         (user_id, entitlement, provider, product_id, status, expires_at, event_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
       ON DUPLICATE KEY UPDATE
         provider   = IF(VALUES(event_at) IS NULL OR event_at IS NULL OR VALUES(event_at) >= event_at, VALUES(provider),   provider),
         product_id = IF(VALUES(event_at) IS NULL OR event_at IS NULL OR VALUES(event_at) >= event_at, VALUES(product_id), product_id),
         status     = IF(VALUES(event_at) IS NULL OR event_at IS NULL OR VALUES(event_at) >= event_at, VALUES(status),     status),
         expires_at = IF(VALUES(event_at) IS NULL OR event_at IS NULL OR VALUES(event_at) >= event_at, VALUES(expires_at), expires_at),
         event_at   = IF(VALUES(event_at) IS NULL OR event_at IS NULL OR VALUES(event_at) >= event_at, VALUES(event_at),   event_at),
         updated_at = NOW()`,
      [userId, entitlement, provider, productId, status, expiresAt, eventAt],
    );
  }

  const tier = await recomputeAccountType(userId);
  return { applied: true, userId, entitlements, status, tier };
}
