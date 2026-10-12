/**
 * Die Club-Stufen im Überblick – was die Club-Seite neben den Stufen-Karten zeigt
 * (Nutzerwunsch Okt. 2026: „die Pläne ausbauen, dass man einen größeren
 * Überblick hat").
 *
 *  - **Vergleich:** eine Tabelle, Zeile für Zeile, was jede Stufe bringt.
 *  - **Beispiel-Ausflug:** was ein Ausflug mit X Leuten zu Y € pro Person in
 *    jeder Stufe kostet – „zu sechst sparst du 12 %" wird so greifbar.
 *  - **Häufige Fragen:** Kündigen, Wechseln, Jahresabo, Verfall.
 *
 * Alle Zahlen kommen aus den Regeln (shared/club.json) und werden mit den
 * Funktionen aus club.ts gerechnet – hier steht keine Zahl doppelt. Ändert der
 * Betreiber einen Wert, stimmt die Übersicht von selbst.
 *
 * Reine Funktionen, kein React – damit Tests die Texte festhalten.
 */
import {
  PLAN_KEYS,
  creditValidityLabel,
  discountFor,
  formatCredits,
  formatEuro,
  formatPercent,
  periodPriceCents,
  planFor,
  quoteMoney,
  stampRewardFor,
  yearlySavingsCents,
  type ClubRules,
  type PlanKey,
} from './club.ts';

/** Eine Zelle der Vergleichstabelle. */
export type ComparisonCell = {
  /** Was in der Zelle steht – „–", wenn die Stufe das nicht hat. */
  text: string;
  /** Der beste Wert der Zeile (hervorgehoben). Nur, wenn sich die Stufen unterscheiden. */
  best: boolean;
};

export type ComparisonRow = {
  key: string;
  label: string;
  /** Kleingedrucktes unter der Zeile. */
  hint?: string;
  cells: Record<PlanKey, ComparisonCell>;
};

const DASH = '–';

/**
 * Baut eine Zeile aus Zahlen: `format` macht den Text, 0 wird zum Strich, und
 * die größte Zahl gilt als „bester Wert" – aber nur, wenn nicht alle gleich sind.
 * Preiszeilen (`plain`) heben nichts hervor: Beim Preis gibt es kein „besser",
 * nur „mehr Leistung für mehr Geld".
 */
function numericRow(
  key: string,
  label: string,
  value: (plan: PlanKey) => number,
  format: (value: number, plan: PlanKey) => string,
  options: { hint?: string; zeroText?: string; plain?: boolean } = {},
): ComparisonRow {
  const values = PLAN_KEYS.map((plan) => value(plan));
  const allSame = values.every((v) => v === values[0]);
  const top = Math.max(...values);
  const cells = {} as Record<PlanKey, ComparisonCell>;
  PLAN_KEYS.forEach((plan, i) => {
    const v = values[i];
    cells[plan] = {
      text: v === 0 ? (options.zeroText ?? DASH) : format(v, plan),
      best: !options.plain && !allSame && v === top && v !== 0,
    };
  });
  return { key, label, hint: options.hint, cells };
}

/** Wie lange Credits gelten, in Tagen – zum Vergleichen (ein Monat ≈ 30 Tage). */
function validityDays(rules: ClubRules, plan: PlanKey): number {
  const v = planFor(rules, plan).creditValidity ?? { days: 365 };
  return v.months ? v.months * 30 : (v.days ?? 365);
}

/** Die Vergleichstabelle: Zeile für Zeile, was jede Stufe bringt. */
export function planComparison(rules: ClubRules): ComparisonRow[] {
  const first = rules.groupDiscount.tiers[0];
  const maxPeople = rules.groupDiscount.tiers.at(-1)?.minPeople ?? 10;
  const groupLow = (plan: PlanKey) => (first ? (first.percent[plan] ?? 0) : 0);
  const groupHigh = (plan: PlanKey) => Math.max(0, ...rules.groupDiscount.tiers.map((t) => t.percent[plan] ?? 0));
  const golden = rules.stampCard.goldenEvery;

  return [
    numericRow('price', 'Preis im Monat', (p) => planFor(rules, p).priceCents, (v) => formatEuro(v), { zeroText: 'Kostenlos', plain: true }),
    numericRow('yearly', 'Jahresabo', (p) => (planFor(rules, p).priceCents > 0 ? periodPriceCents(rules, p, 'year') : 0), (v) => formatEuro(v), {
      hint: '2 Monate gratis',
      plain: true,
    }),
    numericRow('discount', 'Rabatt auf Angebote', (p) => planFor(rules, p).discountPercent, (v) => formatPercent(v)),
    {
      key: 'group',
      label: 'Gruppenrabatt',
      hint: first ? `ab ${first.minPeople} Personen` : undefined,
      cells: Object.fromEntries(
        PLAN_KEYS.map((p) => [p, { text: groupHigh(p) > 0 ? `${formatPercent(groupLow(p)).replace(' %', '')}–${formatPercent(groupHigh(p))}` : DASH, best: false }]),
      ) as Record<PlanKey, ComparisonCell>,
    },
    numericRow('max', 'Rabatt höchstens', (p) => discountFor(rules, p, maxPeople).percent, (v) => formatPercent(v), { hint: `ab ${maxPeople} Personen` }),
    numericRow('credits', 'Credits jeden Monat', (p) => planFor(rules, p).monthlyCredits, (v) => formatCredits(v)),
    numericRow('stamp', 'Volle Stempelkarte', (p) => stampRewardFor(rules, p, 1), (v) => `${formatCredits(v)} Credits`),
    numericRow('golden', `Jede ${golden}. Karte golden`, (p) => stampRewardFor(rules, p, golden), (v) => `${formatCredits(v)} Credits`),
    numericRow('validity', 'Credits gültig', (p) => validityDays(rules, p), (_v, p) => creditValidityLabel(rules, p)),
  ];
}

