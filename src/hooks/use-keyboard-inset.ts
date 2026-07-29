import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

/**
 * Höhe der Tastatur (0 = zu).
 *
 * Für Flächen, die NICHT in einem {@link KeyboardForm} liegen – vor allem
 * Blätter in einem `Modal`, die am unteren Rand kleben. Dort gibt es keine
 * ScrollView, die etwas freischieben könnte; der Wert wandert stattdessen in
 * den unteren Innenabstand.
 *
 * Absichtlich ohne `LayoutAnimation`: die baut auf Android (Fabric) die Views
 * neu auf, wodurch das fokussierte Feld die Tastatur sofort wieder verliert.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    // iOS kündigt an („will"), Android meldet erst hinterher („did").
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const subs = [
      Keyboard.addListener(showEvent, (event) => {
        setInset(Math.max(0, event.endCoordinates?.height ?? 0));
      }),
      Keyboard.addListener(hideEvent, () => setInset(0)),
    ];

    return () => subs.forEach((sub) => sub.remove());
  }, []);

  return inset;
}
