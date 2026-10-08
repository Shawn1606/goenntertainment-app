import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/ui/icon';
import { FontFamily, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import type { UiIconName } from '@/domain/ui-icon';
import { useTheme } from '@/hooks/use-theme';
import * as feedback from '@/lib/feedback';

export type SheetOption = {
  key: string;
  label: string;
  icon: UiIconName;
  onPress: () => void;
  /** Rot und zuletzt: Löschen, Melden. */
  destructive?: boolean;
};

/** Rot für Löschen – dieselbe Warnfarbe wie bei den übrigen Löschknöpfen. */
const DANGER = '#ed4956';

/**
 * Das Blatt hinter „…" – weitere Optionen zu einem Beitrag.
 *
 * Ein Blatt statt eines System-Dialogs: `Alert` mit mehreren Knöpfen hat im Web
 * keine funktionierenden Rückrufe, und auf dem Handy sieht es auf jeder
 * Plattform anders aus. So hat jede Option ihr Symbol, und das Gefährliche steht
 * rot und abgesetzt ganz unten – genau wie bei Instagram.
 *
 * Darf innerhalb eines anderen `Modal` stehen (Detail-Blatt): Ein zweites
 * `Modal` DANEBEN würde auf Android hinter dem ersten landen.
 */
export function OptionsSheet({
  visible,
  title,
  options,
  onClose,
}: {
  visible: boolean;
  title?: string;
  options: SheetOption[];
  onClose: () => void;
}) {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const safe = options.filter((o) => !o.destructive);
  const danger = options.filter((o) => o.destructive);

  const choose = (option: SheetOption) => {
    feedback.tapped();
    onClose();
    // Erst schließen, dann handeln: Öffnet die Option selbst etwas (Rückfrage,
    // Teilen-Blatt), läge es sonst hinter diesem Blatt.
    setTimeout(option.onPress, 180);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Schließen" />
        <View
          style={[
            styles.sheet,
            { backgroundColor: colors.background, paddingBottom: insets.bottom + Spacing.three },
          ]}>
          <View style={[styles.handle, { backgroundColor: colors.backgroundSelected }]} />
          {title ? (
            <Text style={[styles.title, { color: colors.textSecondary }]} numberOfLines={1}>
              {title}
            </Text>
          ) : null}

          <View style={[styles.group, { backgroundColor: colors.backgroundElement }]}>
            {safe.map((option, index) => (
              <OptionRow key={option.key} option={option} divider={index > 0} onPress={() => choose(option)} />
            ))}
          </View>

          {danger.length > 0 ? (
            <View style={[styles.group, { backgroundColor: colors.backgroundElement }]}>
              {danger.map((option, index) => (
                <OptionRow key={option.key} option={option} divider={index > 0} onPress={() => choose(option)} />
              ))}
            </View>
          ) : null}

          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.cancel,
              { backgroundColor: colors.backgroundElement },
              pressed && styles.pressed,
            ]}>
            <Text style={[styles.cancelText, { color: colors.text }]}>Abbrechen</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function OptionRow({ option, divider, onPress }: { option: SheetOption; divider: boolean; onPress: () => void }) {
  const colors = useTheme();
  const tone = option.destructive ? DANGER : colors.text;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={option.label}
      style={({ pressed }) => [
        styles.row,
        divider && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.backgroundSelected },
        pressed && styles.pressed,
      ]}>
      <Icon name={option.icon} size={22} color={tone} />
      <Text style={[styles.rowText, { color: tone }]}>{option.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    gap: Spacing.two,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  handle: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: Spacing.one },
  title: { fontFamily: FontFamily.semibold, fontSize: 13, textAlign: 'center', marginBottom: Spacing.one },
  group: { borderRadius: Radius.panel, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    minHeight: 54,
  },
  rowText: { fontFamily: FontFamily.semibold, fontSize: 16 },
  cancel: { borderRadius: Radius.panel, minHeight: 52, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontFamily: FontFamily.bold, fontSize: 16 },
  pressed: { opacity: 0.6 },
});
