/**
 * Freitextsuche und Sortierung für den Finder.
 *
 * Man tippt „bowl", „escape room" oder „kletter" – gefunden wird in Titel,
 * Untertitel, Partner und Kategorie. Groß/klein, Umlaute und ß sind egal
 * („muehle" findet „Mühle"), jedes Wort muss irgendwo vorkommen.
 */

/** Kleinschreibung, ä→ae, ß→ss, übrige Akzente weg – damit Vergleiche nicht an der Schreibweise scheitern. */
export function normalizeSearch(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Passt `query` zu den Feldern? Leere Suche passt immer. */
export function matchesQuery(fields: readonly (string | null | undefined)[], query: string): boolean {
  const words = normalizeSearch(query).split(' ').filter(Boolean);
  if (words.length === 0) return true;
  const haystack = normalizeSearch(fields.filter(Boolean).join(' '));
  return words.every((word) => haystack.includes(word));
}

export type FinderSort = 'best' | 'price' | 'distance';

/** Treffer umsortieren. `best` lässt die Rangliste, wie sie ist. */
export function sortMatches<T extends { perPersonCents: number | null; offer: { id: number } }>(
  matches: readonly T[],
  sort: FinderSort,
  distanceById?: Map<number, number>,
): T[] {
  const list = matches.slice();
  if (sort === 'price') {
    list.sort((a, b) => (a.perPersonCents ?? Number.MAX_SAFE_INTEGER) - (b.perPersonCents ?? Number.MAX_SAFE_INTEGER));
  } else if (sort === 'distance' && distanceById) {
    list.sort((a, b) => (distanceById.get(a.offer.id) ?? Number.MAX_SAFE_INTEGER) - (distanceById.get(b.offer.id) ?? Number.MAX_SAFE_INTEGER));
  }
  return list;
}
