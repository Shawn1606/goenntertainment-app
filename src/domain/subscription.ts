/**
 * Bezahlte Kontostufen: welche Stufe ein Abo freischaltet – reine Datenlogik.
 *
 * ## Warum „Entitlement" und nicht „Produkt"
 *
 * Ein Abo wird in zwei Läden verkauft, und beide benennen dasselbe anders: In
 * App Store Connect heißt das Creator-Abo `goenn.creator.monthly`, im Play
 * Console `goenn_creator_monthly` (Google erlaubt keine Punkte am Anfang und
 * kein Gemisch aus Gross- und Kleinschreibung). Dazu kommen später vielleicht
 * ein Jahresabo und ein Einführungspreis – wieder eigene Produkt-IDs, aber
 * dieselbe freigeschaltete Stufe.
 *
 * Deshalb rechnet der Code NICHT mit Produkt-IDs, sondern mit dem, was
 * RevenueCat daraus macht: einem **Entitlement** je Stufe. Kommt ein Jahresabo
 * dazu, wird es im RevenueCat-Dashboard demselben Entitlement zugeordnet und
 * hier ändert sich keine Zeile.
 *
 * Die Entitlement-Namen sind absichtlich WORTGLEICH mit den Kontostufen aus
 * {@link ./account.ts}. Eine Übersetzungstabelle zwischen zwei Namensschemata
 * wäre eine zweite Wahrheit, die irgendwann auseinanderläuft.
 *
 * ## Dieselbe Rechnung steht im Server
 *
 * `server/src/subscriptions.js` enthält dieselben Funktionen für die
 * Webhook-Seite. Die App entscheidet damit, was sie anzeigt; der Server
 * entscheidet, was gilt – dasselbe Verhältnis wie bei den Rechten in
 * {@link ./account.ts}.
 */

import { ACCOUNT_TIERS, normalizeAccountType, rankOf, type AccountType } from './account.ts';

/**
 * Die Stufen, die man kaufen kann – Standard fehlt, denn es kostet nichts.
 *
 * Aus `ACCOUNT_TIERS` abgeleitet und nicht abgeschrieben: Eine neue Stufe mit
 * Preis erscheint damit automatisch hier, und es kann keine bezahlte Stufe
 * geben, die diese Liste nicht kennt.
 */
export const PURCHASABLE_TIERS: readonly AccountType[] = ACCOUNT_TIERS.filter(
  (tier) => tier.monthlyPriceCents > 0,
).map((tier) => tier.type);

/**
 * Ist das ein Entitlement, das wir kennen?
 *
 * RevenueCat schickt im Webhook alles mit, was am Konto hängt – auch
 * Entitlements aus Versuchen, die es in der App nicht mehr gibt. Unbekanntes
 * wird verworfen und nicht geraten.
 */
export function isKnownEntitlement(id: string | null | undefined): boolean {
  return typeof id === 'string' && (PURCHASABLE_TIERS as readonly string[]).includes(id);
}

/**
 * Welche Stufe eine Menge aktiver Entitlements freischaltet.
 *
 * **Die höchste gewinnt.** Das ist keine Bequemlichkeit, sondern notwendig:
 *
 *   - Beim Wechsel von Creator auf Business melden Apple und Google für die
 *     Dauer der laufenden Periode beide Abos als aktiv. Wer hier das erste
 *     Element nähme, würde jemanden, der gerade mehr bezahlt hat, auf die
 *     kleinere Stufe setzen.
 *   - Dasselbe Konto kann auf dem iPhone und auf einem Android-Gerät gekauft
 *     haben. Beides ist bezahlt, also gilt das Bessere.
 *
 * Leere oder unbekannte Eingaben ergeben `'standard'` – nicht, weil das ein
 * Fehlerwert wäre, sondern weil „kein Abo" genau diese Stufe bedeutet.
 */
export function tierFromEntitlements(
  activeEntitlementIds: readonly string[] | null | undefined,
): AccountType {
  if (!activeEntitlementIds) return 'standard';
  let best: AccountType = 'standard';
  for (const id of activeEntitlementIds) {
    if (!isKnownEntitlement(id)) continue;
    if (rankOf(id) > rankOf(best)) best = id as AccountType;
  }
  return best;
}

/**
 * Die Stufe, die tatsächlich gilt: das Bessere aus Abo und Admin-Vergabe.
 *
 * ## Warum das nicht einfach das Abo sein kann
 *
 * Zwei Wege führen zu einer Stufe, und sie dürfen sich nicht überschreiben:
 * Ein Admin vergibt Stufen von Hand (Testkonten, Partner, Wiedergutmachungen),
 * und daneben gibt es das bezahlte Abo.
 *
 * Läuft ein Abo aus, meldet RevenueCat „keine Entitlements mehr". Würde der
 * Server daraufhin schlicht auf `'standard'` setzen, verlöre ein Partnerkonto,
 * das zusätzlich einen Monat Creator ausprobiert hat, mit dem Ablauf dieses
 * Monats auch seine dauerhaft vergebene Stufe. Der Fehler fiele erst auf, wenn
 * sich jemand beschwert.
 *
 * Deshalb gilt immer das Maximum. Ein Abo kann eine vergebene Stufe anheben,
 * aber niemals senken.
 */
export function effectiveTier(
  grantedType: string | null | undefined,
  subscribedType: string | null | undefined,
): AccountType {
  const granted = normalizeAccountType(grantedType);
  const subscribed = normalizeAccountType(subscribedType);
  return rankOf(subscribed) > rankOf(granted) ? subscribed : granted;
}
