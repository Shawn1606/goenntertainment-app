import { StyleSheet, Text, View } from 'react-native';

import { Mascot } from '@/components/mascot';
import { BrandButton } from '@/components/ui/brand-button';
import { FontFamily, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Leerer Feed – mit dem EINEN nächsten Schritt, der hier weiterhilft.
 *
 * Ein leerer Feed ohne Knopf ist eine Sackgasse. Welcher Knopf passt, hängt am
 * Grund: Ist ein Filter schuld, hilft „Filter zurücksetzen"; fehlt der Standort,
 * sagt „In der Nähe" das; und wenn es schlicht noch nichts gibt, ist die Antwort
 * „Erstell die erste" – das ist der Moment, in dem eine neue App wächst.
 */
export function FeedEmpty({
  tab,
  filtered,
  hasLocation,
  onCreate,
  onReset,
}: {
  tab: 'for-you' | 'nearby' | 'today';
  filtered: boolean;
  hasLocation: boolean;
  onCreate: () => void;
  onReset: () => void;
}) {
  const colors = useTheme();

  let title = 'Hier ist noch nichts los';
  let text = 'Starte die erste Aktivität – Leute aus deiner Gegend können direkt mitmachen.';
  let action: { label: string; onPress: () => void } = { label: 'Aktivität erstellen', onPress: onCreate };

  if (filtered) {
    title = 'Nichts gefunden';
    text = 'Mit diesen Filtern passt gerade nichts. Setz sie zurück oder versuch es mit anderen Wörtern.';
    action = { label: 'Filter zurücksetzen', onPress: onReset };
  } else if (tab === 'nearby' && !hasLocation) {
    title = 'Standort fehlt';
    text = 'Für „In der Nähe" braucht die App deinen Standort. Du kannst ihn in den Einstellungen freigeben.';
    action = { label: 'Alle Aktivitäten zeigen', onPress: onReset };
  } else if (tab === 'nearby') {
    title = 'In deiner Nähe ist nichts los';
    text = 'Sei die erste Person, die hier etwas startet.';
  } else if (tab === 'today') {
    title = 'Heute steht nichts an';
    text = 'Schau bei „Für dich" nach, was in den nächsten Tagen passiert – oder starte selbst etwas.';
  }

  return (
    <View style={styles.root}>
      <Mascot mood={filtered ? 'thinking' : 'idle'} size={88} />
      <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
      <Text style={[styles.text, { color: colors.textSecondary }]}>{text}</Text>
      <View style={styles.button}>
        <BrandButton title={action.label} onPress={action.onPress} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    paddingHorizontal: Spacing.five,
    paddingTop: Spacing.six,
    gap: Spacing.two,
    maxWidth: 480,
    alignSelf: 'center',
  },
  title: { fontFamily: FontFamily.bold, fontSize: 20, textAlign: 'center', marginTop: Spacing.two },
  text: { fontFamily: FontFamily.regular, fontSize: 15, lineHeight: 21, textAlign: 'center' },
  button: { alignSelf: 'stretch', marginTop: Spacing.three },
});
