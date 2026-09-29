/**
 * Inhalte, die eintreten statt aufzupoppen.
 *
 * ## Wozu
 *
 * Wenn eine Liste fertig geladen ist, erscheinen bisher acht Karten gleichzeitig
 * aus dem Nichts. Das ist der Moment, den man als „ruckelt" wahrnimmt, obwohl
 * technisch nichts ruckelt: Das Auge bekommt keinen Hinweis darauf, woher der
 * Inhalt kommt oder in welcher Reihenfolge er zu lesen ist.
 *
 * Ein kurzes Auf- und Hochblenden mit leichter Staffelung löst beides: Es
 * markiert die Karten als *neu* und führt den Blick von oben nach unten.
 *
 * ## Warum `entering` und nicht ein eigener Animationswert
 *
 * Die erste Fassung hier fuhr einen `useSharedValue(0)` von 0 auf 1 und band
 * `opacity` daran. Das hat einen Fehler, der genau einmal auffällt und dann sehr
 * weh tut: **Läuft die Animation nicht, bleibt der Inhalt auf `opacity: 0` –
 * also unsichtbar.** Beim Prüfen im Browser ist genau das passiert.
 *
 * Alle übrigen Animationen dieser App sind *zusätzlich* (Leuchten, Pulsieren,
 * Schimmern): Fallen sie aus, fehlt ein Effekt, nie ein Inhalt. Ein Eintritt
 * muss sich genauso verhalten.
 *
 * Reanimateds `entering` tut das von sich aus: Die Animation liegt außerhalb des
 * normalen Stils, das Element hat also keine Deckkraft-Vorgabe. Läuft der
 * Eintritt nicht – alte Plattform, abgeschaltete Bewegung, kein Zeitgeber –,
 * steht der Inhalt einfach sofort da. Das ist der richtige Rückfall.
 *
 * ## Die Zahlen
 *
 * Aus den Dauer-Empfehlungen von NN/g: einfache Rückmeldung ~100 ms, größere
 * Wechsel 200–300 ms, über 500 ms wirkt träge.
 *
 * Die Staffelung ist bewusst knapp ({@link STAGGER_MS}) und **gedeckelt**
 * ({@link MAX_STAGGER_STEPS}): Bei 40 Einträgen wartete der letzte sonst über
 * eine Sekunde, und aus einer Hilfe würde eine Verzögerung.
 *
 * ## Wann er erneut läuft
 *
 * Nur beim Einhängen – und das ist genau richtig. Wechselt man in „Meine
 * Aktivitäten" den Umschalter, sind es andere Einträge mit anderen Keys, also
 * hängen sie neu ein und treten ein. Tippt man dagegen in der Suche ein Zeichen
 * nach, bleiben die überlebenden Treffer dieselben Elemente – und sollen NICHT
 * bei jedem Tastendruck erneut aufblitzen.
 */
import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';

/** Ein Eintritt. Am oberen Ende von „größerer Wechsel", weil es Fläche bewegt. */
const DURATION_MS = 280;

/** Abstand zwischen zwei Nachbarn. Knapp genug, dass es als eine Welle liest. */
const STAGGER_MS = 45;

/**
 * Ab hier wird nicht weiter gestaffelt.
 *
 * Sechs Schritte sind 270 ms – etwa so lang wie der Eintritt selbst. Alles
 * darüber sieht man ohnehin nicht mehr als Reihenfolge, es wäre nur Warten.
 */
const MAX_STAGGER_STEPS = 6;

export type EntranceProps = {
  children: ReactNode;
  /**
   * Position in der Liste. Bestimmt die Verzögerung – ohne Angabe startet der
   * Eintritt sofort (für einzelne Elemente).
   */
  index?: number;
  style?: StyleProp<ViewStyle>;
};

export function Entrance({ children, index, style }: EntranceProps) {
  const reduced = useReducedMotion();
  const step = Math.min(Math.max(0, index ?? 0), MAX_STAGGER_STEPS);

  return (
    <Animated.View
      // Bei „Bewegung reduzieren" gar keine Animation: Der Inhalt ist dann
      // sofort da, was hier gefahrlos ist – der Eintritt trägt keine
      // Information, die nur in der Bewegung steckt.
      entering={reduced ? undefined : FadeInDown.duration(DURATION_MS).delay(step * STAGGER_MS)}
      style={style}>
      {children}
    </Animated.View>
  );
}
