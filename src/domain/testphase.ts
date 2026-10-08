/**
 * Testphase – Ideen, die nur Admins sehen und ausprobieren: Stadt-Bingo,
 * Challenges (Monat, Woche, Saison, Gruppe, Partner), Check-in-Serie und
 * Goenni als Coach. Gerechnet wird auf dem Server (api/app/Support/TestPhase);
 * hier stehen die Typen, die Texte und was Goenni dazu sagt – ohne React,
 * damit ein Test festhält, dass der wichtigste Satz zuerst kommt.
 */
import type { Tip } from './mascot-tips.ts';

export type ChallengeType = 'monthly' | 'weekly' | 'season' | 'group' | 'partner';

export type ChallengeMetric = 'visits' | 'distinct_partners' | 'distinct_categories' | 'bookings' | 'redeemed' | 'group_bookings';

export type ChallengePeriod = 'month' | 'week' | 'range';

/** Eine Belohnung: Schlüssel zum Abholen, Zeitraum, Stand. */
export type TestphaseClaim = {
  key: string;
  period: string;
  reward: number;
  claimed: boolean;
  claimable: boolean;
  label: string;
};

export type TestphaseChallenge = {
  id: number;
  type: ChallengeType;
  title: string;
  description: string | null;
  metric: ChallengeMetric;
  target: number;
  progress: number;
  reward_credits: number;
  period: ChallengePeriod;
  period_label: string;
  starts_at: string | null;
  ends_at: string | null;
  status: 'upcoming' | 'running' | 'ended';
  partner: { id: number; name: string } | null;
  interest: { id: number; name: string } | null;
  match_text: string | null;
  offer_kind: string | null;
  /** null = alle Stufen. */
  plans: string[] | null;
  /** Darf die eigene Stufe sie spielen? */
  allowed: boolean;
  /** Geheime Challenge: zeigt Titel und Aufgabe erst, wenn geschafft (`revealed`). */
  is_secret?: boolean;
  revealed?: boolean;
  /** Challenge mit Wahl: zählt nur, wenn ausgewählt (höchstens `choice_limit` je Zeitraum). */
  is_choice?: boolean;
  chosen?: boolean;
  claim: TestphaseClaim;
};

/** Treuestufen nach Besuchen der letzten 365 Tage (auch ohne Abo). */
export type LoyaltyState = {
  visits: number;
  level: string | null;
  level_name: string | null;
  next: { key: string; name: string; visits: number } | null;
  levels: { key: string; name: string; visits: number; reward: number; claim: TestphaseClaim }[];
};

export type AlbumStamp = {
  partner_id: number;
  name: string;
  logo_url: string | null;
  /** Stempelfarbe des Partners (fest je Partner). */
  ink: string;
  visits: number;
  first_visit: string | null;
};

export type PartnerWish = {
  id: number;
  name: string;
  note: string | null;
  /** Summe der Stimmen – Platinum zählt doppelt. */
  score: number;
  voters: number;
  voted: boolean;
  mine: boolean;
  created_at: string | null;
};

export type ShareRow = {
  id: number;
  booking_id: number;
  offer_title: string;
  credits: number;
  status: 'pending' | 'paid' | 'declined';
  /** Die andere Person (wer schuldet bzw. wem man schuldet). */
  other: string;
  created_at: string | null;
};

export type ShareableBooking = {
  booking_id: number;
  offer_title: string;
  people: number;
  total_credits: number;
  share_credits: number;
  members: { id: number; name: string }[];
};

export type GroupPoll = {
  id: number;
  group_id: number;
  group_name: string;
  title: string;
  closed: boolean;
  can_close: boolean;
  members: number;
  voted: number;
  my_option_id: number | null;
  winner_option_id: number | null;
  options: { id: number; offer_id: number | null; offer_title: string; day: string | null; votes: number }[];
};

export type PartnerFeedback = {
  id: number;
  partner: string | null;
  offer_title: string | null;
  rating: number;
  comment: string | null;
  created_at: string | null;
};

export type BingoCell = {
  index: number;
  kind: 'joker' | 'partner' | 'task';
  label: string;
  hint: string;
  icon: string;
  done: boolean;
  partner_id?: number;
  logo_url?: string | null;
  task?: string;
};

export type BingoLine = { index: number; cells: number[]; done: boolean; claim: TestphaseClaim };

