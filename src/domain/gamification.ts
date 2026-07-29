/**
 * Punkte, Level und Abzeichen (Tickets #17/#18) – reine Rechenlogik.
 *
 * Bewusst aus echten Handlungen abgeleitet (Events erstellen, mitmachen,
 * Neues ausprobieren) statt aus Klick- oder Login-Zählern: Punkte sollen
 * belohnen, dass man sich wirklich trifft.
 */
import type { UiIconName } from './ui-icon.ts';

export type ActivityStats = {
  /** Selbst erstellte Events. */
  hosted: number;
  /** Events, bei denen man mitgemacht hat. */
  joined: number;
  /** Wie viele verschiedene Kategorien man ausprobiert hat. */
  distinctInterests: number;
};

/** XP je Handlung – an einer Stelle, damit Nachjustieren einfach bleibt. */
export const XP = {
  perHosted: 50,
  perJoined: 20,
  perDistinctInterest: 10,
} as const;

export type LevelDefinition = { level: number; title: string; minXp: number };

/** Level-Leiter. Titel bewusst locker, aber ohne Kindersprache. */
export const LEVELS: readonly LevelDefinition[] = [
  { level: 1, title: 'Neu dabei', minXp: 0 },
  { level: 2, title: 'Entdecker:in', minXp: 60 },
  { level: 3, title: 'Stammgast', minXp: 180 },
  { level: 4, title: 'Organisator:in', minXp: 400 },
  { level: 5, title: 'Local Hero', minXp: 800 },
  { level: 6, title: 'Legende', minXp: 1500 },
] as const;

export type LevelProgress = {
  level: number;
  title: string;
  xp: number;
  /** XP innerhalb des aktuellen Levels. */
  xpIntoLevel: number;
  /** XP, die dieses Level insgesamt umfasst; null im höchsten Level. */
  xpForNext: number | null;
  /** 0..1 – für den Fortschrittsbalken. */
  progress: number;
  /** Titel des nächsten Levels; null im höchsten Level. */
  nextTitle: string | null;
};

/** Gesamt-XP aus den Kennzahlen. Negative Eingaben werden als 0 gewertet. */
export function xpFor(stats: ActivityStats): number {
  const hosted = Math.max(0, Math.floor(stats.hosted));
  const joined = Math.max(0, Math.floor(stats.joined));
  const variety = Math.max(0, Math.floor(stats.distinctInterests));

  return hosted * XP.perHosted + joined * XP.perJoined + variety * XP.perDistinctInterest;
}

/** Level, Titel und Fortschritt zu gegebenen XP. */
export function levelFor(xp: number): LevelProgress {
  const safeXp = Math.max(0, Math.floor(Number.isFinite(xp) ? xp : 0));

  let index = 0;
  for (let i = 0; i < LEVELS.length; i += 1) {
    if (safeXp >= LEVELS[i].minXp) index = i;
  }

  const current = LEVELS[index];
  const next = LEVELS[index + 1] ?? null;
  const xpIntoLevel = safeXp - current.minXp;
  const span = next ? next.minXp - current.minXp : null;

  return {
    level: current.level,
    title: current.title,
    xp: safeXp,
    xpIntoLevel,
    xpForNext: span,
    progress: span === null ? 1 : Math.min(1, Math.max(0, xpIntoLevel / span)),
    nextTitle: next?.title ?? null,
  };
}

export type Badge = {
  id: string;
  name: string;
  description: string;
  /** Symbol-Name; die Zeichnung liegt in `src/components/ui/icon.tsx`. */
  icon: UiIconName;
  earned: boolean;
  /** Aktueller Stand, gedeckelt auf `goal`. */
  progress: number;
  goal: number;
};

type BadgeRule = {
  id: string;
  name: string;
  description: string;
  icon: UiIconName;
  goal: number;
  value: (stats: ActivityStats) => number;
};

/**
 * Die Regeln als Daten, nicht als if-Kette: ein neues Abzeichen ist eine Zeile
 * mehr, ohne dass irgendeine Funktion angefasst werden muss (Open/Closed).
 */
const BADGE_RULES: readonly BadgeRule[] = [
  {
    id: 'first-join',
    name: 'Erster Schritt',
    description: 'Bei einer Aktivität mitgemacht',
    icon: 'party',
    goal: 1,
    value: (s) => s.joined,
  },
  {
    id: 'first-host',
    name: 'Gastgeber:in',
    description: 'Eine eigene Aktivität erstellt',
    icon: 'tent',
    goal: 1,
    value: (s) => s.hosted,
  },
  {
    id: 'social-5',
    name: 'Unter Leuten',
    description: 'Bei 5 Aktivitäten mitgemacht',
    icon: 'user-check',
    goal: 5,
    value: (s) => s.joined,
  },
  {
    id: 'host-3',
    name: 'Macher:in',
    description: '3 eigene Aktivitäten erstellt',
    icon: 'rocket',
    goal: 3,
    value: (s) => s.hosted,
  },
  {
    id: 'explorer-3',
    name: 'Neugierig',
    description: '3 verschiedene Kategorien ausprobiert',
    icon: 'compass',
    goal: 3,
    value: (s) => s.distinctInterests,
  },
  {
    id: 'social-20',
    name: 'Immer dabei',
    description: 'Bei 20 Aktivitäten mitgemacht',
    icon: 'trophy',
    goal: 20,
    value: (s) => s.joined,
  },
];

/** Alle Abzeichen mit Stand – auch die noch nicht verdienten (als Ziel sichtbar). */
export function badgesFor(stats: ActivityStats): Badge[] {
  return BADGE_RULES.map((rule) => {
    const raw = Math.max(0, Math.floor(rule.value(stats)));
    const progress = Math.min(raw, rule.goal);
    return {
      id: rule.id,
      name: rule.name,
      description: rule.description,
      icon: rule.icon,
      earned: raw >= rule.goal,
      progress,
      goal: rule.goal,
    };
  });
}
