import { LinearGradient } from 'expo-linear-gradient';
import { ActivityIndicator, Pressable, StyleSheet, Text, type PressableProps } from 'react-native';

import { GlassSurface } from '@/components/ui/glass';
import { BrandGradient, FontFamily, Radius, Spacing } from '@/constants/theme';
import { useBrandSurface } from '@/hooks/use-theme';

export type BrandButtonProps = Omit<PressableProps, 'children' | 'style'> & {
  title: string;
  loading?: boolean;
  /**
   * `primary` = gefüllter Verlauf (eine Hauptaktion pro Bildschirm),
   * `glass` = Glasfläche mit Akzentschrift für alles Zweitrangige.
   */
  variant?: 'primary' | 'glass';
};

/** Hauptknopf: Verlauf Indigo → Violett → Fuchsia, oder als Glasfläche. */
export function BrandButton({ title, loading, disabled, variant = 'primary', ...rest }: BrandButtonProps) {
  const surface = useBrandSurface();
  const inactive = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(inactive), busy: Boolean(loading) }}
      disabled={inactive}
      style={({ pressed }) => ({ opacity: inactive ? 0.55 : pressed ? 0.9 : 1 })}
      {...rest}>
      {variant === 'glass' ? (
        <GlassSurface tone="panel" radius={Radius.field} style={styles.button}>
          {loading ? (
            <ActivityIndicator color={surface.accent} />
          ) : (
            <Text style={[styles.text, { color: surface.accent }]}>{title}</Text>
          )}
        </GlassSurface>
      ) : (
        <LinearGradient
          colors={[...BrandGradient]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.button, styles.filled]}>
          {loading ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.text}>{title}</Text>}
        </LinearGradient>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    borderRadius: Radius.field,
    minHeight: 52,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filled: {
    // Der Verlauf trägt die Fläche – hier bewusst kein zusätzlicher Schatten.
    overflow: 'hidden',
  },
  text: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
    fontFamily: FontFamily.bold,
  },
});