export type TestphaseState = {
  plan: string;
  /** Challenges mit Wahl: so viele darf man je Zeitraum wählen. */
  choice_limit?: number;
  challenges: TestphaseChallenge[];
  loyalty?: LoyaltyState;
  album?: { visited: number; total: number; stamps: AlbumStamp[] };
  wishes?: PartnerWish[];
  shares?: { shareable: ShareableBooking[]; owed_to_me: ShareRow[]; i_owe: ShareRow[] };
  polls?: GroupPoll[];
  feedback?: PartnerFeedback[];
  happy_hour?: { weekdays: number[]; percent: number };
  reserved_offers?: { id: number; title: string; partner: string | null; daily_capacity: number; platinum_reserved: number }[];
  bingo: {
    period: string;
    period_label: string;
    cells: BingoCell[];
    lines: BingoLine[];
    line_reward: number;
    full_reward: number;
    full: { done: boolean; claim: TestphaseClaim };
  };
  streak: {
    weeks: number;
    active_this_week: boolean;
    at_risk: boolean;
    joker: boolean;
    joker_used: boolean;
    start_week: string | null;
    milestones: { weeks: number; reward: number; claim: TestphaseClaim }[];
  };
  first_visit_bonus: { active: boolean };
  options: {
    partners: { id: number; name: string }[];
    interests: { id: number; name: string }[];
    types: ChallengeType[];
    metrics: ChallengeMetric[];
    groups?: { id: number; name: string }[];
    offers?: { id: number; title: string; partner: string | null }[];
  };
};

export type NewChallengeInput = {
  type: ChallengeType;
  title: string;
  description?: string | null;
  metric: ChallengeMetric;
  target: number;
  reward_credits: number;
  period: ChallengePeriod;
  starts_at?: string | null;
  ends_at?: string | null;
  partner_id?: number | null;
  interest_id?: number | null;
  match_text?: string | null;
  offer_kind?: string | null;
  plans?: string[] | null;
  is_secret?: boolean;
  is_choice?: boolean;
};

export const CHALLENGE_TYPES: readonly ChallengeType[] = ['monthly', 'weekly', 'season', 'group', 'partner'];

export const TYPE_LABEL: Record<ChallengeType, string> = {
  monthly: 'Monats-Challenges',
  weekly: 'Wochenmissionen',
  season: 'Saison-Challenges',
  group: 'Gruppen-Challenges',
  partner: 'Partner-Challenges',
};

/** Was eine neue Challenge dieser Art vorbelegt bekommt. */
export const TYPE_DEFAULTS: Record<ChallengeType, { period: ChallengePeriod; metric: ChallengeMetric }> = {
  monthly: { period: 'month', metric: 'visits' },
  weekly: { period: 'week', metric: 'visits' },
  season: { period: 'range', metric: 'visits' },
  group: { period: 'month', metric: 'group_bookings' },
  partner: { period: 'month', metric: 'visits' },
};

/** Einzahl und Mehrzahl – „1 Besuch", „3 Besuche". */
export const METRIC_UNIT: Record<ChallengeMetric, [string, string]> = {
  visits: ['Besuch', 'Besuche'],
  distinct_partners: ['verschiedener Partner', 'verschiedene Partner'],
  distinct_categories: ['Kategorie', 'Kategorien'],
  bookings: ['Buchung', 'Buchungen'],
  redeemed: ['eingelöstes Angebot', 'eingelöste Angebote'],
  group_bookings: ['Gruppenbuchung', 'Gruppenbuchungen'],
};

/** Für die Auswahl im Formular. */
export const METRIC_LABEL: Record<ChallengeMetric, string> = {
  visits: 'Besuche (Check-ins)',
  distinct_partners: 'Verschiedene Partner',
  distinct_categories: 'Verschiedene Kategorien',
  bookings: 'Buchungen',
  redeemed: 'Eingelöste Angebote',
  group_bookings: 'Gruppenbuchungen',
};

export const PERIOD_LABEL: Record<ChallengePeriod, string> = {
  month: 'Kalendermonat',
  week: 'Kalenderwoche',
  range: 'Fester Zeitraum',
};

export function unit(metric: ChallengeMetric, count: number): string {
  const [one, many] = METRIC_UNIT[metric];
  return count === 1 ? one : many;
}

