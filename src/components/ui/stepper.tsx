import { StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { PressableScale } from '@/components/ui/pressable-scale';
import { FontFamily, Radius, Spacing, Stroke } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Plus/Minus mit großer Zahl dazwischen – für Personenzahl und Alter.
 *
 * Kein Textfeld: Eine Zahl zwischen 1 und 50 tippt niemand gern, und ohne
 * Tastatur bleibt der Preis darunter die ganze Zeit sichtbar.
 *
 * Mit `unset` gibt es oben rechts ein ×, das sofort zurück auf „egal" springt –
 * sonst müsste man von 30 aus dreißigmal Minus tippen.
 */
export function Stepper({
  value,
  onChange,
  min = 0,
  max = 99,
  label,
  suffix,
  unset,
  start,
  compact = false,
}: {
  value: number | null;
  onChange: (next: number | null) => void;
  min?: number;
  max?: number;
  label: string;
  /** Hinter der Zahl, z. B. „Pers." oder „J.". */
  suffix?: string;
  /** Text, solange nichts gewählt ist („egal"). Ohne ihn gibt es keinen leeren Zustand. */
  unset?: string;
  /** Erste Zahl nach „egal" + Plus. Beim Alter wäre 0 Unsinn; Standard ist `min`. */
  start?: number;
  /** Schmaler für zwei nebeneinander (Alter von–bis). */
  compact?: boolean;
}) {
  const colors = useTheme();
  const current = value ?? min;
  const canDown = value !== null && (value > min || unset !== undefined);
  const canUp = value === null || value < max;

  const down = () => {
    if (value === null) return;
    if (value <= min) onChange(unset !== undefined ? null : min);
    else onChange(value - 1);
  };
  const up = () => onChange(value === null ? (start ?? min) : Math.min(max, value + 1));

  return (
    <View style={[styles.box, compact && styles.boxCompact, { borderColor: colors.border, backgroundColor: colors.background }]}>
      <View style={styles.head}>
        <Text style={[styles.label, { color: colors.textSecondary }]} numberOfLines={1}>
          {label}
        </Text>
        {unset !== undefined && value !== null ? (
          <PressableScale
            onPress={() => onChange(null)}
            haptic="select"
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={`${label} auf ${unset} stellen`}
            style={[styles.clear, { backgroundColor: colors.backgroundSelected }]}>
            <Icon name="close" size={12} color={colors.text} />
          </PressableScale>
        ) : null}
      </View>
      <View style={styles.row}>
        <Round icon="minus" onPress={down} disabled={!canDown} label={`${label} verringern`} compact={compact} />
        <Text numberOfLines={1} style={[styles.value, compact && styles.valueCompact, { color: value === null ? colors.textSecondary : colors.text }]} accessibilityLiveRegion="polite">
          {value === null ? unset : current}
          {value !== null && suffix ? <Text style={[styles.suffix, { color: colors.textSecondary }]}> {suffix}</Text> : null}
        </Text>
        <Round icon="plus" onPress={up} disabled={!canUp} label={`${label} erhöhen`} compact={compact} />
      </View>
    </View>
  );
}

function Round({ icon, onPress, disabled, label, compact }: { icon: 'plus' | 'minus'; onPress: () => void; disabled: boolean; label: string; compact: boolean }) {
  const colors = useTheme();
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      haptic="select"
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[styles.round, compact && styles.roundCompact, { borderColor: colors.borderStrong, opacity: disabled ? 0.35 : 1 }]}>
      <Icon name={icon} size={compact ? 16 : 18} color={colors.text} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  // Kein flex: 1 hier: In einer Spalte mit automatischer Höhe fiele der Kasten
  // sonst auf seine Polsterung zusammen, und die Knöpfe lägen auf dem Rahmen.
  box: { borderWidth: Stroke, borderRadius: Radius.card, padding: Spacing.three, gap: Spacing.two },
  /** Zwei nebeneinander teilen sich die Breite. */
  boxCompact: { flex: 1, minWidth: 0, padding: 12 },
  /** Feste Höhe: Das × darf beim Erscheinen nichts verschieben. */
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6, minHeight: 22 },
  label: { fontFamily: FontFamily.semibold, fontSize: 13, flexShrink: 1 },
  clear: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  value: { fontFamily: FontFamily.bold, fontSize: 24, minWidth: 64, textAlign: 'center' },
  valueCompact: { fontSize: 20, minWidth: 0, flexShrink: 1 },
  suffix: { fontFamily: FontFamily.medium, fontSize: 14 },
  round: { width: 38, height: 38, borderRadius: 19, borderWidth: Stroke, alignItems: 'center', justifyContent: 'center' },
  roundCompact: { width: 32, height: 32, borderRadius: 16 },
});