/** Ein Ausflug in einer Stufe: was er kostet und was man spart. */
export type ExampleQuote = {
  plan: PlanKey;
  name: string;
  percent: number;
  /** Der Deckel greift – mehr Leute sparen dann nicht mehr. */
  capped: boolean;
  totalCents: number;
  savedCents: number;
  perPersonCents: number;
};

/**
 * Was ein Ausflug mit `people` Personen zu `unitPriceCents` pro Person in jeder
 * Stufe kostet. Gerechnet wie beim Buchen (`quoteMoney`); ohne Deckel des
 * einzelnen Angebots, also mit dem allgemeinen.
 */
export function bookingExample(rules: ClubRules, people: number, unitPriceCents: number): ExampleQuote[] {
  const unit = Math.max(0, Math.round(Number.isFinite(unitPriceCents) ? unitPriceCents : 0));
  const count = Math.max(1, Math.floor(Number.isFinite(people) ? people : 1));
  return PLAN_KEYS.map((plan) => {
    const quote = quoteMoney(rules, { plan, people: count, unitPriceCents: unit });
    return {
      plan,
      name: planFor(rules, plan).name,
      percent: quote.percent,
      capped: quote.capped,
      totalCents: quote.totalCents,
      savedCents: quote.discountCents,
      perPersonCents: Math.round(quote.totalCents / count),
    };
  });
}

/** Eine häufige Frage mit Antwort. */
export type PlanQuestion = { q: string; a: string };

/** Die häufigen Fragen zum Club – die Zahlen darin kommen aus den Regeln. */
export function planFaq(rules: ClubRules): PlanQuestion[] {
  const paid = rules.plans.filter((p) => p.priceCents > 0);
  const savings = paid.map((p) => `${p.name.replace(' Plan', '')} ${formatEuro(yearlySavingsCents(rules, p.key))}`).join(', ');
  const validity = rules.plans.map((p) => `${p.name.replace(' Plan', '')} ${creditValidityLabel(rules, p.key)}`).join(', ');
  const stamp = rules.stampCard;
  return [
    {
      q: 'Kann ich jederzeit kündigen?',
      a: 'Ja. Du kündigst zum Ende der laufenden Laufzeit; bis dahin behältst du alle Vorteile. Danach bist du im Free Plan – Stempel und Credits bleiben dir.',
    },
    {
      q: 'Was bringt das Jahresabo?',
      a: `Du zahlst zehn statt zwölf Monate (${savings} gespart) und bekommst die Monats-Credits trotzdem jeden Monat. Nach dem ersten Jahr läuft es monatlich weiter und ist monatlich kündbar.`,
    },
    {
      q: 'Kann ich zwischen Gold und Platinum wechseln?',
      a: 'Ja, beim Monatsabo jederzeit – der Wechsel startet sofort eine neue Laufzeit. Während eines laufenden Jahresabos geht ein Wechsel erst danach.',
    },
    {
      q: 'Wie lange gelten meine Credits?',
      a: `Das hängt an der Stufe, in der du sie bekommst: ${validity}. Wechselst du in eine höhere Stufe, gilt die längere Frist auch für deine offenen Credits. Ausgegeben werden immer zuerst die, die am frühesten verfallen.`,
    },
    {
      q: 'Wie funktioniert die Stempelkarte?',
      a: `Jeder Besuch bei einem Partner bringt einen Stempel (höchstens ${stamp.perPartnerPerDay} pro Partner und Tag). ${stamp.fields} Stempel = eine volle Karte mit Credits je nach Stufe; jede ${stamp.goldenEvery}. Karte ist golden und bringt ${formatPercent(Math.round((stamp.goldenMultiplier - 1) * 100))} mehr.`,
    },
    {
      q: 'Gilt der Rabatt auch, wenn ich mit Credits zahle?',
      a: 'Ja. Club- und Gruppenrabatt gelten für Euro- und Credit-Preise gleich – „du sparst 15 %" hängt nicht davon ab, wie du bezahlst.',
    },
  ];
}