/** „7 / 10 Besuche" */
export function progressText(c: Pick<TestphaseChallenge, 'metric' | 'progress' | 'target'>): string {
  return `${Math.min(c.progress, c.target)} / ${c.target} ${unit(c.metric, c.target)}`;
}

/** 0 … 1 für den Fortschrittsbalken. */
export function progressRatio(c: Pick<TestphaseChallenge, 'progress' | 'target'>): number {
  return c.target > 0 ? Math.max(0, Math.min(1, c.progress / c.target)) : 0;
}

/** Alle Belohnungen, die gerade abholbar sind. */
export function openClaims(state: TestphaseState): TestphaseClaim[] {
  return [
    ...state.challenges.map((c) => c.claim),
    ...state.bingo.lines.map((l) => l.claim),
    state.bingo.full.claim,
    ...state.streak.milestones.map((m) => m.claim),
    ...(state.loyalty?.levels.map((l) => l.claim) ?? []),
  ].filter((c) => c.claimable);
}

/**
 * Challenges, auf die Goenni hinweisen darf: spielbar, laufend, offen – und
 * weder geheim (Inhalt unbekannt) noch eine nicht gewählte Wahl-Challenge.
 */
export function coachable(c: TestphaseChallenge): boolean {
  return (
    c.allowed &&
    c.status === 'running' &&
    !c.claim.claimed &&
    c.progress < c.target &&
    (c.revealed ?? true) &&
    (!c.is_choice || !!c.chosen)
  );
}

/**
 * Goenni als Challenge-Coach: was er zu deinem Stand sagt.
 *
 * Reihenfolge = Wichtigkeit: abholbare Credits zuerst, dann eine Serie in
 * Gefahr, dann die Challenge, die am nächsten am Ziel ist, dann die fast volle
 * Bingo-Reihe, dann der nächste Serien-Meilenstein.
 */
export function coachTips(state: TestphaseState): Tip[] {
  const tips: Tip[] = [];

  const open = openClaims(state);
  if (open.length > 0) {
    const sum = open.reduce((s, c) => s + c.reward, 0);
    tips.push({ line: `Da liegen ${sum} Credits für dich bereit – hol sie dir unten ab!`, mood: 'cheer' });
  }

  if (state.streak.at_risk) {
    tips.push({
      line: `Diese Woche fehlt noch ein Check-in – sonst reißt deine Serie von ${state.streak.weeks} ${state.streak.weeks === 1 ? 'Woche' : 'Wochen'}.`,
      mood: 'oops',
    });
  }

  const running = state.challenges
    .filter(coachable)
    .sort((a, b) => progressRatio(b) - progressRatio(a) || a.target - a.progress - (b.target - b.progress));
  const closest = running[0];
  if (closest) {
    const left = closest.target - closest.progress;
    tips.push({
      line:
        closest.progress > 0
          ? `Nur noch ${left} ${unit(closest.metric, left)} bei „${closest.title}“ – dann gibt's ${closest.reward_credits} Credits!`
          : `Wie wär's mit „${closest.title}“? ${closest.target} ${unit(closest.metric, closest.target)} und ${closest.reward_credits} Credits gehören dir.`,
      mood: closest.progress > 0 ? 'happy' : 'idle',
    });
  }

  const almost = state.bingo.lines.find((l) => !l.done && l.cells.filter((i) => !state.bingo.cells[i]?.done).length === 1);
  if (almost) {
    const missing = state.bingo.cells[almost.cells.find((i) => !state.bingo.cells[i]?.done) ?? 0];
    tips.push({ line: `Ein Feld fehlt zur Bingo-Reihe: ${missing.label}. Das schaffst du!`, mood: 'happy' });
  }

  const next = state.streak.milestones.find((m) => state.streak.weeks < m.weeks);
  if (next && state.streak.weeks > 0) {
    const left = next.weeks - state.streak.weeks;
    tips.push({ line: `Noch ${left} ${left === 1 ? 'Woche' : 'Wochen'} Check-ins, dann gibt's ${next.reward} Credits Serien-Bonus.`, mood: 'idle' });
  }

  if (tips.length === 0) {
    tips.push(
      state.challenges.length === 0
        ? { line: 'Noch keine Challenges da – leg unten ein paar Beispiele an!', mood: 'thinking' }
        : { line: 'Such dir eine Challenge aus – ich feuer dich an!', mood: 'idle' },
    );
  }

  return tips;
}
