/**
 * Monat oder Jahr: derselbe Zugang, zwei Zahlungsrhythmen – reine Datenlogik.
 *
 * ## Warum das ein eigener Begriff ist und keine zweite Stufenleiter
 *
 * Ein Jahresabo schaltet NICHTS anderes frei als das Monatsabo derselben Stufe.
 * Es wäre also falsch, „Creator jährlich" als fünfte Kontostufe zu führen: Die
 * Rechte in {@link ./account.ts} hingen dann doppelt in der Leiter, und
 * {@link ./subscription.ts} müsste zwei Entitlements auf dieselbe Stufe
 * abbilden. Stattdessen ist der Zeitraum eine eigene, kleine Achse quer zur
 * Leiter – die Stufe sagt, WAS man bekommt, der Zeitraum, WIE man zahlt.
 *
 * Genau dieselbe Trennung machen die Stores: Apple und Google verkaufen je
 * Stufe zwei Produkte (`goenn.creator.monthly`, `goenn.creator.yearly`), beide
 * hängen bei RevenueCat am Entitlement `creator`. Für den Server ist damit
 * nichts Neues zu tun; er sieht weiter nur die Stufe.
 *
 * ## Was hier gerechnet wird – und in welche Richtung gerundet
 *
 * Jede Zahl, die dem Jahresabo einen Vorteil nachsagt, wird aus den beiden
 * Preisen in `ACCOUNT_TIERS` abgeleitet und nie daneben geschrieben. Sonst steht
 * irgendwann „2 Monate gratis" an einem Preis, der keine zwei Monate spart.
 *
 * Gerundet wird konsequent GEGEN das eigene Angebot:
 *   - der Monats-Vergleichspreis nach OBEN (`Math.ceil`), damit zwölf davon
 *     nicht weniger ergeben als der Jahrespreis wirklich kostet,
 *   - der Nachlass nach UNTEN (`Math.floor`), damit die Prozentzahl unter dem
 *     tatsächlichen Vorteil bleibt statt darüber.
 * Beides ist die Richtung, in der ein Rundungsfehler niemandem etwas verspricht.
 *
 * ## Der angezeigte Preis, sobald wirklich gekauft wird
 *
 * Solange Stufen über eine Anfrage vergeben werden (siehe `src/app/upgrade.tsx`),
 * sind die Preise hier das, was in der App steht. Sobald der In-App-Kauf läuft,
 * gilt die Regel aus `ACCOUNT_TIERS.monthlyPriceCents`: Angezeigt werden MUSS
 * der Preis, den der Store für Land und Währung meldet – dann liefern diese
 * Funktionen nur noch den Aufbau der Zeile, und die Zahlen kommen aus dem
 * RevenueCat-Package.
 *
 * Der Server kennt von diesem Modul nur die zwei Namen (`BILLING_PERIODS` in
 * `server/src/subscriptions.js`): Er speichert, was angefragt wurde, rechnet
 * aber nie mit Preisen – Geld zieht der Store ein, nicht wir.
 */

import { formatPriceCents, tierFor } from './account.ts';

/** Die zwei Rhythmen. Mehr sind es absichtlich nicht (kein Wochen-, kein Lebenszeit-Abo). */
export type BillingPeriod = 'monthly' | 'yearly';

export type BillingPeriodOption = {
  period: BillingPeriod;
  /** Überschrift im Umschalter. */
  label: string;
  /** Der Zeitraum als Nachsatz an einem Preis: „7,99 € / **Monat**". */
  unit: string;
  /**
   * Dasselbe klein und im Satz: „Business **jährlich** angefragt".
   *
   * Als eigenes Feld und nicht per `toLowerCase()` aus `label`: Das ist zwar im
   * Deutschen dasselbe Wort, aber die Kleinschreibung einer Überschrift ist eine
   * Annahme über Sprache, die in der ersten übersetzten Fassung nicht mehr
   * stimmt.
   */
  adverb: string;
};

/**
 * Beide Möglichkeiten in der Reihenfolge, in der sie im Umschalter stehen:
 * das Monatsabo links, weil es die kleinere Verpflichtung ist.
 */
