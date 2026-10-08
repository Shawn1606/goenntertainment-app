import { useSyncExternalStore } from 'react';
import { AppState, type NativeEventSubscription } from 'react-native';

/**
 * Die aktuelle Zeit als Zustand – für alles, was „noch 3 Tage", „verfällt
 * morgen", „Heute" oder „abgelaufen" anzeigt.
 *
 * `new Date()` direkt im Rendern reicht nicht: Der React Compiler merkt sich das
 * Ergebnis mit den übrigen Werten seines Blocks, und solange sich die Daten nicht
 * ändern (sie behalten ihr Objekt, siehe keepIfSame), bliebe „Verfällt in 3 Tagen"
 * auch am nächsten Tag stehen. Diese Uhr schlägt einmal pro Minute und sofort,
 * wenn die App wieder nach vorn kommt – EIN Takt für alle, die sie lesen.
 */
const TICK_MS = 60_000;

let now = new Date();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let foreground: NativeEventSubscription | null = null;

function tick() {
  now = new Date();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    // Lange niemand zugehört: die Zeit zuerst auffrischen (React liest sie gleich danach).
    now = new Date();
    timer = setInterval(tick, TICK_MS);
    foreground = AppState.addEventListener('change', (state) => {
      if (state === 'active') tick();
    });
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    if (timer) clearInterval(timer);
    timer = null;
    foreground?.remove();
    foreground = null;
  };
}

const read = () => now;

export function useNow(): Date {
  return useSyncExternalStore(subscribe, read, read);
}
