import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';

import { initialsOf } from '@/domain/initials';
import { FontFamily } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type StackPerson = { id: number; name: string; avatar?: string | null };

/**
 * Überlappende Profilbilder – „wer ist dabei" auf einen Blick.
 *
 * Gesichter überzeugen schneller als eine Zahl: „3 Personen dabei" ist eine
 * Auskunft, drei kleine Gesichter sind eine Einladung. Mehr als `max` passen
 * nicht sinnvoll nebeneinander; der Rest steht als „+5" am Ende.
 */
export function AvatarStack({
  people,
  total,
  size = 26,
  max = 4,
}: {
  people: readonly StackPerson[];
  /** Echte Gesamtzahl, falls der Server nicht alle Personen liefert. */
  total?: number;
  size?: number;
  max?: number;
}) {
  const colors = useTheme();
  const shown = people.slice(0, max);
  const rest = Math.max(0, (total ?? people.length) - shown.length);
  if (shown.length === 0) return null;

  const ring = { width: size, height: size, borderRadius: size / 2, borderColor: colors.background };

  return (
    <View style={styles.row} accessible={false}>
      {shown.map((person, index) => (
        <View
          key={person.id}
          style={[styles.face, ring, { marginLeft: index === 0 ? 0 : -size * 0.32, backgroundColor: colors.backgroundSelected, zIndex: max - index }]}>
          {person.avatar ? (
            <Image source={{ uri: person.avatar }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" />
          ) : (
            <Text style={[styles.initials, { color: colors.text, fontSize: size * 0.38 }]}>{initialsOf(person.name)}</Text>
          )}
        </View>
      ))}
      {rest > 0 ? (
        <View style={[styles.face, ring, { marginLeft: -size * 0.32, backgroundColor: colors.backgroundElement }]}>
          <Text style={[styles.initials, { color: colors.textSecondary, fontSize: size * 0.34 }]}>+{rest}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  face: {
    borderWidth: 2,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: { fontFamily: FontFamily.bold },
});
