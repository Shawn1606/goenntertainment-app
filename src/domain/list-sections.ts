/**
 * Abschnitte für eine lange Terminliste – nach Kategorie ODER nach Monat.
 *
 * ## Warum es zwei Achsen gibt und nicht eine
 *
 * Die Liste, die aus einem Pin oder einer Veranstalter-Karte aufgeht, hat je
 * nach Herkunft eine andere Form:
 *
 *  - **Vom Karten-Pin**: alle 143 Termine EINES Hauses – Konzerte, Tanzabende,
 *    eine Comedy-Nacht. Hier ist die nützliche Frage „was für ein Abend?", also
 *    die Kategorie.
 *  - **Aus einem Kategorie-Regal**: 79 Konzerte desselben Hauses. Nach Kategorie
 *    zu unterteilen wäre hier sinnlos – es gibt nur eine. Die nützliche Frage ist
 *    „wann?", also der Monat.
 *
 * Deshalb entscheidet der Inhalt und nicht der Aufrufer: Umfasst die Liste mehr
 * als eine führende Kategorie, wird nach Kategorie unterteilt, sonst nach Monat.
 * Eine Prop dafür hätte an jeder Aufrufstelle dieselbe Überlegung wiederholt –
 * und irgendwann hätte eine davon die falsche gewählt.
 *
 * Bewusst kein `import type { Activity } from '@/lib/api'`: Die Domänen-Schicht
 * kennt die Transportschicht nicht (wie in story.ts).
 */
import { groupByInterest, type GroupableInterestItem } from './interest-group.ts';

export type SectionAxis = 'interest' | 'month';

export type ListSection<T> = {
  /** Stabiler Schlüssel für `key`-Props. */
  key: string;
  /** Was über dem Abschnitt steht. */
  title: string;
  activities: T[];
};

export type ListSections<T> = {
  /** Wonach unterteilt wurde – für Tests und um die Überschrift zu erklären. */
  axis: SectionAxis;
  sections: ListSection<T>[];
};

/** Überschrift für Termine ohne brauchbares Datum. */
export const UNDATED_TITLE = 'Ohne Datum';

/**
 * „August 2026".
 *
 * Mit Jahr, obwohl das meist überflüssig aussieht: Der Feed des Nörgelbuff reicht
 * bis Juli 2028, und „Juli" zweimal in derselben Liste wäre schlicht falsch.
 */
function monthTitle(date: Date): string {
  return date.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
}

/** `2026-08` – sortierbar und als Schlüssel eindeutig. */
function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** Aufsteigend nach Startzeit; ohne brauchbares Datum entscheidet die ID. */
function byStart(a: GroupableInterestItem, b: GroupableInterestItem): number {
  const at = Date.parse(a.starts_at ?? '');
  const bt = Date.parse(b.starts_at ?? '');
  const aOk = Number.isFinite(at);
  const bOk = Number.isFinite(bt);
  if (aOk !== bOk) return aOk ? -1 : 1;
  if (aOk && bOk && at !== bt) return at - bt;
  return a.id - b.id;
}

/**
 * Zerlegt die Liste in Monats-Abschnitte, der nächste Monat zuerst.
 *
 * Termine ohne Datum landen in einem eigenen Abschnitt am Ende – sie gehören in
 * keinen Monat, und sie stillschweigend in den ersten zu legen wäre eine
 * Behauptung über ihr Datum.
 */
export function groupByMonth<T extends GroupableInterestItem>(activities: readonly T[]): ListSection<T>[] {
  const sections = new Map<string, ListSection<T>>();

  for (const activity of activities) {
    const at = activity.starts_at ? new Date(activity.starts_at) : null;
    const dated = at !== null && !Number.isNaN(at.getTime());

    const key = dated ? monthKey(at) : 'undated';
    const existing = sections.get(key);
    if (existing) {
      existing.activities.push(activity);
      continue;
    }

    sections.set(key, {
      key: `month-${key}`,
      title: dated ? monthTitle(at) : UNDATED_TITLE,
      activities: [activity],
    });
  }

  const list = [...sections.values()];
  for (const section of list) section.activities.sort(byStart);

  return list.sort((a, b) => {
    // Ohne Datum immer ans Ende, egal wie viele es sind.
    if (a.key === 'month-undated') return 1;
    if (b.key === 'month-undated') return -1;
    // Der Schlüssel ist `JJJJ-MM` und damit als Text richtig sortierbar.
    return a.key.localeCompare(b.key);
  });
}

/**
 * Die Abschnitte für eine Terminliste – Achse nach Inhalt gewählt.
 *
 * Bei einer einzigen Kategorie ist die Kategorie keine Information; dann zählt
 * die Zeit. Bei mehreren ist es umgekehrt: Wer an einem Ort nach einem Abend
 * sucht, will zuerst wissen, was für einer.
 */
export function listSections<T extends GroupableInterestItem>(
  activities: readonly T[],
): ListSections<T> {
  const byInterest = groupByInterest(activities);

  if (byInterest.length > 1) {
    return {
      axis: 'interest',
      sections: byInterest.map((section) => ({
        key: section.key,
        title: section.title,
        activities: section.activities,
      })),
    };
  }

  return { axis: 'month', sections: groupByMonth(activities) };
}
