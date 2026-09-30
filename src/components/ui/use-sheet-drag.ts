/**
 * Nach unten wischen, um ein Blatt zu schließen – die Geste, einmal gebaut.
 *
 * ## Warum das ein eigener Baustein ist
 *
 * Diese Geste steckte vollständig in `account-widget.tsx`: rund sechzig Zeilen
 * PanResponder, zwei Zugänge, Schwellwerte, Web-Sonderfall. Das Detail-Blatt zu
 * einem Event brauchte dieselbe Geste – und damit gab es genau zwei Wege: die
 * Zeilen kopieren, oder sie hierher ziehen.
 *
 * Kopiert wäre der Fehler gewesen, den man erst Monate später sieht: Zwei
 * Blätter, die sich unterschiedlich anfühlen, weil jemand einen Schwellwert an
 * einer Stelle nachjustiert hat.
 *
 * ## Was hier drin ist und was nicht
 *
 * Drin: die Geste, die Schwellwerte, der Animationswert und die Frage, wann ein
 * Zug ein Wischen ist. **Nicht** drin: Aussehen, Weichzeichner, Modal-Rahmen,
 * Zurück-Taste. Das unterscheidet die beiden Blätter tatsächlich, und ein Hook,
 * der auch das übernimmt, hätte für jeden Unterschied einen Schalter.
 *
 * ## Die zwei Zugänge
 *
 * `headPan` und `listPan` sehen fast gleich aus, sind aber nicht dasselbe:
 *  - **`headPan`** hängt an festen Teilen (Griff, Kopfzeile). Dort ist keine
 *    Liste im Weg, also reicht die einfache Fassung.
 *  - **`listPan`** liegt über einer Liste und muss ihr die Bewegung *abnehmen*
 *    (`…Capture`) – aber nur, wenn sie schon ganz oben steht. Sonst könnte man
 *    nicht mehr nach oben scrollen, ohne das Blatt zuzuziehen.
 */
import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import {
  Animated,
  PanResponder,
  Platform,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type PanResponderGestureState,
} from 'react-native';

/** Ab so vielen Punkten Zug nach unten gilt das Blatt als weggewischt … */
const DISMISS_DISTANCE = 110;
/** … oder ab diesem Tempo, auch wenn der Weg kurz war. */
const DISMISS_VELOCITY = 0.7;
/** Darunter ist es noch ein Tippen und kein Wischen. */
const DRAG_SLOP = 12;

/**
 * Wischen ist eine Geste mit Finger – die gibt es so nur am Gerät. Im Web setzen
 * wir darum Endwerte direkt, statt sie anzufahren: `Animated`-Läufe rühren sich
 * im Web-Build dieser App nicht, `setValue` greift dagegen sofort.
 */
const NATIVE = Platform.OS !== 'web';

/** Wie weit das Blatt beim Wegwischen mindestens nach unten fährt. */
const FALLBACK_HEIGHT = 600;

export type SheetDrag = {
  /** Wie weit das Blatt gerade nach unten gezogen ist (0 = Ruhelage). */
  dragY: Animated.Value;
  /** An feste Teile hängen: Griff, Kopfzeile. */
  headPan: ReturnType<typeof PanResponder.create>;
  /** Über eine Liste legen – nimmt ihr die Geste nur ab, wenn sie oben steht. */
  listPan: ReturnType<typeof PanResponder.create>;
  /** Auf das Blatt selbst: liefert die Höhe, um die es hinausfährt. */
  onSheetLayout: (event: LayoutChangeEvent) => void;
  /** An die Liste: merkt sich den Scrollstand für `listPan`. */
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  /** Alles auf Anfang – beim Öffnen aufrufen. */
  reset: () => void;
};

export type SheetDragOptions = {
  /** Wird gerufen, wenn die Geste als „schließen" gilt. */
  onDismiss: () => void;
  /**
   * Ob das Blatt gerade offen ist. Beim Wechsel auf `true` wird zurückgesetzt –
   * sonst stünde das Blatt beim zweiten Öffnen noch dort, wo es weggewischt wurde.
   */
  open?: boolean;
};

