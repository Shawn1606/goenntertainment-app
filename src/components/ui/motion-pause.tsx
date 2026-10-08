/**
 * Endlos-Animationen anhalten, wo man sie gerade nicht sieht.
 *
 * ## Warum
 *
 * Tab-Seiten bleiben geladen, auch wenn ein anderer Tab vorn ist (der Wechsel
 * soll sofort gehen), und die Nachbarn des vorderen Tabs werden sogar vorab
 * gezeichnet (app-tabs.tsx, Wischen). Ohne Pause liefen Goenni, Stempel-Glitzer,
 * Girlande und Schimmer auf ALLEN diesen Seiten gleichzeitig – auch unter einer
 * Detailseite, die über den Tabs liegt. Das kostet Akku und lässt die vordere
 * Seite ruckeln.
 *
 * ## Wie
 *
 * `MotionPause` legt um einen Teilbaum fest, ob er ruht (`app-tabs.tsx` um jede
 * Tab-Seite: ruht, solange sie nicht vorn ist). Bausteine mit Dauerbewegung
 * fragen `useStill()` statt nur `useReducedMotion()`: still = „Bewegung
 * reduzieren" ODER pausiert. Einmalige Bewegungen (Eintritt, Antippen) brauchen
 * das nicht – sie laufen nur, wenn man hinsieht.
 *
 * Verschachtelt gilt: Ruht ein äußerer Teil, ruht alles darin.
 *
 * ## Wiederkehrende Bewegung: `useBeat`, nicht `withRepeat`
 *
 * Was in Abständen wiederkommt (Hopser, Blinzeln, Schwingen, Lichtband), startet
 * ein Takt aus einem JS-Zeitgeber jeweils als kurze, endliche Animation. Eine
 * endlose `withRepeat`-Schleife mit `withDelay`-Pause hält die Animations-Maschine
 * auch in der Pause wach: Jedes Bild wird geprüft – auf dem Handy im UI-Thread, im
 * Browser im Haupt-Thread (gemessen Okt. 2026: fast die Hälfte der Zeit einer
 * ruhenden Seite). Mit dem Takt läuft zwischen zwei Bewegungen gar nichts.
 */
import { createContext, useContext, useEffect, useEffectEvent, type ReactNode } from 'react';
import { useReducedMotion } from 'react-native-reanimated';

const PausedContext = createContext(false);

export function MotionPause({ paused, children }: { paused: boolean; children: ReactNode }) {
  const outer = useContext(PausedContext);
  return <PausedContext.Provider value={outer || paused}>{children}</PausedContext.Provider>;
}

/** Soll Dauerbewegung stehen? „Bewegung reduzieren" oder pausiert. */
export function useStill(): boolean {
  const reduced = useReducedMotion();
  const paused = useContext(PausedContext);
  return reduced || paused;
}

/**
 * Ruft `onBeat` nach `firstMs` und danach alle `everyMs` auf, solange `active` gilt
 * (siehe oben, „Wiederkehrende Bewegung"). `onBeat` startet eine kurze Animation;
 * es darf sich bei jedem Rendern ändern, ohne dass der Takt neu beginnt.
 */
export function useBeat(onBeat: () => void, everyMs: number, active: boolean, firstMs: number = everyMs) {
  const beat = useEffectEvent(onBeat);
  useEffect(() => {
    if (!active) return;
    let repeat: ReturnType<typeof setInterval> | undefined;
    const first = setTimeout(() => {
      beat();
      repeat = setInterval(() => beat(), everyMs);
    }, firstMs);
    return () => {
      clearTimeout(first);
      clearInterval(repeat);
    };
  }, [active, everyMs, firstMs]);
}
