/**
 * Suchverlauf – was man zuletzt gesucht oder angetippt hat.
 *
 * ## Warum es ihn gibt
 *
 * Die häufigste Suche ist die nach etwas, das man schon einmal gefunden hat: die
 * Person von gestern Abend, das Event, das man sich noch mal ansehen wollte. Ohne
 * Verlauf tippt man denselben Namen jedes Mal neu. Instagram und TikTok zeigen
 * deshalb beim Öffnen der Suche zuerst „Zuletzt" – genau das Muster, das man
 * kennt.
 *
 * ## Was gespeichert wird
 *
 * Drei Sorten: angetippte Personen, angetippte Aktivitäten und abgeschickte
 * Suchbegriffe. Neueste zuerst, jeder Eintrag nur einmal (ein erneuter Tipp
 * holt ihn nach oben), höchstens {@link MAX_HISTORY}. Der Verlauf liegt nur auf
 * dem Gerät – er verrät, wen man sucht, und geht den Server nichts an.
 *
 * Reine Funktionen ohne Speicher, damit sie sich testen lassen; das Lesen und
 * Schreiben steht in `src/lib/search-history-store.ts`.
 */

export type SearchHistoryEntry =
  | { kind: 'person'; id: number; name: string; username: string | null; avatar: string | null }
  | { kind: 'activity'; id: number; title: string; banner_url: string | null }
  | { kind: 'query'; text: string };

export const MAX_HISTORY = 10;

/**
 * Obergrenze für die gespeicherte Form in Zeichen.
 *
 * Der Gerätespeicher (expo-secure-store) warnt ab 2048 Bytes pro Wert und
 * speichert auf manchen Android-Geräten darüber gar nicht mehr. Lieber einen
 * alten Eintrag verlieren als den ganzen Verlauf.
 */
export const MAX_SERIALIZED = 1800;

/** Woran zwei Einträge als „derselbe" erkannt werden. */
export function historyKey(entry: SearchHistoryEntry): string {
  if (entry.kind === 'query') return `query:${entry.text.trim().toLowerCase()}`;
  return `${entry.kind}:${entry.id}`;
}

/** Neuen Eintrag vorne einfügen – ein vorhandener gleicher wandert nach oben. */
export function addToHistory(
  history: readonly SearchHistoryEntry[],
  entry: SearchHistoryEntry,
  max = MAX_HISTORY,
): SearchHistoryEntry[] {
  if (entry.kind === 'query' && entry.text.trim().length === 0) return [...history];
  const key = historyKey(entry);
  const normalized = entry.kind === 'query' ? { ...entry, text: entry.text.trim() } : entry;
  return [normalized, ...history.filter((e) => historyKey(e) !== key)].slice(0, max);
}

export function removeFromHistory(
  history: readonly SearchHistoryEntry[],
  entry: SearchHistoryEntry,
): SearchHistoryEntry[] {
  const key = historyKey(entry);
  return history.filter((e) => historyKey(e) !== key);
}

/** In Speicherform bringen – notfalls ohne die ältesten Einträge (siehe oben). */
export function serializeHistory(history: readonly SearchHistoryEntry[]): string {
  let list = history.slice(0, MAX_HISTORY);
  let json = JSON.stringify(list);
  while (json.length > MAX_SERIALIZED && list.length > 0) {
    list = list.slice(0, -1);
    json = JSON.stringify(list);
  }
  return json;
}

/** Aus dem Speicher lesen. Kaputtes oder Fremdes wird still verworfen. */
export function parseHistory(raw: string | null): SearchHistoryEntry[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter(isEntry).slice(0, MAX_HISTORY);
  } catch {
    return [];
  }
}

function isEntry(value: unknown): value is SearchHistoryEntry {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (v.kind === 'query') return typeof v.text === 'string' && v.text.trim().length > 0;
  if (v.kind === 'person') return typeof v.id === 'number' && typeof v.name === 'string';
  if (v.kind === 'activity') return typeof v.id === 'number' && typeof v.title === 'string';
  return false;
}
