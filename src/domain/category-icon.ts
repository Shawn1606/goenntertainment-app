/**
 * Kategorie → Icon-Name (reine Logik, keine Anzeige).
 *
 * Löst `interest-emoji.ts` ab: Statt eines bunten Emojis liefert diese Schicht
 * einen **einfarbigen Linien-Icon-Namen**. Emojis rendern auf iOS/Android
 * unterschiedlich und sind für Screenreader unzuverlässig – ein eigenes
 * Icon-Set ist einheitlich und barrierefrei beschriftbar.
 *
 * Kategorien kommen aus der Datenbank und können jederzeit dazukommen. Deshalb
 * wird – wie zuvor – in drei Stufen aufgelöst: erst am `icon`-Slug aus dem Seed,
 * dann an Stichwörtern im Namen, zuletzt ein neutrales Rückfall-Icon. Eine neue
 * Kategorie sieht damit nie kaputt aus, auch wenn niemand diese Datei anfasst.
 *
 * Die eigentlichen SVGs liegen in `src/components/ui/category-icon.tsx` und
 * bilden genau die hier deklarierten Namen ab (Test wacht über den Namensraum).
 */

type InterestLike = { name?: string | null; icon?: string | null };

/** Alle Icon-Namen, die das Set kennt. Rückgabewerte bleiben in dieser Menge. */
export const CATEGORY_ICON_NAMES = [
  'bike',
  'ball',
  'run',
  'dumbbell',
  'yoga',
  'hike',
  'wave',
  'camera',
  'film',
  'music',
  'mic',
  'gamepad',
  'dice',
  'plane',
  'cooking',
  'cake',
  'food',
  'coffee',
  'party',
  'art',
  'book',
  'tech',
  'nature',
  'animal',
  'people',
  'tag',
] as const;

export type CategoryIconName = (typeof CATEGORY_ICON_NAMES)[number];

/** Wenn nichts passt: ein neutrales, nichtssagendes Zeichen (Etikett). */
export const CATEGORY_ICON_FALLBACK: CategoryIconName = 'tag';

/** Die Slugs aus `server/src/seed.js` → Icon-Name. */
const BY_ICON: Record<string, CategoryIconName> = {
  bike: 'bike',
  people: 'people',
  basketball: 'ball',
  camera: 'camera',
  music: 'music',
  gaming: 'gamepad',
  travel: 'plane',
  cooking: 'cooking',
  art: 'art',
  fitness: 'dumbbell',
};

/** Stichwort → Icon-Name. Reihenfolge zählt: das erste Treffen gewinnt. */
const BY_KEYWORD: readonly (readonly [string, CategoryIconName])[] = [
  ['rad', 'bike'],
  ['bike', 'bike'],
  ['basket', 'ball'],
  ['fußball', 'ball'],
  ['fussball', 'ball'],
  ['sport', 'run'],
  ['fitness', 'dumbbell'],
  ['gym', 'dumbbell'],
  ['yoga', 'yoga'],
  ['wandern', 'hike'],
  ['schwimm', 'wave'],
  ['foto', 'camera'],
  ['film', 'film'],
  ['kino', 'film'],
  ['musik', 'music'],
  ['konzert', 'mic'],
  ['tanz', 'music'],
  ['gaming', 'gamepad'],
  ['spiel', 'dice'],
  ['reise', 'plane'],
  ['koch', 'cooking'],
  ['back', 'cake'],
  ['essen', 'food'],
  ['kaffee', 'coffee'],
  ['party', 'party'],
  ['kunst', 'art'],
  ['design', 'art'],
  ['lesen', 'book'],
  ['lern', 'book'],
  ['bib', 'book'],
  ['tech', 'tech'],
  ['natur', 'nature'],
  ['tier', 'animal'],
  ['sozial', 'people'],
  ['community', 'people'],
  ['leute', 'people'],
];

export function categoryIcon(interest: InterestLike | null | undefined): CategoryIconName {
  const icon = interest?.icon?.trim().toLowerCase();
  if (icon && BY_ICON[icon]) return BY_ICON[icon];

  const name = interest?.name?.toLowerCase() ?? '';
  for (const [needle, iconName] of BY_KEYWORD) {
    if (name.includes(needle)) return iconName;
  }

  return CATEGORY_ICON_FALLBACK;
}
