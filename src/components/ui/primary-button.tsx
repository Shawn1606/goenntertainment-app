import { ActivityIndicator, Pressable, StyleSheet, type PressableProps } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type PrimaryButtonProps = Omit<PressableProps, 'children'> & {
  title: string;
  loading?: boolean;
  variant?: 'primary' | 'secondary';
};

export function PrimaryButton({ title, loading, variant = 'primary', disabled, style, ...rest }: PrimaryButtonProps) {
  const theme = useTheme();
  const isSecondary = variant === 'secondary';

  return (
    <Pressable
      disabled={disabled || loading}
      style={(state) => [
        styles.button,
        {
          backgroundColor: isSecondary ? theme.backgroundElement : theme.tint,
          opacity: disabled || loading ? 0.6 : state.pressed ? 0.85 : 1,
        },
        typeof style === 'function' ? style(state) : style,
      ]}
      {...rest}>
      {loading ? (
        <ActivityIndicator color={isSecondary ? theme.text : theme.tintText} />
      ) : (
        <ThemedText type="smallBold" style={{ color: isSecondary ? theme.text : theme.tintText, fontSize: 16 }}>
          {title}
        </ThemedText>
      )}
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
});
