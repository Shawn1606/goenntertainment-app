import { useEffect } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { CategoryIcon } from '@/components/ui/category-icon';
import { Entrance } from '@/components/ui/entrance';
import { PressableScale } from '@/components/ui/pressable-scale';
import { FontFamily, Radius, Spacing } from '@/constants/theme';
import { useBrandSurface, useGlass } from '@/hooks/use-theme';
import type { Interest } from '@/lib/api';

export type CategoryStripProps = {
  interests: Interest[];
  /** Aktuell gewählte Kategorien (aus dem Filter). */
  selectedIds: number[];
  /** Kategorie an-/abwählen – setzt denselben Filter wie die Filterleiste. */
  onToggle: (id: number) => void;
};

/**
 * Kategorien als Kacheln zum Durchwischen – der schnelle Einstieg ins Stöbern
 * („Worauf hast du Lust?").
 *
 * Bewusst dieselbe Filter-Quelle wie die Filterleiste: hier tippen und dort
 * einen Haken setzen führt zum selben Ergebnis, es gibt keinen zweiten Zustand.
 *
 * ## Bewegung
 *
 * Zwei Dinge, beide mit Grund:
 *  - **Beim Erscheinen** laufen die Kacheln von links nachgestaffelt ein. Das
 *    ist der einzige Hinweis darauf, dass die Reihe seitlich weitergeht – ohne
 *    ihn wirkt sie wie eine abgeschnittene Liste.
 *  - **Beim Auswählen** wächst die Kachel kurz über ihre Größe hinaus und
 *    kommt dann zurück. Vorher wechselte nur die Farbe; das übersieht man,
 *    wenn der Finger genau darauf liegt.
 */
export function CategoryStrip({ interests, selectedIds, onToggle }: CategoryStripProps) {
  const surface = useBrandSurface();
  const glass = useGlass();

  if (interests.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.track}
      accessibilityRole="tablist">
      {interests.map((interest, index) => (
        <Entrance key={interest.id} index={index}>
          <CategoryTile
            interest={interest}
            selected={selectedIds.includes(interest.id)}
            onPress={() => onToggle(interest.id)}
            surface={surface}
            borderColor={glass.border}
          />
        </Entrance>
      ))}
    </ScrollView>
  );
}

type Surface = ReturnType<typeof useBrandSurface>;

/**
 * Eine Kachel. Eigene Komponente, weil jede ihren eigenen Animationswert
 * braucht – in der Schleife oben ginge das nicht (Hooks in Schleifen).
 */
function CategoryTile({
  interest,
  selected,
  onPress,
  surface,
  borderColor,
}: {
  interest: Interest;
  selected: boolean;
  onPress: () => void;
  surface: Surface;
  borderColor: string;
}) {
  const reduced = useReducedMotion();
  const pop = useSharedValue(0);

  // Nur beim Wechsel VON abgewählt ZU gewählt hüpfen. Beim Abwählen wäre eine
  // Belohnungsbewegung widersprüchlich.
  useEffect(() => {
    if (!selected || reduced) {
      pop.value = 0;
      return;
    }
    pop.value = withSpring(1, { damping: 9, stiffness: 300, mass: 0.5 });
  }, [selected, reduced, pop]);

  const animated = useAnimatedStyle(() => ({
    // 1 + 6 % im Ausschlag, danach hält die Feder bei 1.
    transform: [{ scale: 1 + pop.value * 0.06 }],
  }));

  return (
    <PressableScale
      onPress={onPress}
      haptic="none" // Die Auswahl meldet der Aufrufer über `feedback.selected()`.
      scaleTo={0.94}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={styles.tile}>
      <Animated.View
        style={[
          styles.bubble,
          {
            backgroundColor: selected ? surface.accent : surface.chipBg,
            borderColor: selected ? surface.accent : borderColor,
          },
          animated,
        ]}>
        <CategoryIcon
          interest={interest}
          size={26}
          color={selected ? surface.accentText : surface.accent}
        />
      </Animated.View>
      <Text
        numberOfLines={2}
        style={[styles.label, { color: selected ? surface.accent : surface.textMuted }]}>
        {interest.name}
      </Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  track: {
    paddingHorizontal: Spacing.four,
    gap: Spacing.three,
    paddingVertical: Spacing.half,
  },
  tile: {
    width: 76,
    alignItems: 'center',
    gap: Spacing.two,
  },
  bubble: {
    width: 58,
    height: 58,
    borderRadius: Radius.panel,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 11,
    lineHeight: 14,
    textAlign: 'center',
    fontWeight: '600',
    fontFamily: FontFamily.semibold,
  },
});
