/**
 * Was die Startseite aus der Angebotsliste macht: Kategorien, Top-Angebote, in
 * der Nähe, mit Credits, Partner.
 *
 * Reine Funktion statt fünf `useMemo` im Screen: Die Regeln sind so testbar, und
 * der React Compiler merkt sich das Ergebnis ohnehin.
 */

type OfferLike = {
  id: number;
  kind: 'activity' | 'perk';
  interest_id: number | null;
  price_credits: number | null;
  is_featured: boolean;
  partner: { id: number; interest_id: number | null } | null;
};

/** So viele Karten stehen höchstens in einer Leiste. */
export const RAIL_LIMIT = 12;

export function offerCategory(offer: OfferLike): number | null {
  return offer.interest_id ?? offer.partner?.interest_id ?? null;
}

export type HomeSections<T extends OfferLike> = {
  /** Kategorien, in denen es wirklich Angebote gibt (IDs). */
  categoryIds: Set<number>;
  featured: T[];
  nearby: T[];
  withCredits: T[];
  partners: NonNullable<T['partner']>[];
};

export function homeSections<T extends OfferLike>(
  offers: T[],
  options: { category: number | null; distanceById: Map<number, number> },
): HomeSections<T> {
  const { category, distanceById } = options;
  const inCategory = (o: T) => category === null || offerCategory(o) === category;
  const visible = offers.filter(inCategory);

  const categoryIds = new Set<number>();
  for (const o of offers) {
    const c = offerCategory(o);
    if (c !== null) categoryIds.add(c);
  }

  // Hervorgehobene zuerst, sonst bleibt die Reihenfolge des Servers.
  const featured = visible
    .filter((o) => o.kind === 'activity')
    .map((o, index) => ({ o, index }))
    .sort((a, b) => Number(b.o.is_featured) - Number(a.o.is_featured) || a.index - b.index)
    .map(({ o }) => o)
    .slice(0, RAIL_LIMIT);

  const nearby = visible
    .filter((o) => distanceById.has(o.id))
    .sort((a, b) => (distanceById.get(a.id) ?? 0) - (distanceById.get(b.id) ?? 0))
    .slice(0, RAIL_LIMIT);

  // Vorteile (Freigetränk) zuerst – das ist, wofür man Credits sammelt – dann günstig nach teuer.
  const withCredits = visible
    .filter((o) => o.price_credits !== null)
    .sort((a, b) => Number(b.kind === 'perk') - Number(a.kind === 'perk') || (a.price_credits ?? 0) - (b.price_credits ?? 0))
    .slice(0, RAIL_LIMIT);

  const partners = new Map<number, NonNullable<T['partner']>>();
  for (const o of offers) {
    if (o.partner && !partners.has(o.partner.id)) partners.set(o.partner.id, o.partner as NonNullable<T['partner']>);
  }

  return { categoryIds, featured, nearby, withCredits, partners: [...partners.values()] };
}
