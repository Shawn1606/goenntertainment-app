import { LinearGradient } from 'expo-linear-gradient';
import { ActivityIndicator, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { PressableScale } from '@/components/ui/pressable-scale';
import { BrandGradient, FontFamily, Radius, Spacing, Stroke } from '@/constants/theme';
import type { UiIconName } from '@/domain/ui-icon';
import { useTheme } from '@/hooks/use-theme';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'light';

export type ButtonProps = {
  title: string;
  onPress?: () => void;
  /**
   * `primary`   = Markenverlauf, die EINE Hauptaktion des Bildschirms,
   * `secondary` = Kontur, alles Zweitrangige,
   * `ghost`     = nur Schrift (Abbrechen, „Später"),
   * `danger`    = rote Kontur (Stornieren, Löschen),
   * `light`     = weiß auf dunkler Fläche (Club- und Stempelkarte).
   */
  variant?: ButtonVariant;
  icon?: UiIconName;
  loading?: boolean;
  disabled?: boolean;
  size?: 'large' | 'small';
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
};

const DANGER = '#e11d48';

/** Der Knopf der App – mit Feder, Haptik und klarer Kontur. */
export function Button({
  title,
  onPress,
  variant = 'primary',
  icon,
  loading = false,
  disabled = false,
  size = 'large',
  accessibilityLabel,
  style,
}: ButtonProps) {
  const colors = useTheme();
  const inactive = disabled || loading;

  const ink =
    variant === 'primary'
      ? '#ffffff'
      : variant === 'danger'
        ? DANGER
        : variant === 'light'
          ? '#1c0833'
          : variant === 'ghost'
            ? colors.textSecondary
            : colors.text;

  const content = (
    <View style={styles.row}>
      {loading ? (
        <ActivityIndicator color={ink} />
      ) : (
        <>
          {icon ? <Icon name={icon} size={size === 'small' ? 16 : 19} color={ink} /> : null}
          <Text style={[styles.text, size === 'small' && styles.textSmall, { color: ink }]} numberOfLines={1}>
            {title}
          </Text>
        </>
      )}
    </View>
  );

  const frame: StyleProp<ViewStyle> = [
    styles.base,
    size === 'small' ? styles.small : styles.large,
    variant === 'secondary' && { borderWidth: Stroke, borderColor: colors.borderStrong, backgroundColor: colors.background },
    variant === 'danger' && { borderWidth: Stroke, borderColor: DANGER, backgroundColor: colors.background },
    variant === 'light' && { backgroundColor: '#ffffff' },
    inactive && styles.inactive,
  ];

  return (
    <PressableScale
      onPress={onPress}
      disabled={inactive}
      haptic={variant === 'primary' ? 'press' : 'tap'}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: inactive, busy: loading }}
      style={style}>
      {variant === 'primary' ? (
        <LinearGradient colors={[...BrandGradient]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={frame}>
          {content}
        </LinearGradient>
      ) : (
        <View style={frame}>{content}</View>
      )}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  base: { borderRadius: Radius.field, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  large: { minHeight: 52, paddingHorizontal: Spacing.four },
  small: { minHeight: 38, paddingHorizontal: Spacing.three },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  text: { fontFamily: FontFamily.bold, fontSize: 16 },
  textSmall: { fontSize: 14 },
  inactive: { opacity: 0.5 },
});
