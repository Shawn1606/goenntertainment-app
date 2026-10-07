/**
 * Goenni zum Anfassen: Figur mit Sprechblase, die auf Antippen reagiert.
 *
 * Er ist lebendig (zeigt von selbst Kunststücke). Tippt man ihn an, macht er
 * sofort eines der großen – Salto, Tanz, Drehung, Jubel –, schaut begeistert
 * und sagt den nächsten Satz aus `tips` – Hinweise, die zu deinem Stand passen (src/domain/mascot-tips.ts).
 * Von selbst wechselt der Satz NIE: Goenni redet nur, wenn man ihn antippt.
 *
 * Jedes dritte Antippen sagt er statt eines Tipps etwas Freches
 * (`pokeLine`, src/domain/mascot-lines.ts) – so lohnt sich das Stupsen. Hält
 * man ihn gedrückt, tanzt er.
 */
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

import { Mascot, type MascotMood, type MascotTrick } from '@/components/mascot';
import { PressableScale } from '@/components/ui/pressable-scale';
import { FontFamily, Radius, Spacing, Stroke } from '@/constants/theme';
import { pokeLine } from '@/domain/mascot-lines';
import { pokeReaction } from '@/domain/mascot-mood';
import { tipAt, type Tip } from '@/domain/mascot-tips';
import { useTheme } from '@/hooks/use-theme';
import * as haptics from '@/lib/haptics';

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
  const [pokes, setPokes] = useState(0);
  const [excited, setExcited] = useState<MascotMood | null>(null);
  /** Ein frecher Satz statt des Tipps – nach jedem dritten Antippen. */
  const [cheeky, setCheeky] = useState<Tip | null>(null);
  const [trick, setTrick] = useState<MascotTrick>('flip');
  const [trickKey, setTrickKey] = useState(0);
  const excitedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (excitedTimer.current) clearTimeout(excitedTimer.current);
  }, []);

  const tip = cheeky ?? tipAt(tips, step);

  /**
   * Neuer Satz = kurz einblenden; der erste Satz steht sofort da. Bewusst kein
   * `entering` (Layout-Animation) mit `key`: Das baute die Blase bei jedem Satz
   * neu auf und startete jedes Mal bei Deckkraft 0.
   */
  const fade = useSharedValue(1);
  useEffect(() => {
    if (reduced || step === 0) return;
    fade.set(0);
    fade.set(withTiming(1, { duration: 260 }));
  }, [step, reduced, fade]);
  const fadeStyle = useAnimatedStyle(() => ({ opacity: fade.value }));

  const poke = () => {
    haptics.press();
    const count = pokes + 1;
    if (count % 3 === 0) {
      setCheeky(pokeLine(count / 3));
    } else {
      setCheeky(null);
      setStep((s) => s + 1);
    }
    setPokes(count);
    // Jedes Antippen ein anderes Kunststück mit passendem Gesicht (src/domain/mascot-mood.ts).
    const reaction = pokeReaction(count);
    setTrick(reaction.trick);
    setTrickKey((k) => k + 1);
    setExcited(reaction.mood);
    if (excitedTimer.current) clearTimeout(excitedTimer.current);
    excitedTimer.current = setTimeout(() => setExcited(null), 1400);
  };

  const dance = () => {
    haptics.tap();
    setCheeky({ line: 'Musik an! Ich tanz für dich.', mood: 'cheer' });
    setTrick('dance');
    setTrickKey((k) => k + 1);
    setExcited('cheer');
    if (excitedTimer.current) clearTimeout(excitedTimer.current);
    excitedTimer.current = setTimeout(() => setExcited(null), 1600);
  };

  // Der freche Satz bleibt nicht ewig stehen.
  useEffect(() => {
    if (!cheeky) return;
    const timer = setTimeout(() => setCheeky(null), 5000);
    return () => clearTimeout(timer);
  }, [cheeky]);

  const night = tone === 'night';

  return (
    <View style={[styles.row, style]}>
      <PressableScale
        onPress={poke}
        onLongPress={dance}
        delayLongPress={450}
        haptic="none"
        scaleTo={0.94}
        accessibilityRole="button"
        accessibilityLabel={`Goenni: ${tip.line}${/[.!?…]$/.test(tip.line) ? '' : '.'} Antippen für den nächsten Tipp.`}>
        <Mascot
          mood={excited ?? tip.mood}
          size={size}
          lively
          trick={trick}
          trickKey={trickKey}
          waves={excited !== null}
        />
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
    // Platz für drei Zeilen, immer: Wechselt der Satz von zwei auf drei Zeilen,
    // rutschte sonst alles darunter mit.
    minHeight: 19 * 3 + (Spacing.two + 2) * 2 + Stroke * 2,
    justifyContent: 'center',
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
