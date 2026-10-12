/**
 * Ein Lichtband, das quer über eine Fläche zieht – auf den Stempeln einer vollen Karte
 * (stamp-card.tsx).
 *
 * Grundregel: **Bewegung ist ein Signal, keine Deko.** Sie markiert genau die Stellen, an
 * denen gerade etwas passiert oder etwas zu holen ist. Überall sonst bleibt die App ruhig –
 * sonst gewöhnt sich das Auge daran, und das Schimmern sagt nichts mehr aus.
 *
 * „Bewegung reduzieren" wird beachtet (`useStill()`): Wer es im System gesetzt hat, sieht
 * die Fläche ruhig. Dasselbe gilt für Seiten, die gerade nicht vorn sind
 * (src/components/ui/motion-pause.tsx).
 */
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { useBeat, useStill } from '@/components/ui/motion-pause';

export type ShimmerProps = {
  /** Farbe des Lichtbandes – meist Weiß bzw. Schwarz mit kleiner Deckkraft. */
  color: string;
  radius?: number;
  durationMs?: number;
  /** Ruhe nach jedem Durchzug (ms). 0 = durchgehend. */
  restMs?: number;
  style?: StyleProp<ViewStyle>;
};

/**
 * Ein Lichtband, das einmal quer über die Fläche zieht – mit `restMs` im Takt und mit
 * Pausen dazwischen, sonst durchgehend. Legt sich über sein Elternelement (absolut).
 */
export function Shimmer({ color, radius = 0, durationMs = 1500, restMs = 0, style }: ShimmerProps) {
  // Steht still bei „Bewegung reduzieren" UND solange die Seite nicht vorn ist (motion-pause.tsx).
  const reduced = useStill();
  const [width, setWidth] = useState(0);
  const x = useSharedValue(0);
  const running = width > 0 && !reduced;

  // Ohne Pause (`restMs` 0, etwa „lädt noch"): durchgehend.
  useEffect(() => {
    cancelAnimation(x);
    x.value = 0;
    if (!running || restMs > 0) return;
    x.value = withRepeat(withTiming(1, { duration: durationMs, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(x);
  }, [running, durationMs, restMs, x]);
  // Mit Pause im Takt (motion-pause.tsx): einmal durchziehen, dann ruht das Band
  // draußen und unsichtbar – und bis zum nächsten Mal läuft gar nichts.
  useBeat(
    () => {
      x.set(withSequence(withTiming(0, { duration: 0 }), withTiming(1, { duration: durationMs, easing: Easing.linear })));
    },
    durationMs + restMs,
    running && restMs > 0,
    0,
  );

  const sweep = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(x.value, [0, 1], [-width, width]) }],
  }));

  const onLayout = (event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.width);
    setWidth((prev) => (prev === next ? prev : next));
  };

  return (
    <View
      pointerEvents="none"
      onLayout={onLayout}
      style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: 'hidden' }, style]}>
      <Animated.View style={[styles.band, sweep]}>
        <LinearGradient
          colors={['transparent', color, 'transparent']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  // 60 % der Breite: schmal genug, dass es als Lichtband liest, breit genug,
  // dass der Verlauf weich bleibt.
  band: {
    width: '60%',
    height: '100%',
  },
});