export const BILLING_PERIODS: readonly BillingPeriodOption[] = [
  { period: 'monthly', label: 'Monatlich', unit: 'Monat', adverb: 'monatlich' },
  { period: 'yearly', label: 'Jährlich', unit: 'Jahr', adverb: 'jährlich' },
] as const;

/**
 * Was im Upgrade-Bildschirm **vorausgewählt** ist.
 *
 * Das Jahresabo – und das ist eine Anzeige-Entscheidung, kein Rückfallwert:
 * Es ist das günstigere Angebot, und wer es nicht will, sieht den Monatspreis
 * daneben stehen und tippt einmal. Umgekehrt (Monat vorausgewählt) zahlen
 * Leute, die gern jährlich gezahlt hätten, still zwei Monate mehr.
 *
 * Nicht zu verwechseln mit dem Rückfall in {@link normalizeBillingPeriod}: Der
 * geht in die andere Richtung, aus dem umgekehrten Grund.
 */
export const DEFAULT_BILLING_PERIOD: BillingPeriod = 'yearly';

/**
 * Einen gespeicherten oder empfangenen Wert einlesen.
 *
 * Rückfall ist **'monthly'**, nicht der vorausgewählte Jahresrhythmus: Hier
 * kommen Werte aus der Datenbank und aus dem Netz an, und was davon
 * unverständlich ist, darf niemanden auf ein Jahr festlegen. Im Zweifel die
 * kleinere Verpflichtung – dieselbe Richtung wie bei den Rechten in
 * {@link ./account.ts}, wo Unbekanntes auf die kleinste Stufe fällt.
 */
export function normalizeBillingPeriod(raw: string | null | undefined): BillingPeriod {
  return raw === 'yearly' ? 'yearly' : 'monthly';
}

/** Die Beschreibung eines Zeitraums (für Beschriftungen). */
export function billingPeriodOption(period: BillingPeriod): BillingPeriodOption {
  // Non-null: `period` ist auf die zwei Werte in BILLING_PERIODS eingeschränkt.
  return BILLING_PERIODS.find((option) => option.period === period)!;
}

/** Anzeigename eines Zeitraums: „Monatlich" / „Jährlich". */
export function billingPeriodLabel(period: BillingPeriod): string {
  return billingPeriodOption(period).label;
}

/** Derselbe Zeitraum im Satz: „Business **jährlich** angefragt". */
export function billingPeriodAdverb(period: BillingPeriod): string {
  return billingPeriodOption(period).adverb;
}

/** Was eine Stufe in diesem Rhythmus kostet, in Cent. `0` = gibt es nicht. */
export function priceCentsFor(
  tierRaw: string | null | undefined,
  period: BillingPeriod,
): number {
  const tier = tierFor(tierRaw);
  return period === 'yearly' ? tier.yearlyPriceCents : tier.monthlyPriceCents;
}

/**
 * Welche Rhythmen es für eine Stufe **wirklich** gibt.
 *
 * Ein Preis von `0` heißt „nicht im Angebot" – bei Standard sind das beide
 * (kostet nichts, also kauft man nichts), bei einer Stufe ohne Jahresabo nur
 * der eine. Der Umschalter im Upgrade-Bildschirm baut sich daraus und
 * verschwindet von selbst, wenn nur ein Rhythmus übrig ist. Eine Auswahl mit
 * einer Möglichkeit ist keine Auswahl, sondern eine Fläche, die nichts tut.
 */
export function periodsFor(tierRaw: string | null | undefined): readonly BillingPeriodOption[] {
  return BILLING_PERIODS.filter((option) => priceCentsFor(tierRaw, option.period) > 0);
}

/** Gibt es für diese Stufe ein Jahresabo? */
export function hasYearlyPlan(tierRaw: string | null | undefined): boolean {
  return priceCentsFor(tierRaw, 'yearly') > 0;
}

