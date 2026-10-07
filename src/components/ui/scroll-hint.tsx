import { useEffect, useState } from 'react';
import { Animated, Platform, Pressable, StyleSheet } from 'react-native';

import { ChevronLeftIcon, ChevronRightIcon } from '@/components/ui/icons';
import { Spacing } from '@/constants/theme';
import { useBrandSurface } from '@/hooks/use-theme';

/** Am Gerät nativer Treiber, im Browser JS – wie im Anmelde-Hintergrund. */
const NATIVE_DRIVER = Platform.OS !== 'web';

/**
 * Der Wisch-Hinweis: ein kleiner Pfeil am Rand einer waagerechten Reihe.
 *
 * Warum überhaupt? Eine Reihe, die rechts einfach am Bildschirmrand endet, sieht
 * aus wie eine Reihe, die dort aufhört. Der Pfeil macht sichtbar, dass da noch
 * mehr liegt – und wer nicht wischen mag, tippt ihn einfach an. Er blendet sich
 * weg, sobald es in seine Richtung nichts mehr zu holen gibt.
 *
 * Liegt in `ui/`, weil ihn zwei Reihen brauchen: das Regal mit Karten
 * (`activity-shelf.tsx`) und die Kategorie-Spalten (`category-columns.tsx`).
 * Zweimal dasselbe Verhalten mit zwei Ausblendzeiten wäre an genau der Stelle
 * verschieden, an der es niemandem auffällt und alle es spüren.
 */
export function ScrollHint({
  side,
  visible,
  onPress,
  label,
}: {
  side: 'left' | 'right';
  visible: boolean;
  onPress: () => void;
  /** Was Screenreader vorlesen – ohne Angabe „zurück"/„weiter". */
  label?: string;
}) {
  const surface = useBrandSurface();
  const [opacity] = useState(() => new Animated.Value(visible ? 1 : 0));

  // Weich ein- und ausblenden statt hart umschalten: Der Pfeil erscheint und
  // verschwindet mitten in einer Wischbewegung, ein Aufblitzen würde stören.
  useEffect(() => {
    Animated.timing(opacity, {
      toValue: visible ? 1 : 0,
      duration: 180,
      useNativeDriver: NATIVE_DRIVER,
    }).start();
  }, [visible, opacity]);

  return (
    <Animated.View
      // Unsichtbar heißt auch unantastbar – sonst fängt der Pfeil am Ende der
      // Reihe weiter Tipper ab, die auf die Karte darunter zielen.
      pointerEvents={visible ? 'box-none' : 'none'}
      style={[styles.hint, side === 'left' ? styles.hintLeft : styles.hintRight, { opacity }]}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label ?? (side === 'left' ? 'Zurück' : 'Weiter')}
        hitSlop={8}
        style={({ pressed }) => [
          styles.hintButton,
          { backgroundColor: surface.card, borderColor: surface.cardBorder },
          pressed && styles.hintPressed,
        ]}>
        {side === 'left' ? (
          <ChevronLeftIcon size={18} color={surface.accent} />
        ) : (
          <ChevronRightIcon size={18} color={surface.accent} />
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Senkrecht mittig über der Reihe, waagerecht knapp am Rand.
  hint: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  hintLeft: { left: Spacing.one },
  hintRight: { right: Spacing.one },
  hintButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth * 2,
    ...Platform.select({
      android: { elevation: 3 },
      default: {
        shadowColor: 'rgba(23,23,23,0.28)',
        shadowOpacity: 1,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
      },
    }),
  },
  hintPressed: { opacity: 0.7, transform: [{ scale: 0.92 }] },
});
