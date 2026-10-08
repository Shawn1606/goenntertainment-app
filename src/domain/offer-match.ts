/**
 * Der Gruppen-Finder: Welche Partner-Angebote passen zu UNS?
 *
 * Man sagt, wie viele man ist, wie alt die Jüngste und der Älteste sind, und
 * optional Budget, Kategorie, drinnen/draußen und Entfernung. Heraus kommt eine
 * Rangliste – jedes Angebot mit dem Preis pro Person für genau diese Gruppe und
 * mit Gründen in Klartext („Ab 6 Jahren – passt für alle").
 *
 * ## Hart oder weich
 *
 * Was eine Buchung unmöglich macht, fliegt raus: zu wenige/zu viele Personen,
 * jemand ist jünger als erlaubt, falsche Kategorie, zu weit weg. Alles andere
 * kostet nur Punkte – ein Angebot, das 2 € über dem Budget liegt, ist ein
 * Vorschlag „knapp drüber" und kein leerer Bildschirm.
 *
 * Gerechnet wird in der App, weil die Liste mitlaufen soll, während man die
 * Regler verstellt. Die Angebote einer Stadt sind wenige Dutzend; das ist in
 * Millisekunden sortiert. Beim Buchen prüft der Server dieselben Grenzen noch
 * einmal.
 */
import { formatEuro, formatPercent, quoteMoney, type ClubRules } from './club.ts';

export type MatchableOffer = {
  id: number;
  kind: 'activity' | 'perk';
  price_cents: number | null;
  price_credits: number | null;
  min_people: number;
  max_people: number | null;
  min_age: number | null;
  max_age: number | null;
  interest_id: number | null;
  indoor: boolean | null;
  max_discount_percent: number | null;
  /** Angaben des Partners zur Barrierefreiheit (null/fehlt = unbekannt). */
  partner?: { wheelchair_accessible?: boolean | null; kid_friendly?: boolean | null; quiet_times?: string | null } | null;
};

/**
 * Barrierefreie Filter: Wer einen anhakt, sieht nur Partner, die das
 * ausdrücklich angegeben haben – „unbekannt" fällt dann heraus, weil darauf
 * kein Verlass ist.
 */
export type AccessNeeds = { wheelchair: boolean; quiet: boolean; kids: boolean };

export const NO_ACCESS_NEEDS: AccessNeeds = { wheelchair: false, quiet: false, kids: false };

export function meetsAccessNeeds(partner: MatchableOffer['partner'], needs: AccessNeeds | undefined): boolean {
  if (!needs) return true;
  if (needs.wheelchair && partner?.wheelchair_accessible !== true) return false;
  if (needs.kids && partner?.kid_friendly !== true) return false;
  if (needs.quiet && !partner?.quiet_times?.trim()) return false;
  return true;
}

export type Setting = 'any' | 'indoor' | 'outdoor';

export type FinderCriteria = {
  people: number;
  youngest: number | null;
  oldest: number | null;
  /** Höchstens so viel pro Person (nach Rabatt). */
  budgetPerPersonCents: number | null;
  interestIds: number[];
  setting: Setting;
  maxDistanceKm: number | null;
  /** Barrierefreie Filter – fehlt = keine. */
  access?: AccessNeeds;
};

export const DEFAULT_CRITERIA: FinderCriteria = {
  people: 4,
  youngest: null,
  oldest: null,
  budgetPerPersonCents: null,
  interestIds: [],
  setting: 'any',
  maxDistanceKm: null,
};

export type OfferMatch<T extends MatchableOffer> = {
  offer: T;
  score: number;
  /** Preis pro Person für diese Gruppe, nach Club- und Gruppenrabatt. */
  perPersonCents: number | null;
  totalCents: number | null;
  percent: number;
  /** Warum es passt – die ersten zwei stehen auf der Karte. */
  reasons: string[];
  /** Was nicht ganz passt, aber kein Ausschluss ist. */
  caveats: string[];
};

/** Liegt 10 % über dem Budget noch im Rahmen? Ja – als „knapp drüber". */
const BUDGET_TOLERANCE = 1.1;

function ageRangeText(min: number | null, max: number | null): string | null {
  if (min !== null && max !== null) return `${min}–${max} Jahre`;
  if (min !== null) return `ab ${min} Jahren`;
  if (max !== null) return `bis ${max} Jahre`;
  return null;
}

/**
 * Bewertet EIN Angebot für eine Gruppe. `null` heißt: geht nicht (harte Grenze).
 */
