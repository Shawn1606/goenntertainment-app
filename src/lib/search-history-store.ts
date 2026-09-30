import * as SecureStore from 'expo-secure-store';
import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';

import {
  addToHistory,
  parseHistory,
  removeFromHistory,
  serializeHistory,
  type SearchHistoryEntry,
} from '@/domain/search-history';

/**
 * Suchverlauf auf dem Gerät – gleiches Muster wie `token-store.ts`: Handy über
 * expo-secure-store, Web über localStorage.
 *
 * Der Schlüssel trägt die Konto-ID: Meldet sich auf demselben Gerät jemand
 * anderes an, sieht er nicht, wen die vorige Person gesucht hat.
 */
function keyFor(userId: number): string {
  return `goenn_search_history_${userId}`;
}

async function read(userId: number): Promise<SearchHistoryEntry[]> {
  try {
    const raw =
      Platform.OS === 'web'
        ? (globalThis.localStorage?.getItem(keyFor(userId)) ?? null)
        : await SecureStore.getItemAsync(keyFor(userId));
    return parseHistory(raw);
  } catch {
    return [];
  }
}

async function write(userId: number, history: SearchHistoryEntry[]): Promise<void> {
  try {
    const json = serializeHistory(history);
    if (Platform.OS === 'web') globalThis.localStorage?.setItem(keyFor(userId), json);
    else await SecureStore.setItemAsync(keyFor(userId), json);
  } catch {
    // Ein Verlauf, der sich nicht speichern lässt, ist kein Grund für eine
    // Fehlermeldung – er fehlt dann eben beim nächsten Öffnen.
  }
}

/** Verlauf lesen und ändern; jede Änderung wird sofort gespeichert. */
export function useSearchHistory(userId: number | undefined) {
  const [history, setHistory] = useState<SearchHistoryEntry[]>([]);

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    read(userId).then((list) => alive && setHistory(list));
    return () => {
      alive = false;
    };
  }, [userId]);

  const change = useCallback(
    (next: (prev: SearchHistoryEntry[]) => SearchHistoryEntry[]) => {
      setHistory((prev) => {
        const updated = next(prev);
        if (userId) write(userId, updated);
        return updated;
      });
    },
    [userId],
  );

  return {
    history,
    add: useCallback((entry: SearchHistoryEntry) => change((prev) => addToHistory(prev, entry)), [change]),
    remove: useCallback((entry: SearchHistoryEntry) => change((prev) => removeFromHistory(prev, entry)), [change]),
    clear: useCallback(() => change(() => []), [change]),
  };
}
