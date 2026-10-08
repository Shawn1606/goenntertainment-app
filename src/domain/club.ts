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
 *   Rabatt = Club-Rabatt + Gruppenrabatt der Stufe, höchstens der Deckel
 *   des Angebots (sonst der allgemeine Deckel).
 *
 * Den Gruppenrabatt gibt es in jeder Stufe, seit 06.10.2026 überall gleich hoch
 * (Tabelle in club.json); Gold und Platinum legen ihren Club-Rabatt obendrauf.
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
  /** Jahresabo: Preis für ein Jahr (zehn Monatspreise). */
  yearlyPriceCents?: number;
  discountPercent: number;
  monthlyCredits: number;
  /** Wie lange Gutschriften in dieser Stufe gelten. */
  creditValidity: CreditValidity;
  perks: string[];
};

/** Gültigkeit einer Gutschrift: Tage ODER Monate (Verfall rechnet der Server). */
export type CreditValidity = { days?: number; months?: number };

export type ClubRules = {
  currency: string;
  credits: {
    centsPerTenCredits: number;
    packs: number[];
    packBonus?: Record<string, number>;
    /** Einmalig beim allerersten Paket: so viel Prozent der Paketgröße extra. */
    firstPurchaseBonusPercent?: number;
    refundGraceDays: number;
  };
  plans: ClubPlan[];
  groupDiscount: { tiers: GroupTier[] };
  discountCap: { defaultPercent: number };
  /** Ideen in der Testphase (nur Admins). */
  testphase?: {
    happyHour?: { weekdays: number[]; percent: Record<string, number> };
  };
  stampCard: {
    fields: number;
    rewardCreditsByPlan: Record<string, number>;
    /** Jede so-vielte volle Karte ist golden … */
    goldenEvery: number;
    /** … und bringt so viel mal mehr. */
    goldenMultiplier: number;
    perPartnerPerDay: number;
  };
};

/** Ab `minPeople` Personen gilt je Stufe dieser Gruppenrabatt (Schlüssel = plan.key). */
export type GroupTier = { minPeople: number; percent: Record<string, number> };

export const PLAN_KEYS: readonly PlanKey[] = ['free', 'gold', 'platinum'];

/** Die Stufe zu einem Schlüssel. Unbekanntes (alte Konten, Tippfehler) zählt als Free. */
export function planFor(rules: ClubRules, key: string | null | undefined): ClubPlan {
  return rules.plans.find((p) => p.key === key) ?? rules.plans[0];
}

/**
 * Gruppenrabatt einer Stufe nach Personenzahl: die höchste Zeile, deren
 * `minPeople` erreicht ist. Unbekannte Stufen rechnen wie Free.
 */
export function groupPercentFor(rules: ClubRules, planKey: string | null | undefined, people: number): number {
  const key = planFor(rules, planKey).key;
  let percent = 0;
  for (const tier of rules.groupDiscount.tiers) {
    const value = tier.percent[key] ?? 0;
    if (people >= tier.minPeople && value > percent) percent = value;
  }
  return percent;
}