/**
 * The gesture itself, outside React: plain closure variables instead of refs,
 * so the React Compiler can check and memoise `useSheetDrag`. Created once per
 * sheet (lazy `useState` initialiser) and kept for the component's lifetime -
 * exactly like the previous `useRef` + null check.
 */
function createSheetGesture(dragY: Animated.Value) {
  /** Höhe des Blattes – so weit fährt es beim Wegwischen nach unten raus. */
  let sheetHeight = 0;
  /** Scrollstand der Liste: Wischen greift nur, wenn sie ganz oben steht. */
  let scrollOffset = 0;
  /**
   * `onDismiss` in einem Kasten. Die PanResponder werden einmal gebaut und
   * behalten; würden sie die Funktion direkt einfangen, hielten sie für immer die
   * erste Fassung fest – und schlössen später das falsche Blatt.
   */
  let onDismiss: () => void = () => {};

  /** Der Zug war zu kurz: zurück in die Ruhelage. */
  const settle = () => {
    if (!NATIVE) {
      dragY.setValue(0);
      return;
    }
    Animated.spring(dragY, { toValue: 0, useNativeDriver: true, bounciness: 2, speed: 16 }).start();
  };

  /**
   * Weggewischt: nach unten aus dem Bild fahren, während das Blatt ausblendet.
   * Beides gleichzeitig – so wischt es wirklich weg, statt an Ort und Stelle zu
   * verschwinden.
   */
  const dismiss = () => {
    if (NATIVE) {
      Animated.timing(dragY, {
        toValue: sheetHeight || FALLBACK_HEIGHT,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
    onDismiss();
  };

  /** Ein Zug nach unten – und nicht bloß ein Wackeln beim Tippen. */
  const isDownwardDrag = (g: PanResponderGestureState) =>
    g.dy > DRAG_SLOP && g.dy > Math.abs(g.dx) * 1.5;

  /** Ende der Geste: weit oder schnell genug → weg, sonst zurück. */
  const release = (g: PanResponderGestureState) => {
    if (g.dy > DISMISS_DISTANCE || g.vy > DISMISS_VELOCITY) dismiss();
    else settle();
  };

  return {
    headPan: PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => isDownwardDrag(g),
      onPanResponderMove: (_e, g) => dragY.setValue(g.dy),
      onPanResponderRelease: (_e, g) => release(g),
      onPanResponderTerminate: () => settle(),
    }),
    listPan: PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_e, g) => isDownwardDrag(g) && scrollOffset <= 0,
      onPanResponderMove: (_e, g) => dragY.setValue(g.dy),
      onPanResponderRelease: (_e, g) => release(g),
      onPanResponderTerminate: () => settle(),
    }),
    setOnDismiss: (next: () => void) => {
      onDismiss = next;
    },
    setSheetHeight: (height: number) => {
      sheetHeight = height;
    },
    setScrollOffset: (offset: number) => {
      scrollOffset = offset;
    },
  };
}

export function useSheetDrag({ onDismiss, open }: SheetDragOptions): SheetDrag {
  const [dragY] = useState(() => new Animated.Value(0));
  const [gesture] = useState(() => createSheetGesture(dragY));

  // Latest `onDismiss`, handed over after each commit (not during render).
  // Gestures only fire after commit, so they always call the current one.
  useLayoutEffect(() => {
    gesture.setOnDismiss(onDismiss);
  }, [gesture, onDismiss]);

  const reset = useCallback(() => {
    // Die Liste startet oben. Ohne diese Zeile müsste der Merker das erst durch
    // ein Scrollen erfahren – und bis dahin ließe sich nicht wischen.
    gesture.setScrollOffset(0);
    dragY.setValue(0);
  }, [gesture, dragY]);

  useEffect(() => {
    if (open) reset();
  }, [open, reset]);

  const onSheetLayout = useCallback(
    (event: LayoutChangeEvent) => gesture.setSheetHeight(event.nativeEvent.layout.height),
    [gesture],
  );
  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) =>
      gesture.setScrollOffset(event.nativeEvent.contentOffset.y),
    [gesture],
  );

  return {
    dragY,
    headPan: gesture.headPan,
    listPan: gesture.listPan,
    onSheetLayout,
    onScroll,
    reset,
  };
}
