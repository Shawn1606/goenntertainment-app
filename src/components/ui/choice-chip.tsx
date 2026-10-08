/**
 * Ein Auswahl-Chip: Pille mit Rand, ausgewählt in der Akzentfarbe gefüllt.
 *
 * Gab es vorher fünfmal mit fast gleichen, aber eben nicht gleichen Maßen
 * (Startseite, Entdecken, Angebot, Club, Testphase). Jetzt einmal – damit jede
 * Auswahl in der App gleich aussieht, sich gleich anfühlt (kurzes Ticken beim
 * Wechsel) und gleich vorgelesen wird.
 *
 *  - `size`: `large` für Kategorien über einer Liste, `normal` für Filter,
 *    `small` für dichte Reihen.
 *  - `multi`: Mehrfachauswahl – wird als Kästchen vorgelesen, nicht als Knopf.
 */
import type { ReactNode } from 'react';
import { StyleSheet, Text } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { PressableScale } from '@/components/ui/pressable-scale';
import { FontFamily, Radius, Stroke } from '@/constants/theme';
import type { UiIconName } from '@/domain/ui-icon';
import { useTheme } from '@/hooks/use-theme';
import * as feedback from '@/lib/feedback';

type Props = {
  label: string;
  active: boolean;
  onPress: () => void;
  /** Symbol vor dem Text – ein Name aus dem Symbolsatz … */
  icon?: UiIconName;
  /** … oder ein eigenes Element (z. B. das Kategorie-Symbol). */
  leading?: ReactNode;
  size?: 'large' | 'normal' | 'small';
  /** Mehrfachauswahl: als Kästchen vorlesen. */
  multi?: boolean;
  accessibilityLabel?: string;
};

export function ChoiceChip({ label, active, onPress, icon, leading, size = 'normal', multi = false, accessibilityLabel }: Props) {
  const colors = useTheme();
  const ink = active ? '#ffffff' : colors.text;
  return (
    <PressableScale
      onPress={() => {
        if (!active || multi) feedback.selected();
        onPress();
      }}
      haptic="none"
      hitSlop={4}
      accessibilityRole={multi ? 'checkbox' : 'button'}
      accessibilityState={multi ? { checked: active } : { selected: active }}
      accessibilityLabel={accessibilityLabel ?? label}
      style={[styles.chip, styles[size], { borderColor: active ? colors.tint : colors.border, backgroundColor: active ? colors.tint : colors.background }]}>
      {leading ?? (icon ? <Icon name={icon} size={size === 'small' ? 13 : 14} color={ink} /> : null)}
      <Text style={[styles.text, size === 'large' ? styles.textLarge : size === 'small' ? styles.textSmall : null, { color: ink }]} numberOfLines={1}>
        {label}
      </Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderWidth: Stroke, borderRadius: Radius.chip, maxWidth: '100%' },
  large: { gap: 6, paddingHorizontal: 14, paddingVertical: 8 },
  normal: { paddingHorizontal: 13, paddingVertical: 7 },
  small: { paddingHorizontal: 11, paddingVertical: 5, minWidth: 38 },
  text: { fontFamily: FontFamily.semibold, fontSize: 13.5 },
  textLarge: { fontSize: 14 },
  textSmall: { fontSize: 12.5 },
});
