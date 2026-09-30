/**
 * Club-Rechnung: Rabatte, Credits, Stempelkarte – reine Funktionen, kein React.
 *
 * Die Zahlen stehen in `shared/club.json` und kommen hier als Parameter herein
 * (`rules`). So rechnet die App mit genau denselben Werten wie Laravel
 * (`api/app/Support/Club.php`), und `shared/club.fixtures.json` hält fest, was
 * bei beiden herauskommen muss.
 *
 * Maßgeblich ist der Server. Die App rechnet nur, damit der Preis sofort
 * mitläuft, während man die Personenzahl verstellt – abgebucht wird, was der
 * Server beim Buchen ausrechnet.
 *
 * ## Die Regel in einem Satz
 *
 *   Rabatt = Club-Rabatt + Gruppenrabatt × Club-Faktor, höchstens der Deckel
 *   des Angebots (sonst der allgemeine Deckel).
 *
 * Er gilt für Euro- UND Credit-Preise gleich, damit „du sparst 20 %" nicht davon
 * abhängt, wie man bezahlt. Euro wird kaufmännisch auf den Cent gerundet,
 * Credits werden aufgerundet – ein halber Credit geht nie zulasten des Partners.
 */

export type PlanKey = 'free' | 'gold' | 'platinum';

export type ClubPlan = {
  key: PlanKey;
  name: string;
  priceCents: number;
  discountPercent: number;
  groupBoost: number;
  monthlyCredits: number;
  perks: string[];
};

export type ClubRules = {
  currency: string;
  credits: { centsPerTenCredits: number; packs: number[] };
  plans: ClubPlan[];
  groupDiscount: { tiers: { minPeople: number; percent: number }[] };
  discountCap: { defaultPercent: number };
  stampCard: { fields: number; rewardCredits: number; perPartnerPerDay: number };
};

export const PLAN_KEYS: readonly PlanKey[] = ['free', 'gold', 'platinum'];

/** Die Stufe zu einem Schlüssel. Unbekanntes (alte Konten, Tippfehler) zählt als Free. */
export function planFor(rules: ClubRules, key: string | null | undefined): ClubPlan {
  return rules.plans.find((p) => p.key === key) ?? rules.plans[0];
}

/** Grundrabatt nach Personenzahl – ohne Club-Faktor. */
export function groupBasePercent(rules: ClubRules, people: number): number {
  let percent = 0;
  for (const tier of rules.groupDiscount.tiers) {
    if (people >= tier.minPeople && tier.percent > percent) percent = tier.percent;
  }
  return percent;
}

/**
 * Zwei Nachkommastellen, ohne das Rauschen der Fließkommazahlen.
 * 10 + 5 × 1,5 soll 17.5 sein und nicht 17.499999999.
 */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export type DiscountBreakdown = {
  /** Anteil aus der Club-Stufe. */
  clubPercent: number;
  /** Anteil aus der Gruppengröße, schon mit Club-Faktor. */
  groupPercent: number;
  /** Was tatsächlich gilt – nach dem Deckel. */
  percent: number;
  /** Hat der Deckel gegriffen? Dann lohnt „mehr Leute" nicht mehr. */
  capped: boolean;
};

export function discountFor(
  rules: ClubRules,
  planKey: string | null | undefined,
  people: number,
  maxDiscountPercent?: number | null,
): DiscountBreakdown {
  const plan = planFor(rules, planKey);
  const count = Math.max(1, Math.floor(people));
  const clubPercent = plan.discountPercent;
  const groupPercent = round2(groupBasePercent(rules, count) * plan.groupBoost);
  const cap = maxDiscountPercent ?? rules.discountCap.defaultPercent;
  const raw = round2(clubPercent + groupPercent);
  const percent = Math.max(0, Math.min(raw, cap));
  return { clubPercent, groupPercent, percent, capped: raw > cap };
}

export type MoneyQuote = DiscountBreakdown & {
  people: number;
  unitPriceCents: number;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
};

