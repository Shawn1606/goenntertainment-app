/**
 * Goenni zum Anfassen: Figur mit Sprechblase, die auf Antippen reagiert.
 *
 * Tippt man ihn an, springt er, schaut kurz begeistert und sagt den nächsten
 * Satz aus `tips` – Hinweise, die zu deinem Stand passen (src/domain/mascot-tips.ts).
 * Nach ein paar Sekunden wechselt er von selbst weiter, aber langsam: Er soll
 * begleiten, nicht ablenken.
 */
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

import { Mascot, type MascotMood } from '@/components/mascot';
import { PressableScale } from '@/components/ui/pressable-scale';
import { FontFamily, Radius, Spacing, Stroke } from '@/constants/theme';
import { tipAt, type Tip } from '@/domain/mascot-tips';
import { useTheme } from '@/hooks/use-theme';
import * as haptics from '@/lib/haptics';

/** So lange steht ein Satz, bevor der nächste kommt. */
const ROTATE_MS = 9000;

export function MascotBuddy({
  tips,
  size = 72,
  tone = 'plain',
  style,
}: {
  tips: Tip[];
  size?: number;
  /** `night` = auf dem Lila des Club-Kopfes (heller Text, dunkle Blase). */
  tone?: 'plain' | 'night';
  style?: StyleProp<ViewStyle>;
}) {
  const colors = useTheme();
  const reduced = useReducedMotion();
  const [step, setStep] = useState(0);
  const [jumpKey, setJumpKey] = useState(0);
  const [excited, setExcited] = useState<MascotMood | null>(null);
  const excitedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (reduced || tips.length < 2) return;
    const timer = setInterval(() => setStep((s) => s + 1), ROTATE_MS);
    return () => clearInterval(timer);
  }, [reduced, tips.length]);

  useEffect(() => () => {
    if (excitedTimer.current) clearTimeout(excitedTimer.current);
  }, []);

  const tip = tipAt(tips, step);

  /**
   * Neuer Satz = kurz einblenden; der erste Satz steht sofort da. Bewusst kein
   * `entering` (Layout-Animation) mit `key`: Das baute die Blase bei jedem Satz
   * neu auf und startete jedes Mal bei Deckkraft 0.
   */
  const fade = useSharedValue(1);
  useEffect(() => {
    if (reduced || step === 0) return;
    fade.value = 0;
    fade.value = withTiming(1, { duration: 260 });
  }, [step, reduced, fade]);
  const fadeStyle = useAnimatedStyle(() => ({ opacity: fade.value }));

  const poke = () => {
    haptics.press();
    setStep((s) => s + 1);
    setJumpKey((k) => k + 1);
    setExcited('cheer');
    if (excitedTimer.current) clearTimeout(excitedTimer.current);
    excitedTimer.current = setTimeout(() => setExcited(null), 1400);
  };

  const night = tone === 'night';

  return (
    <View style={[styles.row, style]}>
      <PressableScale onPress={poke} haptic="none" scaleTo={0.94} accessibilityRole="button" accessibilityLabel={`Goenni: ${tip.line}. Antippen für den nächsten Tipp.`}>
        <Mascot mood={excited ?? tip.mood} size={size} gesture="wave" jumpKey={jumpKey} waves={excited !== null} />
      </PressableScale>
      <Animated.View
        style={[
          fadeStyle,
          styles.bubble,
          night
            ? { backgroundColor: '#4b1b78', borderColor: 'rgba(255,255,255,0.3)' }
            : { backgroundColor: colors.background, borderColor: colors.border },
        ]}>
        <View
          style={[
            styles.tail,
            night
              ? { backgroundColor: '#4b1b78', borderColor: 'rgba(255,255,255,0.3)' }
              : { backgroundColor: colors.background, borderColor: colors.border },
          ]}
        />
        <Text style={[styles.text, { color: night ? '#ffffff' : colors.text }]} numberOfLines={3}>
          {tip.line}
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  bubble: {
    flex: 1,
    borderWidth: Stroke,
    borderRadius: Radius.card,
    paddingVertical: Spacing.two + 2,
    paddingHorizontal: Spacing.three,
  },
  /** Das Spitzchen zur Figur hin: ein gedrehtes Quadrat mit zwei Kanten. */
  tail: {
    position: 'absolute',
    left: -6,
    top: '50%',
    marginTop: -6,
    width: 12,
    height: 12,
    borderLeftWidth: Stroke,
    borderBottomWidth: Stroke,
    transform: [{ rotate: '45deg' }],
  },
  text: { fontFamily: FontFamily.semibold, fontSize: 14, lineHeight: 19 },
});
