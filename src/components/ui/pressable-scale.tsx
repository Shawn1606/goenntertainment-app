/**
 * Ein Druckknopf, der auf den Finger reagiert – mit Feder statt Schalter.
 *
 * Vorher lag über allen Karten `pressed && { opacity: 0.7 }`. Das schaltet hart
 * um: Der Inhalt wird blass und springt zurück. Eine Feder, die um 2–3 %
 * einsinkt und wieder aufgeht, liest sich stattdessen als „gedrückt" – dieselbe
 * Information, aber sie fühlt sich nach Material an statt nach CSS.
 *
 * Warum das mehr als Kosmetik ist: Rückmeldung innerhalb von ~100 ms ist der
 * Grund, aus dem niemand ein zweites Mal tippt. Genau daraus entstehen sonst
 * Doppel-Beitritte und der Eindruck, die App hänge.
 *
 * Haptik ist eingebaut, aber abwählbar (`haptic="none"`): In einer Liste soll
 * jede Karte einen Stoß geben, aber nicht jede Karte und zusätzlich der Knopf
 * darin.
 */
import type { ReactNode } from 'react';
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import * as haptics from '@/lib/haptics';

/** Knapp und straff: soll wie Material wirken, nicht wie Gummi. */
const SPRING = { damping: 18, stiffness: 320, mass: 0.5 } as const;

export type PressableScaleProps = Omit<PressableProps, 'style' | 'children'> & {
  children: ReactNode;
  /** Wie weit eingesunken wird. Große Flächen brauchen weniger als kleine. */
  scaleTo?: number;
  /** Welcher Stoß beim Drücken. `none` für verschachtelte Knöpfe. */
  haptic?: 'select' | 'tap' | 'press' | 'none';
  style?: StyleProp<ViewStyle>;
};

export function PressableScale({
  children,
  scaleTo = 0.97,
  haptic = 'tap',
  style,
  onPressIn,
  onPressOut,
  disabled,
  ...rest
}: PressableScaleProps) {
  const reduced = useReducedMotion();
  const scale = useSharedValue(1);
  const dim = useSharedValue(0);

  const animated = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    // Ein Hauch Abdunkeln zusätzlich zur Bewegung: Auf großen, hellen Flächen
    // ist die Skalierung allein kaum zu sehen.
    opacity: 1 - dim.value * 0.12,
  }));

  return (
    <Pressable
      disabled={disabled}
      onPressIn={(event) => {
        if (!disabled) {
          if (haptic === 'select') haptics.select();
          else if (haptic === 'tap') haptics.tap();
          else if (haptic === 'press') haptics.press();

          // Bei „Bewegung reduzieren" bleibt das Abdunkeln als Rückmeldung –
          // ganz ohne Reaktion wüsste man nicht, ob der Tipp angekommen ist.
          scale.set(reduced ? 1 : withSpring(scaleTo, SPRING));
          dim.set(withTiming(1, { duration: 90 }));
        }
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        scale.set(withSpring(1, SPRING));
        dim.set(withTiming(0, { duration: 160 }));
        onPressOut?.(event);
      }}
      {...rest}>
      <Animated.View style={[style, animated]}>{children}</Animated.View>
    </Pressable>
  );
}