export function quoteMoney(
  rules: ClubRules,
  input: { plan: string | null | undefined; people: number; unitPriceCents: number; maxDiscountPercent?: number | null },
): MoneyQuote {
  const people = Math.max(1, Math.floor(input.people));
  const discount = discountFor(rules, input.plan, people, input.maxDiscountPercent);
  const subtotalCents = input.unitPriceCents * people;
  const discountCents = Math.round((subtotalCents * discount.percent) / 100);
  return {
    ...discount,
    people,
    unitPriceCents: input.unitPriceCents,
    subtotalCents,
    discountCents,
    totalCents: subtotalCents - discountCents,
  };
}

export type CreditQuote = DiscountBreakdown & {
  people: number;
  unitCredits: number;
  subtotalCredits: number;
  totalCredits: number;
};

export function quoteCredits(
  rules: ClubRules,
  input: { plan: string | null | undefined; people: number; unitCredits: number; maxDiscountPercent?: number | null },
): CreditQuote {
  const people = Math.max(1, Math.floor(input.people));
  const discount = discountFor(rules, input.plan, people, input.maxDiscountPercent);
  const subtotalCredits = input.unitCredits * people;
  // Das kleine Minus fängt Fließkomma-Reste ab: 208.00000001 soll 208 bleiben.
  const totalCredits = Math.ceil((subtotalCredits * (100 - discount.percent)) / 100 - 1e-9);
  return { ...discount, people, unitCredits: input.unitCredits, subtotalCredits, totalCredits };
}

/** Was ein Credit-Paket kostet: 10 Credits = `centsPerTenCredits`. */
export function packPriceCents(rules: ClubRules, credits: number): number {
  return Math.round((credits * rules.credits.centsPerTenCredits) / 10);
}

/** Was Credits beim Kaufpreis wert sind – für „entspricht 3,75 €". */
export function creditsValueCents(rules: ClubRules, credits: number): number {
  return packPriceCents(rules, credits);
}

export type StampProgress = {
  /** Gefüllte Felder der aktuellen Karte. */
  filled: number;
  /** Felder einer Karte. */
  fields: number;
  /** Wie viele Karten schon voll waren (und ausgezahlt wurden). */
  completedCards: number;
  /** Noch so viele Stempel bis zu den nächsten Credits. */
  remaining: number;
};

/**
 * Stand der Stempelkarte aus der Gesamtzahl aller Stempel.
 *
 * Eine volle Karte wird sofort ausgezahlt und fängt neu an – deshalb gibt es
 * „10 von 10" nicht als Zustand: Mit dem zehnten Stempel steht die neue Karte
 * bei 0, und die fertige zählt in `completedCards`.
 */
export function stampProgress(rules: ClubRules, total: number): StampProgress {
  const fields = rules.stampCard.fields;
  const safe = Math.max(0, Math.floor(total));
  const filled = safe % fields;
  return { filled, fields, completedCards: Math.floor(safe / fields), remaining: fields - filled };
}

/**
 * Tausenderpunkte von Hand statt `toLocaleString('de-DE')`: Hermes kennt nicht
 * auf jedem Gerät alle Sprachdaten, und dann stünde dort „1,000".
 */
function groupThousands(value: number): string {
  return String(Math.abs(Math.round(value))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** Euro-Betrag in deutscher Schreibweise: 2999 → „29,99 €". */
export function formatEuro(cents: number): string {
  const sign = cents < 0 ? '−' : '';
  const abs = Math.abs(Math.round(cents));
  const rest = String(abs % 100).padStart(2, '0');
  return `${sign}${groupThousands(Math.floor(abs / 100))},${rest} €`;
}

/** Prozent ohne überflüssige Nullen: 17.5 → „17,5 %", 20 → „20 %". */
export function formatPercent(percent: number): string {
  const text = Number.isInteger(percent) ? String(percent) : String(round2(percent)).replace('.', ',');
  return `${text} %`;
}

/** Credits mit Tausenderpunkt: 1000 → „1.000". */
export function formatCredits(credits: number): string {
  return `${credits < 0 ? '−' : ''}${groupThousands(credits)}`;
}
