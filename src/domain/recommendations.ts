/**
 * Persönliche Empfehlungen (Ticket #9) – reine Bewertungslogik.
 *
 * Eine Aktivität bekommt Punkte aus vier Quellen. Jede ist einzeln testbar und
 * einzeln austauschbar, ohne dass die Oberfläche etwas davon merkt:
 *   1. Passt sie zu meinen gewählten Interessen?      (stärkster Faktor)
 *   2. Passt sie zu dem, wo ich schon dabei war?      (Verlauf, schwächer)
 *   3. Wie weit ist sie weg?
 *   4. Wie bald ist sie – und ist überhaupt noch Platz?
 */

export type RecommendableActivity = {
  id: number;
  title: string;
  starts_at: string | null;
  interests: { id: number; name: string }[];
  participants_count: number;
  max_participants: number | null;
  /**
   * Bis wann das Event hervorgehoben ist (von einem Business-Konto gesetzt).
   * Optional, damit älteres Serverdaten-Material ohne das Feld weiter passt.
   */
  boosted_until?: string | null;
};

export type RecommendationProfile = {
  /** Im Profil gewählte Interessen. */
  interestIds: number[];
  /** Kategorien aus Events, bei denen man schon dabei war. */
  attendedInterestIds: number[];
};

export type ScoreContext = {
  now: Date;
  /** Entfernung in km, falls bekannt. */
  distanceKm?: number | null;
};

/** Gewichte an einer Stelle – so lässt sich die Empfehlung nachjustieren. */
export const WEIGHTS = {
  chosenInterest: 40,
  historyInterest: 15,
  /** Grundwert, den jedes künftige Event bekommt. */
  base: 10,
  /** Maximaler Bonus für „ganz in der Nähe". */
  proximity: 30,
  /** Maximaler Bonus für „findet bald statt". */
  soon: 20,
  /** Abzug für ein ausgebuchtes Event. */
  fullPenalty: 25,
  /**
   * Schub für ein hervorgehobenes Event (Business-Stufen, siehe
   * server/src/routes/business.js). Bewusst kleiner als ein Treffer bei den
   * eigenen Interessen: Wer Musik gewählt hat, soll Musik oben sehen – und
   * nicht das beworbene Event. Reichweite kaufen heißt hier „weiter vorne",
   * nicht „vor allem anderen".
   */
  boosted: 25,
} as const;

/** Ab dieser Entfernung gibt es keinen Näher-Bonus mehr. */
const MAX_BONUS_DISTANCE_KM = 25;
/** Ab so vielen Tagen in der Zukunft gibt es keinen Bald-Bonus mehr. */
const MAX_BONUS_DAYS = 14;

function isFull(activity: RecommendableActivity): boolean {
  return activity.max_participants !== null && activity.participants_count >= activity.max_participants;
}

/**
 * Ist die Hervorhebung gerade aktiv? Ein abgelaufenes `boosted_until` zählt
 * nicht mehr – der Server räumt es nicht weg, die Zeit entscheidet.
 */
export function isBoosted(activity: { boosted_until?: string | null }, now: Date): boolean {
  if (!activity.boosted_until) return false;
  const until = new Date(activity.boosted_until).getTime();
  return Number.isFinite(until) && until > now.getTime();
}

/**
 * Wertung einer Aktivität für ein Profil. Vergangene Events erhalten 0 –
 * sie sollen nie empfohlen werden.
 */
export function scoreActivity(
  activity: RecommendableActivity,
  profile: RecommendationProfile,
  context: ScoreContext,
): number {
  const startsAt = activity.starts_at ? new Date(activity.starts_at).getTime() : null;
  if (startsAt !== null && Number.isFinite(startsAt) && startsAt < context.now.getTime()) {
    return 0;
  }

  const chosen = new Set(profile.interestIds);
  const history = new Set(profile.attendedInterestIds);

  let score = WEIGHTS.base;

  for (const interest of activity.interests) {
    if (chosen.has(interest.id)) score += WEIGHTS.chosenInterest;
    else if (history.has(interest.id)) score += WEIGHTS.historyInterest;
  }

  const distance = context.distanceKm;
  if (distance !== null && distance !== undefined && Number.isFinite(distance)) {
    const closeness = Math.max(0, 1 - distance / MAX_BONUS_DISTANCE_KM);
    score += closeness * WEIGHTS.proximity;
  }

  if (startsAt !== null && Number.isFinite(startsAt)) {
    const days = (startsAt - context.now.getTime()) / (24 * 60 * 60 * 1000);
    const soonness = Math.max(0, 1 - days / MAX_BONUS_DAYS);
    score += soonness * WEIGHTS.soon;
  }

  if (isBoosted(activity, context.now)) score += WEIGHTS.boosted;

  if (isFull(activity)) score -= WEIGHTS.fullPenalty;

  return Math.max(0, score);
}

/**
 * Sortiert absteigend nach Wertung und entfernt vergangene Events.
 * Stabil: bei gleicher Wertung bleibt die ursprüngliche Reihenfolge erhalten.
 */
export function rankActivities<T extends RecommendableActivity>(
  activities: readonly T[],
  profile: RecommendationProfile,
  context: ScoreContext & { distanceById?: Map<number, number> },
): T[] {
  return activities
    .map((activity, index) => ({
      activity,
      index,
      score: scoreActivity(activity, profile, {
        now: context.now,
        distanceKm: context.distanceById?.get(activity.id) ?? context.distanceKm ?? null,
      }),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.activity);
}

/**
 * Kurzer Grund für die Empfehlung („Passt zu Musik") – oder null, wenn die
 * Aktivität nur allgemein vorgeschlagen wird. Ehrlichkeit schlägt Werbetext:
 * ohne echten Treffer behaupten wir keinen.
 */
export function explainMatch(
  activity: RecommendableActivity,
  profile: RecommendationProfile,
): string | null {
  const chosen = new Set(profile.interestIds);
  const history = new Set(profile.attendedInterestIds);

  const direct = activity.interests.find((i) => chosen.has(i.id));
  if (direct) return `Passt zu ${direct.name}`;

  const fromHistory = activity.interests.find((i) => history.has(i.id));
  if (fromHistory) return `Warst schon bei ${fromHistory.name} dabei`;

  return null;
}
