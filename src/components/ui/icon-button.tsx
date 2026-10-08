import { useRouter, type Href } from 'expo-router';
import { Platform, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { PressableScale } from '@/components/ui/pressable-scale';
import { FontFamily } from '@/constants/theme';
import type { UiIconName } from '@/domain/ui-icon';
import { useTheme } from '@/hooks/use-theme';
import { goBack } from '@/lib/go-back';

/**
 * Der eine runde Symbol-Knopf der App.
 *
 * ## Warum es ihn gibt
 *
 * Vorher hatte jeder Screen seinen eigenen Zurück-Knopf: mal der nackte
 * System-Pfeil in Akzentfarbe mit „Zurück" daneben, mal ein Chevron in einer
 * pinken Pille, mal ein graues Symbol ohne Fläche. Jeder für sich in Ordnung –
 * zusammen sah die App aus, als hätten fünf Leute an ihr gebaut, und die
 * System-Knöpfe wirkten wie Platzhalter, die jemand vergessen hat zu ersetzen.
 *
 * Jetzt gibt es genau eine Form: ein Kreis mit 40 px, das Symbol mittig, beim
 * Drücken sinkt er leicht ein. Die Varianten unterscheiden nur, WORAUF er liegt:
 *
 *  - `filled`  – Standard in Kopfzeilen: zarte Fläche mit Haarlinie.
 *  - `elevated` – über Bildern oder durchsichtigen Köpfen: deckend mit Schatten,
 *    damit er auf hellem Himmel wie auf dunklem Foto lesbar bleibt.
 *  - `plain`   – ohne Fläche, für Aktionsleisten (Herz, Kommentar, Teilen), wo
 *    zehn Kreise nebeneinander unruhig würden.
 *  - `accent`  – gefüllt im Akzent, für die eine Handlung, zu der eingeladen wird.
 */
export type IconButtonVariant = 'filled' | 'elevated' | 'plain' | 'accent';

export type IconButtonProps = {
  icon: UiIconName;
  /** Vorgelesener Name – Pflicht, weil ein Symbol allein nichts sagt. */
  label: string;
  onPress: () => void;
  variant?: IconButtonVariant;
  /** Durchmesser. 40 in Kopfzeilen, 36 in dichten Leisten. */
  size?: number;
  /** Symbolfarbe; Standard hängt an der Variante. */
  color?: string;
  /** Kleine Zahl oben rechts (ungelesene Chats). */
  badge?: string | null;
  /** Hervorgehoben (z. B. Filter aktiv) – färbt das Symbol im Akzent. */
  active?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function IconButton({
  icon,
  label,
  onPress,
  variant = 'filled',
  size = 40,
  color,
  badge,
  active,
  disabled,
  style,
}: IconButtonProps) {
  const colors = useTheme();

  const tone =
    variant === 'accent'
      ? { bg: colors.tint, border: 'transparent', fg: colors.tintText }
      : variant === 'elevated'
        ? { bg: colors.background, border: colors.backgroundSelected, fg: colors.text }
        : variant === 'plain'
          ? { bg: 'transparent', border: 'transparent', fg: colors.text }
          : { bg: colors.backgroundElement, border: colors.backgroundSelected, fg: colors.text };

  const iconSize = Math.round(size * (variant === 'plain' ? 0.64 : 0.54));

  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      haptic="tap"
      scaleTo={0.9}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, selected: !!active }}
      style={[
        styles.button,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: tone.bg,
          borderColor: tone.border,
          borderWidth: variant === 'plain' || variant === 'accent' ? 0 : StyleSheet.hairlineWidth,
          opacity: disabled ? 0.45 : 1,
        },
        variant === 'elevated' && styles.elevated,
        style,
      ]}>
      <Icon name={icon} size={iconSize} color={color ?? (active ? colors.tint : tone.fg)} />
      {badge ? (
        <View style={[styles.badge, { backgroundColor: colors.tint, borderColor: colors.background }]}>
          <Text style={styles.badgeText}>{badge}</Text>
        </View>
      ) : null}
    </PressableScale>
  );
}

/**
 * Zurück – in derselben Form wie jeder andere Kopf-Knopf.
 *
 * Geht zurück, wenn es einen Verlauf gibt, und sonst zu `fallback` (bzw. zur
 * Startseite). Nach einem Neuladen im Browser oder einem geteilten Link gibt es
 * keinen Bildschirm darunter; ein Zurück, das dann nichts tut, wäre eine
 * Sackgasse über der Tab-Leiste.
 */
export function BackButton({
  fallback,
  onPress,
  variant = 'filled',
  icon = 'chevron-left',
  label = 'Zurück',
}: {
  fallback?: Href;
  onPress?: () => void;
  variant?: IconButtonVariant;
  /** `close` für Blätter, die man schließt statt verlässt. */
  icon?: 'chevron-left' | 'close';
  label?: string;
}) {
  const router = useRouter();
  return (
    <IconButton
      icon={icon}
      label={label}
      variant={variant}
      onPress={
        onPress ??
        (() => {
          if (router.canGoBack()) router.back();
          else if (fallback) router.replace(fallback);
          else goBack();
        })
      }
    />
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  elevated: Platform.select({
    android: { elevation: 3 },
    default: {
      shadowColor: '#000',
      shadowOpacity: 0.16,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 },
    },
  }) as ViewStyle,
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    paddingHorizontal: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#ffffff', fontSize: 10, fontFamily: FontFamily.bold },
});
