import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { PressableScale } from '@/components/ui/pressable-scale';
import { Night, Radius, Spacing, Stroke } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type CardTone = 'plain' | 'night' | 'soft';

export type CardProps = {
  children: ReactNode;
  /**
   * `plain` = weiße Karte mit Kontur (Standard),
   * `night` = das Lila des Instagram-Auftritts (Club, Stempel, Höhepunkte),
   * `soft`  = leicht getönte Fläche für Zweitrangiges.
   */
  tone?: CardTone;
  onPress?: () => void;
  accessibilityLabel?: string;
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
};

/**
 * Die Karte der App.
 *
 * ## Warum Kontur UND leichter Schatten
 *
 * Vorher trugen Karten eine Haarlinie auf fast weißem Grund – auf vielen
 * Displays verschwand die Kante, und Karten schwammen ineinander. Jetzt hat jede
 * Karte eine sichtbare Kontur (1,5 px, `Stroke`) und darunter einen kaum
 * sichtbaren Schatten nach unten. Die Kontur trennt, der Schatten hebt an – so
 * liest sich eine Karte als Gegenstand, den man antippen kann.
 */
export function Card({ children, tone = 'plain', onPress, accessibilityLabel, padded = true, style }: CardProps) {
  const colors = useTheme();

  const frame: StyleProp<ViewStyle> = [
    styles.card,
    padded && styles.padded,
    tone === 'plain' && { backgroundColor: colors.background, borderColor: colors.border },
    tone === 'soft' && { backgroundColor: colors.backgroundElement, borderColor: colors.border },
    tone === 'night' && styles.night,
    style,
  ];

  const body = (
    <View style={frame}>
      {tone === 'night' ? (
        <LinearGradient
          colors={[...Night.gradient]}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 0.9, y: 1 }}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
      ) : null}
      {children}
    </View>
  );

  if (!onPress) return body;

  return (
    <PressableScale onPress={onPress} scaleTo={0.98} accessibilityRole="button" accessibilityLabel={accessibilityLabel}>
      {body}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.card,
    borderWidth: Stroke,
    overflow: 'hidden',
    ...Platform.select({
      android: { elevation: 1 },
      default: {
        shadowColor: '#1c0833',
        shadowOpacity: 0.06,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
      },
    }),
  },
  padded: { padding: Spacing.three },
  night: { borderColor: Night.line, backgroundColor: Night.mid },
});
