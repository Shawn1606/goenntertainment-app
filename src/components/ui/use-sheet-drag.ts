/**
 * Nach unten wischen, um ein Blatt zu schließen – die Geste, einmal gebaut.
 *
 * ## Warum das ein eigener Baustein ist
 *
 * Jedes Blatt der App (Credits, Teilen, Optionen, Melden …) soll sich gleich
 * anfühlen. Kopiert man die Geste, justiert irgendwann jemand einen Schwellwert
 * an einer Stelle nach, und zwei Blätter fühlen sich verschieden an. Die
 * Schwellen selbst stehen in src/domain/gestures.ts (`shouldDismiss`).
 *
 * ## Was hier drin ist und was nicht
 *
 * Drin: die Gesten, der Animationswert, die Stile für Blatt und Schleier. Nicht
 * drin: Aussehen, Modal-Rahmen, Zurück-Taste – das unterscheidet die Blätter
 * tatsächlich.
 *
 * ## Die zwei Zugänge
 *
 *  - **`headGesture`** hängt an festen Teilen (Griff, Kopfzeile) oder am ganzen
 *    Blatt, wenn es keine Liste hat: Nach unten ziehen schließt immer.
 *  - **`listGesture`** liegt über einer Liste und läuft GLEICHZEITIG mit ihr
 *    (`scrollGesture` um die Liste legen). Sie zieht das Blatt nur, wenn die
 *    Liste beim Aufsetzen ganz oben stand – sonst scrollt man einfach nach oben.
 *
 * Gebaut mit react-native-gesture-handler und Reanimated: Die Geste läuft auf
 * dem UI-Thread und kann einer nativen Liste die Bewegung teilen. Der frühere
 * PanResponder konnte das auf Android nicht – die Liste nahm ihm den Finger
 * weg, darum ging Wischen nur am Griff. Achtung: In einem `Modal` braucht
 * Android eine eigene `GestureHandlerRootView` um den Inhalt.
 */
import { useCallback, useEffect, useMemo } from 'react';
import { useWindowDimensions, type LayoutChangeEvent, type ViewStyle } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';
import {
  Easing,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { shouldDismiss } from '@/domain/gestures';

/** Senkrechter Weg nach unten, ab dem aus einem Tippen ein Ziehen wird. */
const DRAG_START = 10;
/** Waagerechter Weg, nach dem die Geste aufgibt (z. B. eine waagerechte Reihe im Blatt). */
const SIDEWAYS = 18;
/** Zurückfedern, wenn der Zug nicht gereicht hat. */
const SPRING_BACK = { damping: 24, stiffness: 300, mass: 0.7 } as const;

export type SheetDragOptions = {
  /** Wird gerufen, sobald die Geste als „schließen" gilt; das Blatt fährt dabei hinaus. */
  onDismiss: () => void;
  /**
   * Ob das Blatt gerade offen ist. Beim Wechsel auf `true` wird zurückgesetzt –
   * sonst stünde das Blatt beim zweiten Öffnen noch dort, wo es weggewischt wurde.
   */
  open?: boolean;
};

/**
 * Alles, was ein Blatt zum Wegwischen braucht:
 *
 *  - `headGesture` an Griff und Kopfzeile (oder ans ganze Blatt ohne Liste),
 *  - `listGesture` über die Liste, `scrollGesture` um die Liste selbst,
 *  - `onScroll` an die Liste (`Animated.ScrollView`, merkt sich den Scrollstand),
 *  - `sheetStyle` und `onSheetLayout` aufs Blatt, `backdropStyle` auf den Schleier.
 */
export function useSheetDrag({ onDismiss, open }: SheetDragOptions) {
  const { height: windowHeight } = useWindowDimensions();
  const dragY = useSharedValue(0);
  const scrollY = useSharedValue(0);
  const sheetHeight = useSharedValue(0);
  /** Darf dieser Zug das Blatt bewegen? (Liste stand beim Aufsetzen oben.) */
  const allowed = useSharedValue(false);
  /** Fährt gerade hinaus – dann zieht kein weiterer Finger mehr. */
  const closing = useSharedValue(false);

  useEffect(() => {
    if (!open) return;
    closing.set(false);
    dragY.set(0);
    scrollY.set(0);
  }, [open, closing, dragY, scrollY]);

  const scrollGesture = useMemo(() => Gesture.Native(), []);

  const { headGesture, listGesture } = useMemo(() => {
    const make = (fromList: boolean) =>
      Gesture.Pan()
        .activeOffsetY(DRAG_START)
        .failOffsetX([-SIDEWAYS, SIDEWAYS])
        .onStart(() => {
          allowed.set(!closing.get() && (!fromList || scrollY.get() <= 1));
        })
        .onUpdate((event) => {
          if (allowed.get()) dragY.set(Math.max(0, event.translationY));
        })
        .onEnd((event, success) => {
          if (!allowed.get() || closing.get()) return;
          allowed.set(false);
          const height = sheetHeight.get() > 0 ? sheetHeight.get() : windowHeight;
          if (success && shouldDismiss(dragY.get(), event.velocityY, height)) {
            closing.set(true);
            // Sofort schließen und das Blatt dabei weiter hinausfahren lassen – nicht
            // auf das Ende der Animation warten: Wird sie unterbrochen (oder läuft
            // gar nicht, etwa ohne Bildaufbau), bliebe das Blatt sonst offen stehen.
            dragY.set(withTiming(height, { duration: 190, easing: Easing.in(Easing.quad) }));
            scheduleOnRN(onDismiss);
          } else {
            dragY.set(withSpring(0, SPRING_BACK));
          }
        });
    return {
      headGesture: make(false),
      listGesture: make(true).simultaneousWithExternalGesture(scrollGesture),
    };
  }, [allowed, closing, dragY, scrollY, sheetHeight, windowHeight, onDismiss, scrollGesture]);

  const onScroll = useAnimatedScrollHandler((event) => {
    scrollY.set(event.contentOffset.y);
  });

  const sheetStyle = useAnimatedStyle<ViewStyle>(() => ({ transform: [{ translateY: dragY.value }] }));
  const backdropStyle = useAnimatedStyle<ViewStyle>(() => {
    const height = sheetHeight.value > 0 ? sheetHeight.value : windowHeight;
    return { opacity: interpolate(dragY.value, [0, height], [1, 0.15], 'clamp') };
  });

  const onSheetLayout = useCallback((event: LayoutChangeEvent) => sheetHeight.set(event.nativeEvent.layout.height), [sheetHeight]);

  return { headGesture, listGesture, scrollGesture, onScroll, sheetStyle, backdropStyle, onSheetLayout };
}
