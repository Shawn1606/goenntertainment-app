import * as SecureStore from 'expo-secure-store';
import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';

import {
  addToHistory,
  forgetSearchHistory,
  parseHistory,
  removeFromHistory,
  searchHistoryKey,
  serializeHistory,
  type HistoryStore,
  type SearchHistoryEntry,
} from '@/domain/search-history';

/**
 * Suchverlauf auf dem Gerät – gleiches Muster wie `token-store.ts`: Handy über
 * expo-secure-store, Web über localStorage.
 *
 * Der Schlüssel trägt die Konto-ID: Meldet sich auf demselben Gerät jemand
 * anderes an, sieht er nicht, wen die vorige Person gesucht hat. At sign-out the history is
 * removed (clearSearchHistory below, F-44).
 */
function keyFor(userId: number): string {
  return searchHistoryKey(userId);
}

/** Every key localStorage holds (the web can list its storage; the phones' secure store cannot). */
async function webKeys(): Promise<string[]> {
  const storage = globalThis.localStorage;
  if (!storage) return [];
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key !== null) keys.push(key);
  }
  return keys;
}

const deviceStore: HistoryStore =
  Platform.OS === 'web'
    ? {
        remove: async (key) => {
          globalThis.localStorage?.removeItem(key);
        },
        keys: webKeys,
      }
    : { remove: (key) => SecureStore.deleteItemAsync(key) };

/**
 * Removes the search history of `userId` (null: unknown) and, on the web, every other history left
 * on this device. Called by the one local sign-out (src/lib/auth-context.tsx endLocalSession) and
 * when the stored session is rejected at app start. Never throws (forgetSearchHistory).
 */
export function clearSearchHistory(userId: number | null | undefined): Promise<{ removed: number; failed: number }> {
  return forgetSearchHistory(deviceStore, userId);
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
