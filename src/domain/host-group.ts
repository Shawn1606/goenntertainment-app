/**
 * Mehrere Termine desselben Veranstalters auf Home zu EINER Karte bündeln.
 *
 * ## Warum
 *
 * Ein Kino spielt zwanzig Vorstellungen, ein Club hat jeden Freitag auf. Als
 * einzelne Banner im Regal steht dann zwanzigmal dasselbe Logo, und die eigenen
 * Events von Freund:innen – der Grund, warum jemand die App öffnet – sind
 * hinter dem Programm eines Hauses vergraben. Wer wischt, sieht keine Auswahl
 * mehr, sondern eine Wiederholung.
 *
 * Eine Karte je Veranstalter, die eine Liste öffnet, dreht das um: Das Regal
 * zeigt wieder VERSCHIEDENE Absender, und wer ein Haus interessant findet, tippt
 * hinein.
 *
 * ## Was ausdrücklich NICHT passiert
 *
 * Die Reihenfolge wird nicht neu sortiert. Die Regale sind gerankt (siehe
 * `rankActivities`), und eine Gruppe erscheint an der Stelle ihres ERSTEN
 * Treffers. Würde hier umsortiert, gäbe es zwei Wahrheiten darüber, was
 * „empfohlen" heißt – dieselbe Begründung wie bei den Storys in story.ts.
 *
 * Bewusst kein `import type { Activity } from '@/lib/api'`: Die Domänen-Schicht
 * kennt die Transportschicht nicht.
 */

export type GroupableHost = {
  id: number;
  name: string;
  username?: string | null;
  account_type?: string | null;
};

export type GroupableHostItem = {
  id: number;
  host?: GroupableHost | null;
  starts_at?: string | null;
};

/**
 * Ein Platz im Regal: entweder ein einzelnes Event oder ein Veranstalter mit
 * mehreren. Eine unterschiedene Union statt eines Eintrags mit `activities: T[]`
 * und Länge 1 – so muss die Karte nicht raten, was sie darstellt.
 */
export type ShelfEntry<T extends GroupableHostItem> =
  | { kind: 'single'; key: string; activity: T }
  | { kind: 'host'; key: string; host: GroupableHost; activities: T[] };

/**
 * Ab wie vielen Terminen desselben Hauses gebündelt wird.
 *
 * Drei und nicht zwei: Bei zwei Karten spart eine Gruppe keinen Platz, versteckt
 * aber eine – man tippt, um zu sehen, was man ohne Bündelung schon gesehen hätte.
 */
export const MIN_GROUP = 3;

/** Aufsteigend nach Startzeit; ohne brauchbares Datum entscheidet die ID. */
function byStart(a: GroupableHostItem, b: GroupableHostItem): number {
  const at = Date.parse(a.starts_at ?? '');
  const bt = Date.parse(b.starts_at ?? '');
  const aOk = Number.isFinite(at);
  const bOk = Number.isFinite(bt);
  if (aOk !== bOk) return aOk ? -1 : 1;
  if (aOk && bOk && at !== bt) return at - bt;
  return a.id - b.id;
}

/**
 * Baut die Regal-Einträge: gebündelt, wo sich Bündeln lohnt, sonst einzeln.
 *
 * Gruppiert wird über `host.id`. Der Name wäre die naheliegende, aber falsche
 * Wahl – zwei Konten dürfen „CinemaxX" heißen.
 *
 * `min` ist einstellbar, damit ein kurzes Regal (z. B. „Gemerkt") strenger sein
 * kann als „Alles entdecken".
 */
export function groupByHost<T extends GroupableHostItem>(
  items: readonly T[],
  { min = MIN_GROUP }: { min?: number } = {},
): ShelfEntry<T>[] {
  const counts = new Map<number, number>();
  for (const item of items) {
    const id = item.host?.id;
    if (typeof id === 'number') counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  const entries: ShelfEntry<T>[] = [];
  // Wo im Ergebnis die Gruppe eines Hauses steht – gefüllt beim ersten Treffer,
  // damit die Rangfolge des Regals erhalten bleibt.
  const groupAt = new Map<number, number>();

  for (const item of items) {
    const host = item.host;
    const id = host?.id;

    // Ohne Konto oder unter der Schwelle: eigene Karte, wie bisher.
    if (typeof id !== 'number' || !host || (counts.get(id) ?? 0) < min) {
      entries.push({ kind: 'single', key: `activity-${item.id}`, activity: item });
      continue;
    }

    const at = groupAt.get(id);
    if (at === undefined) {
      groupAt.set(id, entries.length);
      entries.push({ kind: 'host', key: `host-${id}`, host, activities: [item] });
      continue;
    }

    const entry = entries[at];
    if (entry.kind === 'host') entry.activities.push(item);
  }

  // Innerhalb einer Gruppe chronologisch: Eine Liste von Vorstellungen liest man
  // vorwärts. Die Rangfolge des Regals bleibt davon unberührt – sie bestimmt nur,
  // WO die Gruppe steht, nicht die Reihenfolge in ihr.
  for (const entry of entries) {
    if (entry.kind === 'host') entry.activities.sort(byStart);
  }

  return entries;
}

/** Wie viele Karten das Regal am Ende zeigt – für die Zahl an der Überschrift. */
export function shelfLength<T extends GroupableHostItem>(entries: readonly ShelfEntry<T>[]): number {
  return entries.length;
}
