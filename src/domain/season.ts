/**
 * Welche Jahreszeit ist gerade – und was hängt dann in der App?
 *
 * Kleine Dekoration nach Saison macht die App lebendiger: im Oktober Kürbisse,
 * im Advent Christbaumkugeln, im Winter Schneeflocken. Sie trägt keine
 * Information und darf nie etwas verdecken, was man antippen muss – deshalb
 * entscheidet hier nur das Datum, und die Zeichnungen sind klein.
 *
 * Reihenfolge der Prüfung = Vorrang: Feste Anlässe (Halloween, Advent,
 * Silvester, Valentinstag, Ostern) schlagen die Jahreszeit, in die sie fallen.
 *
 * Gerechnet wird mit dem Ortsdatum des Geräts (`getMonth`/`getDate`), nicht mit
 * UTC – sonst hinge an Silvester bis 1 Uhr nachts noch der Advent.
 */

export type SeasonKey = 'halloween' | 'advent' | 'newyear' | 'winter' | 'valentine' | 'easter' | 'spring' | 'summer' | 'autumn';

/** Was gezeichnet werden kann (src/components/seasonal-decor.tsx). */
export type SeasonOrnament =
  // Halloween
  | 'pumpkin'
  | 'ghost'
  | 'bat'
  | 'spider'
  | 'candy'
  | 'witch-hat'
  | 'moon'
  // Advent und Weihnachten
  | 'bauble'
  | 'star'
  | 'candy-cane'
  | 'gingerbread'
  | 'present'
  | 'bell'
  | 'holly'
  // Silvester
  | 'firework'
  | 'confetti'
  | 'party-hat'
  // Winter
  | 'snowflake'
  | 'snowman'
  | 'mitten'
  // Valentinstag
  | 'heart'
  | 'letter'
  // Ostern und Frühling
  | 'egg'
  | 'bunny'
  | 'chick'
  | 'blossom'
  | 'tulip'
  | 'butterfly'
  | 'ladybug'
  // Sommer
  | 'sun'
  | 'ice-cream'
  | 'watermelon'
  | 'beach-ball'
  // Herbst
  | 'leaf'
  | 'acorn'
  | 'mushroom'
  | 'apple';

export type Season = {
  key: SeasonKey;
  /** Für Vorleser und Tests – „Halloween", „Advent" … */
  label: string;
  /**
   * Was hängt, der Reihe nach. Die Girlande wiederholt die Liste bei Bedarf –
   * gleiche Symbole stehen deshalb nie direkt nebeneinander.
   */
  ornaments: readonly SeasonOrnament[];
  /** Farben für einfärbbare Anhänger (Kugeln, Eier, Bonbons …), im Wechsel. */
  colors: readonly string[];
  /** Farbe der Perlen an der Girlande. */
  beads: readonly string[];
};

const SEASONS: Record<SeasonKey, Season> = {
  halloween: {
    key: 'halloween',
    label: 'Halloween',
    ornaments: ['pumpkin', 'bat', 'ghost', 'candy', 'spider', 'pumpkin', 'witch-hat', 'bat', 'moon', 'ghost'],
    colors: ['#f97316', '#a855f7', '#22c55e', '#fb923c'],
    beads: ['#f97316', '#a855f7'],
  },
  advent: {
    key: 'advent',
    label: 'Advent',
    ornaments: ['bauble', 'star', 'candy-cane', 'bauble', 'gingerbread', 'bell', 'present', 'bauble', 'holly', 'star'],
    colors: ['#e11d48', '#f5c542', '#16a34a', '#be123c'],
    beads: ['#f5c542', '#e11d48', '#16a34a'],
  },
  newyear: {
    key: 'newyear',
    label: 'Silvester',
    ornaments: ['firework', 'star', 'confetti', 'party-hat', 'firework', 'star', 'confetti'],
    colors: ['#f5c542', '#25f4ee', '#fe2c55', '#a855f7'],
    beads: ['#f5c542', '#25f4ee', '#fe2c55'],
  },
  winter: {
    key: 'winter',
    label: 'Winter',
    ornaments: ['snowflake', 'snowman', 'snowflake', 'mitten', 'star', 'snowflake', 'mitten'],
    colors: ['#38bdf8', '#e11d48', '#0ea5e9'],
    beads: ['#bae6fd', '#38bdf8'],
  },
  valentine: {
    key: 'valentine',
    label: 'Valentinstag',
    ornaments: ['heart', 'letter', 'blossom', 'heart', 'present', 'letter'],
    colors: ['#fe2c55', '#fb7185', '#e11d48'],
    beads: ['#fb7185', '#fe2c55'],
  },
  easter: {
    key: 'easter',
    label: 'Ostern',
    ornaments: ['egg', 'bunny', 'egg', 'chick', 'blossom', 'egg', 'tulip'],
    colors: ['#fbbf24', '#f9a8d4', '#86efac', '#93c5fd'],
    beads: ['#fde68a', '#f9a8d4', '#86efac'],
  },
  spring: {
    key: 'spring',
    label: 'Frühling',
    ornaments: ['blossom', 'butterfly', 'tulip', 'ladybug', 'blossom', 'tulip'],
    colors: ['#f9a8d4', '#f472b6', '#fbbf24'],
    beads: ['#f9a8d4', '#86efac'],
  },
  summer: {
    key: 'summer',
    label: 'Sommer',
    ornaments: ['sun', 'ice-cream', 'watermelon', 'beach-ball', 'sun', 'ice-cream'],
    colors: ['#fbbf24', '#fb923c', '#38bdf8'],
    beads: ['#fbbf24', '#38bdf8'],
  },
  autumn: {
    key: 'autumn',
    label: 'Herbst',
    ornaments: ['leaf', 'acorn', 'mushroom', 'leaf', 'apple', 'leaf', 'acorn'],
    colors: ['#ea580c', '#ca8a04', '#b45309', '#dc2626'],
    beads: ['#ea580c', '#ca8a04'],
  },
};

/**
 * Ostersonntag nach der anonymen gregorianischen Osterformel (Meeus/Jones/Butcher).
 * `month` ist 1-basiert (3 = März, 4 = April).
 */
export function easterSunday(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

/** Tage seit Jahresbeginn (1. Januar = 0) – zum Vergleichen von Zeiträumen. */
function dayOfYear(year: number, month: number, day: number): number {
  return Math.round((Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 1)) / 86_400_000);
}

export function seasonFor(date: Date): Season {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const md = month * 100 + day;

  if (md >= 1001 && md <= 1102) return SEASONS.halloween;
  if (md >= 1201 && md <= 1226) return SEASONS.advent;
  if (md >= 1227 || md <= 106) return SEASONS.newyear;
  if (md >= 207 && md <= 214) return SEASONS.valentine;

  // Ostern: zwei Wochen vorher bis Ostermontag.
  const easter = easterSunday(year);
  const today = dayOfYear(year, month, day);
  const sunday = dayOfYear(year, easter.month, easter.day);
  if (today >= sunday - 13 && today <= sunday + 1) return SEASONS.easter;

  if (month <= 2) return SEASONS.winter;
  if (month <= 5) return SEASONS.spring;
  if (month <= 8) return SEASONS.summer;
  return SEASONS.autumn;
}

/** Eine Saison per Schlüssel – für ein vom Admin festgelegtes Thema (src/domain/features.ts). */
export function seasonByKey(key: SeasonKey): Season {
  return SEASONS[key];
}
