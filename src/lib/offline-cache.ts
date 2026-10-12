import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import type { Booking, PassToken } from '@/lib/api';
import { loadSessionUserId } from '@/lib/token-store';

/**
 * Offline-Pass: Was im Keller einer Bowlingbahn ohne Netz noch gehen muss –
 * die offenen Buchungen (mit Einlöse-Code) und ein länger gültiger Pass.
 *
 * Gleiches Muster wie token-store: Handy = expo-secure-store, Web =
 * localStorage. SecureStore verträgt pro Eintrag nur gut 2 KB, deshalb wird
 * der Inhalt in Stücke geteilt (`…_0`, `…_1`, …) und die Anzahl extra
 * gespeichert. Gespeichert wird nur, was zum Vorzeigen nötig ist; beim Abmelden
 * wird alles gelöscht (clearOfflineCache).
 *
 * Jede Kopie trägt die Konto-Nummer, die neben dem Token liegt (token-store).
 * Gelesen wird sie nur für genau dieses Konto: Schlug das Löschen beim Abmelden
 * fehl, sieht die oder der Nächste am Gerät trotzdem keine fremden Codes.
 */
const BOOKINGS_KEY = 'goenn_offline_bookings';
const PASS_KEY = 'goenn_offline_pass';
/** Höchstens so viele offene Buchungen – die frühesten Fristen zuerst. */
const MAX_BOOKINGS = 12;
/** Sicher unter der SecureStore-Grenze von 2048 Byte (Umlaute zählen doppelt). */
const CHUNK = 900;

export type OfflineBookings = { owner: number; savedAt: string; bookings: Booking[] };

type OfflinePass = { owner: number; token: string; expires_at: string };

/**
 * Ein Zugriff nach dem anderen. Ein Speichern, das beim Abmelden noch läuft,
 * darf sich nicht mit dem Löschen mischen – sonst blieben Stücke des alten
 * Kontos liegen, oder ein Lesen fände halb alte, halb neue Stücke.
 */
let queue: Promise<unknown> = Promise.resolve();

function queued<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job);
  queue = run.catch(() => undefined);
  return run;
}

async function writeRaw(key: string, value: string | null): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      if (value === null) globalThis.localStorage?.removeItem(key);
      else globalThis.localStorage?.setItem(key, value);
    } catch {
      // Privates Fenster o. Ä.: dann eben ohne Offline-Kopie.
    }
    return;
  }

  const oldCount = Number((await SecureStore.getItemAsync(`${key}_count`)) ?? '0') || 0;
  const parts = value === null ? [] : value.match(new RegExp(`[\\s\\S]{1,${CHUNK}}`, 'g')) ?? [];
  for (let i = 0; i < parts.length; i++) await SecureStore.setItemAsync(`${key}_${i}`, parts[i]);
  for (let i = parts.length; i < oldCount; i++) await SecureStore.deleteItemAsync(`${key}_${i}`);
  if (parts.length > 0) await SecureStore.setItemAsync(`${key}_count`, String(parts.length));
  else await SecureStore.deleteItemAsync(`${key}_count`);
}

async function readRaw(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }
  const count = Number((await SecureStore.getItemAsync(`${key}_count`)) ?? '0') || 0;
  if (count === 0) return null;
  const parts: string[] = [];
  for (let i = 0; i < count; i++) {
    const part = await SecureStore.getItemAsync(`${key}_${i}`);
    if (part === null) return null;
    parts.push(part);
  }
  return parts.join('');
}

function setRaw(key: string, value: string | null): Promise<void> {
  return queued(() => writeRaw(key, value));
}

function getRaw(key: string): Promise<string | null> {
  return queued(() => readRaw(key));
}

/** Nur offene Buchungen mit Code – und nur, was man zum Vorzeigen braucht. */
export function offlineSubset(bookings: Booking[]): Booking[] {
  return bookings
    .filter((b) => b.status === 'confirmed' && b.code !== null)
    .sort((a, b) => a.valid_until.localeCompare(b.valid_until))
    .slice(0, MAX_BOOKINGS);
}

/** Ohne bekanntes Konto keine Kopie: Sie ließe sich niemandem sicher zuordnen. */
export async function saveOfflineBookings(bookings: Booking[]): Promise<void> {
  const owner = await loadSessionUserId();
  if (owner === null) return;
  const data: OfflineBookings = { owner, savedAt: new Date().toISOString(), bookings: offlineSubset(bookings) };
  await setRaw(BOOKINGS_KEY, JSON.stringify(data));
}

export async function loadOfflineBookings(): Promise<OfflineBookings | null> {
  try {
    const [raw, owner] = await Promise.all([getRaw(BOOKINGS_KEY), loadSessionUserId()]);
    if (!raw || owner === null) return null;
    const data = JSON.parse(raw) as OfflineBookings;
    return data.owner === owner ? data : null;
  } catch {
    return null;
  }
}

/** Den länger gültigen Pass beiseitelegen (aus GET /pass). */
export async function saveOfflinePass(pass: PassToken): Promise<void> {
  if (!pass.offline_token || !pass.offline_expires_at) return;
  const owner = await loadSessionUserId();
  if (owner === null) return;
  const data: OfflinePass = { owner, token: pass.offline_token, expires_at: pass.offline_expires_at };
  await setRaw(PASS_KEY, JSON.stringify(data));
}

/** Der Offline-Pass – nur für dieses Konto und nur, solange er noch gilt. */
export async function loadOfflinePass(now: Date = new Date()): Promise<{ token: string; expires_at: string } | null> {
  try {
    const [raw, owner] = await Promise.all([getRaw(PASS_KEY), loadSessionUserId()]);
    if (!raw || owner === null) return null;
    const pass = JSON.parse(raw) as OfflinePass;
    if (pass.owner !== owner || new Date(pass.expires_at).getTime() <= now.getTime()) return null;
    return { token: pass.token, expires_at: pass.expires_at };
  } catch {
    return null;
  }
}

/** Beim Abmelden: nichts von diesem Konto auf dem Gerät lassen. */
export async function clearOfflineCache(): Promise<void> {
  await Promise.all([setRaw(BOOKINGS_KEY, null), setRaw(PASS_KEY, null)]);
}
