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
  /** Dauerangebot ohne festen Termin – siehe `isAlwaysOn`. */
  is_permanent?: boolean;
};

/**
 * Dauerangebot ohne festen Termin (Bowling, Trampolinhalle, Freibad).
 *
 * Für die Filter ist das der wichtigste Sonderfall: Ein Freibad ist „heute
 * abend" genauso offen wie „am Wochenende". Es darf deshalb an KEINEM
 * Zeitfenster scheitern – wer „Heute" filtert, sucht etwas für heute, und das
 * Freibad ist eine gültige Antwort darauf.
 *
 * Andersherum gedacht: Würde man es nach `starts_at` beurteilen, fiele es sofort
 * heraus, denn dort steht nur der Anlege-Zeitpunkt (siehe server/schema.sql).
 */
export function isAlwaysOn(activity: FilterableActivity): boolean {
  return activity.is_permanent === true;
}

/** Zeitfenster, wie man sie im Alltag sucht. */
export type DateWindow = 'all' | 'today' | 'tomorrow' | 'weekend' | 'week' | 'month';

/**
 * Tageszeit – die Frage „wann kann ich überhaupt".
 *
 * Getrennt von `DateWindow`, weil sich beides kombiniert: „diese Woche abends"
 * ist die häufigste Suche überhaupt und mit einer einzigen Liste aus Tag- und
 * Uhrzeit-Werten nicht ausdrückbar.
 */
export type Daytime = 'all' | 'morning' | 'afternoon' | 'evening' | 'night';

/**
 * Was gefiltert werden kann – und bewusst nicht mehr.
 *
 * Hier standen kurzzeitig auch „Wer veranstaltet", Gruppengröße, Teilnahme,
 * Merkliste und eine Sortierung. Das waren zehn Reihen Chips über einer Liste,
 * und die falsche Antwort auf das eigentliche Problem: Dass alle 143 Konzerte,
 * Partys und Tanzabende in EINER Kategorie „Musik" lagen, lag nicht an
 * fehlenden Filtern, sondern an einer zu grobkörnigen Kategorie-Liste. Die
 * Auswahl steckt jetzt in den Kategorien (siehe INTERESTS in server/src/seed.js),
 * nicht in immer neuen Schaltern daneben.
 */
export type ActivityFilter = {
  /** Freitext über Titel, Beschreibung, Ort und Kategorien. */
  query: string;
  /** Kategorien; leer = alle. Mehrere Kategorien sind ODER-verknüpft. */
  interestIds: number[];
  when: DateWindow;
  daytime: Daytime;
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
  daytime: 'all',
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
  if (filter.daytime !== 'all') count += 1;
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
    case 'weekend':
      return weekendWindow(now);
    case 'week':
      return [now.getTime(), today + 7 * day];
    case 'month':
      return [now.getTime(), today + 31 * day];
  }
}

/**
 * Das nächste Wochenende: von Freitag 17:00 bis Montag 00:00.
 *
 * Freitagabend gehört dazu – „am Wochenende weggehen" heisst in der Praxis ab
 * Freitag nach der Arbeit, nicht ab Samstag früh. Und wer schon IM Wochenende
 * steckt (Samstagmittag), meint das laufende und nicht das nächste: Deshalb geht
 * es ab Donnerstag vorwärts, an allen anderen Tagen zurück zum letzten Freitag.
 */
function weekendWindow(now: Date): [number, number] {
  const day = 24 * 60 * 60 * 1000;
  const today = startOfDay(now);
  // 0 = Sonntag, 5 = Freitag, 6 = Samstag.
  const weekday = new Date(now).getDay();

  // Wie viele Tage bis zum Freitag DIESES Wochenendes.
  let toFriday: number;
  if (weekday === 6) toFriday = -1; // Samstag → gestern war Freitag
  else if (weekday === 0) toFriday = -2; // Sonntag → vorgestern
  else toFriday = 5 - weekday; // Mo–Fr → vorwärts (Fr = 0)

  const fridayEvening = today + toFriday * day + 17 * 60 * 60 * 1000;
  const mondayStart = today + (toFriday + 3) * day;

  // Nicht in die Vergangenheit zeigen: Am Samstagabend soll nicht der
  // Freitagabend im Fenster liegen, den es nicht mehr gibt.
  return [Math.max(fridayEvening, now.getTime()), mondayStart];
}

/**
 * Passt die Startzeit zur gesuchten Tageszeit?
 *
 * `night` läuft ÜBER MITTERNACHT (22:00–04:59). Das ist der Fall, an dem eine
 * naive Von-Bis-Prüfung scheitert: Ein Set um 2 Uhr ist Nacht, liegt aber
 * zahlenmässig unter dem Startwert 22. Deshalb hier zwei Bereiche statt einem.
 */
function matchesDaytime(startsAt: string, daytime: Daytime): boolean {
  const at = new Date(startsAt);
  if (Number.isNaN(at.getTime())) return false;

  // Ortszeit und nicht UTC: Gemeint ist die Uhrzeit, die auf der Karte steht.
  const hour = at.getHours();

  switch (daytime) {
    case 'morning':
      return hour >= 5 && hour < 12;
    case 'afternoon':
      return hour >= 12 && hour < 17;
    case 'evening':
      return hour >= 17 && hour < 22;
    case 'night':
      return hour >= 22 || hour < 5;
    case 'all':
      return true;
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

    // Dauerangebote überspringen JEDE Zeit-Prüfung: Sie sind immer offen, also
    // ist jedes Zeitfenster für sie erfüllt (siehe `isAlwaysOn`).
    const immerOffen = isAlwaysOn(activity);

    if (range && !immerOffen) {
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

    if (filter.daytime !== 'all' && !immerOffen) {
      if (!activity.starts_at) return false;
      if (!matchesDaytime(activity.starts_at, filter.daytime)) return false;
    }

    if (filter.hideFull && isFull(activity)) return false;

    return true;
  });
}
