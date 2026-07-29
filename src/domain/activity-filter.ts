/**
 * Suche & Filter für Aktivitäten (Ticket #6) – reine Funktionen ohne React
 * oder Netzwerk. Die Oberfläche hält nur den Filter-Zustand; *was* ein Treffer
 * ist, entscheidet ausschließlich dieses Modul (und ist damit testbar).
 *
 * Bewusst strukturell typisiert (`FilterableActivity` fordert nur die Felder,
 * die wirklich gebraucht werden): jede Activity aus der API passt hier hinein,
 * ohne dass die Domäne die API-Typen kennen muss.
 */

export type FilterableActivity = {
  id: number;
  title: string;
  description: string;
  location: string;
  starts_at: string | null;
  interests: { id: number; name: string }[];
  participants_count: number;
  max_participants: number | null;
};

/** Zeitfenster, wie man sie im Alltag sucht. */
export type DateWindow = 'all' | 'today' | 'tomorrow' | 'week';

export type ActivityFilter = {
  /** Freitext über Titel, Beschreibung, Ort und Kategorien. */
  query: string;
  /** Kategorien; leer = alle. Mehrere Kategorien sind ODER-verknüpft. */
  interestIds: number[];
  when: DateWindow;
  /** Obergrenze in km; null = egal. */
  maxDistanceKm: number | null;
  /** Ausgebuchte Events ausblenden. */
  hideFull: boolean;
};

export type FilterContext = {
  now: Date;
  /** Bekannte Entfernungen je Activity-ID (aus der Standort-Auflösung). */
  distanceById?: Map<number, number>;
};

export const EMPTY_FILTER: ActivityFilter = {
  query: '',
  interestIds: [],
  when: 'all',
  maxDistanceKm: null,
  hideFull: false,
};

/**
 * Vergleichsform für die Suche: klein, ohne Umlaute/Akzente. So findet
 * „fussball" auch „Fußball" – der häufigste Grund für „nichts gefunden".
 */
export function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    // Kombinierende Akzente entfernen (aus ä wird a, aus é wird e).
    .replace(/[̀-ͯ]/g, '');
}

/** Wie viele Filter sind gesetzt? Steuert Badge und „Zurücksetzen"-Knopf. */
export function activeFilterCount(filter: ActivityFilter): number {
  let count = 0;
  if (filter.query.trim().length > 0) count += 1;
  if (filter.interestIds.length > 0) count += 1;
  if (filter.when !== 'all') count += 1;
  if (filter.maxDistanceKm !== null) count += 1;
  if (filter.hideFull) count += 1;
  return count;
}

export function isFilterActive(filter: ActivityFilter): boolean {
  return activeFilterCount(filter) > 0;
}

/** Beginn des Tages (lokale Zeit) als Zeitstempel. */
function startOfDay(date: Date): number {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Zeitfenster als [von, bis) in Millisekunden; null = keine Einschränkung. */
function windowFor(when: DateWindow, now: Date): [number, number] | null {
  if (when === 'all') return null;
  const day = 24 * 60 * 60 * 1000;
  const today = startOfDay(now);
  switch (when) {
    case 'today':
      return [Math.max(today, now.getTime()), today + day];
    case 'tomorrow':
      return [today + day, today + 2 * day];
    case 'week':
      return [now.getTime(), today + 7 * day];
  }
}

function matchesQuery(activity: FilterableActivity, needle: string): boolean {
  const haystack = normalize(
    [activity.title, activity.description, activity.location, activity.interests.map((i) => i.name).join(' ')].join(
      ' ',
    ),
  );
  // Mehrere Wörter müssen alle vorkommen ("yoga park" = beides).
  return normalize(needle)
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

function isFull(activity: FilterableActivity): boolean {
  return activity.max_participants !== null && activity.participants_count >= activity.max_participants;
}

/**
 * Wendet alle gesetzten Filter an (UND-verknüpft) und gibt eine neue Liste
 * zurück – die Eingabe bleibt unverändert.
 */
export function filterActivities<T extends FilterableActivity>(
  activities: readonly T[],
  filter: ActivityFilter,
  context: FilterContext,
): T[] {
  const needle = filter.query.trim();
  const range = windowFor(filter.when, context.now);
  const interests = new Set(filter.interestIds);

  return activities.filter((activity) => {
    if (needle && !matchesQuery(activity, needle)) return false;

    if (interests.size > 0 && !activity.interests.some((i) => interests.has(i.id))) return false;

    if (range) {
      if (!activity.starts_at) return false;
      const at = new Date(activity.starts_at).getTime();
      if (!Number.isFinite(at) || at < range[0] || at >= range[1]) return false;
    }

    if (filter.maxDistanceKm !== null) {
      const distance = context.distanceById?.get(activity.id);
      // Unbekannte Entfernung nicht verstecken: lieber ein Treffer zu viel als
      // ein Event, das man nie findet, weil der Ort nicht geocodiert werden konnte.
      if (distance !== undefined && distance > filter.maxDistanceKm) return false;
    }

    if (filter.hideFull && isFull(activity)) return false;

    return true;
  });
}