export function matchOffer<T extends MatchableOffer>(
  rules: ClubRules,
  offer: T,
  criteria: FinderCriteria,
  context: { plan: string | null | undefined; distanceKm: number | null },
): OfferMatch<T> | null {
  if (offer.kind !== 'activity') return null;

  const people = Math.max(1, Math.floor(criteria.people));
  if (people < offer.min_people) return null;
  if (offer.max_people !== null && people > offer.max_people) return null;
  if (criteria.youngest !== null && offer.min_age !== null && criteria.youngest < offer.min_age) return null;
  if (criteria.interestIds.length > 0 && (offer.interest_id === null || !criteria.interestIds.includes(offer.interest_id))) {
    return null;
  }
  if (criteria.setting !== 'any' && offer.indoor !== null && offer.indoor !== (criteria.setting === 'indoor')) return null;
  if (!meetsAccessNeeds(offer.partner, criteria.access)) return null;
  if (criteria.maxDistanceKm !== null && context.distanceKm !== null && context.distanceKm > criteria.maxDistanceKm) {
    return null;
  }

  const reasons: string[] = [];
  const caveats: string[] = [];
  let score = 100;

  // Alter: Wer eine Altersangabe hat UND zu allen passt, ist der beste Treffer.
  const ages = ageRangeText(offer.min_age, offer.max_age);
  if (criteria.oldest !== null && offer.max_age !== null && criteria.oldest > offer.max_age) {
    caveats.push(`Gedacht für ${ages} – die Älteren begleiten eher`);
    score -= 25;
  } else if (ages && (criteria.youngest !== null || criteria.oldest !== null)) {
    reasons.push(`${ages[0].toUpperCase()}${ages.slice(1)} – passt für alle`);
    score += 10;
  }

  // Preis für genau diese Gruppe.
  let perPersonCents: number | null = null;
  let totalCents: number | null = null;
  let percent = 0;
  if (offer.price_cents !== null) {
    const quote = quoteMoney(rules, {
      plan: context.plan,
      people,
      unitPriceCents: offer.price_cents,
      maxDiscountPercent: offer.max_discount_percent,
    });
    percent = quote.percent;
    totalCents = quote.totalCents;
    perPersonCents = Math.round(quote.totalCents / people);
    if (quote.percent > 0) {
      reasons.push(`Ihr spart ${formatPercent(quote.percent)}`);
      score += quote.percent;
    }
    if (criteria.budgetPerPersonCents !== null) {
      if (perPersonCents > criteria.budgetPerPersonCents * BUDGET_TOLERANCE) return null;
      if (perPersonCents > criteria.budgetPerPersonCents) {
        caveats.push(`Knapp über dem Budget (${formatEuro(perPersonCents)} p. P.)`);
        score -= 20;
      } else {
        reasons.push('Im Budget');
        score += 10;
      }
    }
  } else if (offer.price_credits !== null) {
    reasons.push('Nur mit Credits');
  }

  // Gruppengröße: In der Spanne des Angebots ist gut; genau am Rand ist okay.
  if (offer.max_people !== null) {
    reasons.push(offer.min_people > 1 ? `Für ${offer.min_people}–${offer.max_people} Personen` : `Bis ${offer.max_people} Personen`);
  } else if (offer.min_people > 1) {
    reasons.push(`Ab ${offer.min_people} Personen`);
  }

  if (criteria.setting !== 'any' && offer.indoor === null) {
    caveats.push('Drinnen oder draußen? Steht beim Partner');
    score -= 5;
  } else if (offer.indoor !== null) {
    score += criteria.setting === 'any' ? 0 : 5;
  }

  // Nähe: bis 10 km kaum ein Unterschied, danach zählt jeder Kilometer.
  if (context.distanceKm !== null) {
    score -= Math.max(0, context.distanceKm - 2) * 1.5;
    if (context.distanceKm <= 2) reasons.push('Ganz in der Nähe');
  }

  return { offer, score, perPersonCents, totalCents, percent, reasons, caveats };
}

/** Alle passenden Angebote, bestes zuerst. Bei Gleichstand das günstigere. */
export function rankOffers<T extends MatchableOffer>(
  rules: ClubRules,
  offers: T[],
  criteria: FinderCriteria,
  context: { plan: string | null | undefined; distanceById?: Map<number, number> },
): OfferMatch<T>[] {
  const matches: OfferMatch<T>[] = [];
  for (const offer of offers) {
    const match = matchOffer(rules, offer, criteria, {
      plan: context.plan,
      distanceKm: context.distanceById?.get(offer.id) ?? null,
    });
    if (match) matches.push(match);
  }
  return matches.sort(
    (a, b) =>
      b.score - a.score ||
      (a.perPersonCents ?? Number.MAX_SAFE_INTEGER) - (b.perPersonCents ?? Number.MAX_SAFE_INTEGER) ||
      a.offer.id - b.offer.id,
  );
}

/** Stimmen die Altersangaben? Jüngste nicht älter als Älteste, alles plausibel. */
export function normalizeAges(youngest: number | null, oldest: number | null): { youngest: number | null; oldest: number | null } {
  const clamp = (v: number | null) => (v === null ? null : Math.min(99, Math.max(0, Math.floor(v))));
  const y = clamp(youngest);
  const o = clamp(oldest);
  if (y !== null && o !== null && y > o) return { youngest: o, oldest: y };
  return { youngest: y, oldest: o };
}