/**
 * Zwei Nachkommastellen, ohne das Rauschen der Fließkommazahlen.
 * 5 + 10,5 soll 15.5 sein und nicht 15.499999999.
 */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export type DiscountBreakdown = {
  /** Anteil aus der Club-Stufe. */
  clubPercent: number;
  /** Anteil aus der Gruppengröße, mit dem Wert der Stufe. */
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
  const groupPercent = round2(groupPercentFor(rules, plan.key, count));
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

/**
 * Mengenbonus eines Pakets: gratis obendrauf, z. B. 200 + 50.
 *
 * Die App zeigt ihn immer als „200 + 50" – den Umrechnungskurs (Cent je
 * Credit) dagegen bewusst nirgends.
 */
export function packBonus(rules: ClubRules, credits: number): number {
  return Math.max(0, Math.floor(rules.credits.packBonus?.[String(credits)] ?? 0));
}

/** Was ein Paket insgesamt aufs Konto bringt: Paket + Bonus. */
export function packTotalCredits(rules: ClubRules, credits: number): number {
  return credits + packBonus(rules, credits);
}

/**
 * Erstkauf-Bonus: Beim allerersten Paket eines Kontos gibt es einmalig
 * `firstPurchaseBonusPercent` der Paketgröße dazu (ohne den Mengenbonus).
 * Ob ein Konto noch Anspruch hat, weiß nur der Server.
 */
export function firstPurchaseBonus(rules: ClubRules, credits: number): number {
  return Math.floor((credits * (rules.credits.firstPurchaseBonusPercent ?? 0)) / 100);
}

/** Wie lange Gutschriften in einer Stufe gelten. */
export function creditValidityFor(rules: ClubRules, planKey: string | null | undefined): CreditValidity {
  return planFor(rules, planKey).creditValidity ?? { days: 365 };
}

/** „365 Tage", „18 Monate" – für Texte wie „Credits gelten …". */
export function creditValidityLabel(rules: ClubRules, planKey: string | null | undefined): string {
  const v = creditValidityFor(rules, planKey);
  if (v.months) return `${v.months} ${v.months === 1 ? 'Monat' : 'Monate'}`;
  const days = v.days ?? 365;
  return `${days} ${days === 1 ? 'Tag' : 'Tage'}`;
}

/** Ist die n-te volle Karte (ab 1 gezählt) eine goldene? */
export function isGoldenCard(rules: ClubRules, cardNumber: number): boolean {
  const every = rules.stampCard.goldenEvery;
  return every > 0 && cardNumber > 0 && cardNumber % every === 0;
}

/**
 * Was die n-te volle Stempelkarte bringt: der Wert der Stufe, auf einer
 * goldenen Karte mal `goldenMultiplier` (kaufmännisch gerundet).
 */
export function stampRewardFor(rules: ClubRules, planKey: string | null | undefined, cardNumber: number): number {
  const key = planFor(rules, planKey).key;
  const base = rules.stampCard.rewardCreditsByPlan[key] ?? rules.stampCard.rewardCreditsByPlan.free ?? 0;
  return isGoldenCard(rules, cardNumber) ? Math.round(base * rules.stampCard.goldenMultiplier) : base;
}

export type ClubInterval = 'month' | 'year';

/** Preis einer Laufzeit: Monat oder Jahr. */
export function periodPriceCents(rules: ClubRules, planKey: string | null | undefined, interval: ClubInterval): number {
  const plan = planFor(rules, planKey);
  return interval === 'year' ? (plan.yearlyPriceCents ?? plan.priceCents * 12) : plan.priceCents;
}

/** Was das Jahresabo gegenüber zwölf Monatszahlungen spart. */
export function yearlySavingsCents(rules: ClubRules, planKey: string | null | undefined): number {
  const plan = planFor(rules, planKey);
  return Math.max(0, plan.priceCents * 12 - periodPriceCents(rules, planKey, 'year'));
}

/**
 * Testphase: Happy Hour – Credit-Buchungen mit Wunschtermin an ruhigen
 * Wochentagen kosten Club-Mitglieder weniger (shared/club.json). `day` ist
 * „JJJJ-MM-TT"; Wochentag nach ISO (1 = Montag … 7 = Sonntag). Dieselbe Regel
 * rechnet der Server (Club::happyHourPercent) – nur für Admins.
 */
export function happyHourPercent(rules: ClubRules, planKey: string | null | undefined, day: string | null | undefined): number {
  const happy = rules.testphase?.happyHour;
  if (!happy || !day) return 0;
  const [y, m, d] = day.split('-').map(Number);
  if (!y || !m || !d) return 0;
  const weekday = ((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7) + 1;
  if (!happy.weekdays.includes(weekday)) return 0;
  return happy.percent[planFor(rules, planKey).key] ?? 0;
}

/** Credits nach Happy Hour – aufgerundet wie beim Server. */
export function applyHappyHour(credits: number, percent: number): number {
  return percent > 0 ? Math.ceil((credits * (100 - percent)) / 100 - 1e-9) : credits;
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
