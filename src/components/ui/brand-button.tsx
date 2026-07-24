import { LinearGradient } from 'expo-linear-gradient';
import { ActivityIndicator, Pressable, StyleSheet, Text, type PressableProps } from 'react-native';

import { BrandGradient, Spacing } from '@/constants/theme';

export type BrandButtonProps = Omit<PressableProps, 'children' | 'style'> & {
  title: string;
  loading?: boolean;
};

/** Primär-Button im Marken-Verlauf (Lila → Pink), wie `auth-btn-primary` im Web. */
export function BrandButton({ title, loading, disabled, ...rest }: BrandButtonProps) {
  return (
    <Pressable
      disabled={disabled || loading}
      style={({ pressed }) => ({ opacity: disabled || loading ? 0.6 : pressed ? 0.9 : 1 })}
      {...rest}>
      <LinearGradient
        colors={BrandGradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.button}>
        {loading ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <Text style={styles.text}>{title}</Text>
        )}
      </LinearGradient>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    borderRadius: 16,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
});