/**
 * Der Preis als Zeile: `„79,90 € / Jahr"`.
 *
 * Ohne Preis steht **„kostenlos"** und nicht „0,00 € / Jahr" – dieselbe
 * Entscheidung wie beim Monatstext, den dieses Modul aus `account.ts`
 * übernommen hat: Eine Null im Preis liest sich wie ein Anzeigefehler.
 */
export function priceLabel(tierRaw: string | null | undefined, period: BillingPeriod): string {
  const cents = priceCentsFor(tierRaw, period);
  if (cents === 0) return 'kostenlos';
  return `${formatPriceCents(cents)} / ${billingPeriodOption(period).unit}`;
}

/**
 * Der Jahrespreis auf den Monat gerechnet, in Cent – **aufgerundet**.
 *
 * `7990 / 12` sind 665,83 Cent. Abgerundet stünde „6,65 € pro Monat" an einem
 * Abo, das aufs Jahr 79,80 € kostete – zehn Cent weniger, als es kostet. Also
 * nach oben: „6,66 € pro Monat" ist ein Cent zu viel und damit die Richtung,
 * in der die Zeile nichts verspricht.
 *
 * `0`, wenn es kein Jahresabo gibt.
 */
export function monthlyEquivalentCents(tierRaw: string | null | undefined): number {
  const yearly = priceCentsFor(tierRaw, 'yearly');
  return yearly === 0 ? 0 : Math.ceil(yearly / 12);
}

/**
 * Der Nachsatz unter dem Jahrespreis: `„entspricht 6,66 € pro Monat"`.
 *
 * `null` ohne Jahresabo – dann hat der Satz keinen Gegenstand.
 */
export function monthlyEquivalentLabel(tierRaw: string | null | undefined): string | null {
  const cents = monthlyEquivalentCents(tierRaw);
  return cents === 0 ? null : `entspricht ${formatPriceCents(cents)} pro Monat`;
}

/** Was das Jahresabo gegenüber zwölf Monatsbeiträgen spart, in Cent. */
export function savedCentsPerYear(tierRaw: string | null | undefined): number {
  const monthly = priceCentsFor(tierRaw, 'monthly');
  const yearly = priceCentsFor(tierRaw, 'yearly');
  if (monthly === 0 || yearly === 0) return 0;
  return Math.max(0, monthly * 12 - yearly);
}

/**
 * Wie viele Monatsbeiträge das Jahresabo spart – nur **ganze** Monate.
 *
 * Abgerundet, weil daraus die Zusage „2 Monate gratis" wird: Bei 1,9
 * gesparten Monatsbeiträgen wären „2 Monate" ein Zehntel zu viel versprochen.
 */
export function freeMonths(tierRaw: string | null | undefined): number {
  const monthly = priceCentsFor(tierRaw, 'monthly');
  if (monthly === 0) return 0;
  return Math.floor(savedCentsPerYear(tierRaw) / monthly);
}

/** Der Nachlass in Prozent, **abgerundet** (16,7 % werden zu 16 %). */
export function savingsPercent(tierRaw: string | null | undefined): number {
  const monthly = priceCentsFor(tierRaw, 'monthly');
  if (monthly === 0 || savedCentsPerYear(tierRaw) === 0) return 0;
  return Math.floor((savedCentsPerYear(tierRaw) / (monthly * 12)) * 100);
}

/**
 * Das Etikett am Jahresabo: `„2 Monate gratis"`, sonst `„16 % günstiger"`.
 *
 * Ganze Monate zuerst, weil „2 Monate gratis" die anschaulichere Aussage ist:
 * Man kann sie nachrechnen, ohne Prozente umzurechnen. Reicht es nicht für
 * einen ganzen Monat, tritt die Prozentzahl ein. Spart der Jahrespreis nichts,
 * gibt es `null` – und der Umschalter zeigt dann eben kein Etikett, statt „0 %
 * günstiger" zu behaupten.
 */
export function savingsLabel(tierRaw: string | null | undefined): string | null {
  const months = freeMonths(tierRaw);
  if (months >= 1) return `${months} ${months === 1 ? 'Monat' : 'Monate'} gratis`;
  const percent = savingsPercent(tierRaw);
  return percent >= 1 ? `${percent} % günstiger` : null;
}
