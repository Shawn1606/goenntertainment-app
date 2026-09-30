import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { GlassChip } from '@/components/ui/glass';
import { Icon } from '@/components/ui/icon';
import { Spacing } from '@/constants/theme';
import { useBrandSurface } from '@/hooks/use-theme';
import type { PersonCard } from '@/lib/api';

/**
 * Der Freundschafts-Knopf neben einer Person – vier Zustände, vier Beschriftungen.
 *
 * Steht an einer Stelle, weil er an zwei Orten gebraucht wird (Freunde-Tab und
 * Suche) und dort exakt dasselbe bedeuten muss.
 */
export function FriendAction({
  state,
  onAdd,
  onCancel,
}: {
  state: NonNullable<PersonCard['friendship']>;
  onAdd: () => void;
  onCancel: () => void;
}) {
  const surface = useBrandSurface();

  if (state === 'friends') {
    return (
      <View style={styles.row}>
        <Icon name="check" size={18} color={surface.accent} />
        <ThemedText type="small" style={{ color: surface.textMuted }}>
          Befreundet
        </ThemedText>
      </View>
    );
  }
  if (state === 'incoming') return <GlassChip label="Annehmen" selected onPress={onAdd} />;
  if (state === 'outgoing') return <GlassChip label="Angefragt" onPress={onCancel} />;
  return <GlassChip label="Anfragen" selected onPress={onAdd} />;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
});
