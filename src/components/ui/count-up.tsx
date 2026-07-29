/**
 * Eine Zahl, die auf ihren neuen Wert hochläuft.
 *
 * Klingt nach Spielerei, ist aber die einzige Möglichkeit, eine Veränderung
 * sichtbar zu machen: Springt „12" auf „13", sieht man das nur, wenn man vorher
 * hingeschaut hat. Läuft sie hoch, zieht die Bewegung den Blick genau auf die
 * Stelle, an der sich etwas verdient wurde – und das ist der Moment, für den
 * Leute wiederkommen.
 *
 * Läuft absichtlich auf dem JS-Thread statt über Reanimated: Für animierten
 * TEXT bräuchte es den `TextInput`-Trick (Text über `useAnimatedProps` setzen),
 * der auf Web und mit Schriftarten unzuverlässig ist. Hier geht es um eine
 * Handvoll kleiner Zahlen für weniger als eine Sekunde – das kostet nichts und
 * sieht überall gleich aus.
 */
import { useEffect, useRef, useState } from 'react';
import type { StyleProp, TextStyle } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';

export type CountUpProps = {
  value: number;
  /** Wie lange das Hochlaufen dauert. Kurz halten – es ist ein Hinweis, keine Show. */
  durationMs?: number;
  /**
   * Beim ersten Erscheinen von 0 hochlaufen. Für Bildschirme, die man öffnet,
   * um genau diese Zahl zu sehen (Fortschritt). Auf der Startseite unnötig:
   * Dort steht erst 0 und wird beim Laden ohnehin zum echten Wert – das
   * Hochlaufen kommt dann von selbst.
   */
  animateOnMount?: boolean;
  /** Eigene Darstellung, z. B. Tausenderpunkte oder ein Suffix. */
  format?: (value: number) => string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
};

/** Weich auslaufen: schnell los, sanft ankommen. */
function easeOut(t: number): number {
  return 1 - (1 - t) ** 3;
}

export function CountUp({
  value,
  durationMs = 700,
  animateOnMount = false,
  format,
  style,
  numberOfLines,
}: CountUpProps) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(animateOnMount ? 0 : value);
  // Startwert der laufenden Animation. Als Ref, damit ein Wechsel mitten im
  // Hochlaufen dort weitermacht, wo die Zahl gerade steht, statt zurückzufallen.
  const fromRef = useRef(shown);

  useEffect(() => {
    const from = fromRef.current;
    const target = Number.isFinite(value) ? value : 0;

    // Nichts zu tun – und bei „Bewegung reduzieren" wird nie animiert.
    if (from === target || reduced || durationMs <= 0) {
      fromRef.current = target;
      setShown(target);
      return;
    }

    let frame = 0;
    const started = Date.now();

    const step = () => {
      const progress = Math.min(1, (Date.now() - started) / durationMs);
      const current = from + (target - from) * easeOut(progress);
      // Ganzzahlig anzeigen; erst am Ende exakt auf das Ziel setzen, damit nie
      // eine krumme Zahl stehen bleibt.
      const next = progress === 1 ? target : Math.round(current);
      fromRef.current = next;
      setShown(next);
      if (progress < 1) frame = requestAnimationFrame(step);
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, durationMs, reduced]);

  return (
    <ThemedText style={style} numberOfLines={numberOfLines}>
      {format ? format(shown) : String(shown)}
    </ThemedText>
  );
}
