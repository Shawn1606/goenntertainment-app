import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { CategoryIcon } from '@/components/ui/category-icon';
import { Spacing } from '@/constants/theme';
import { useBrandSurface } from '@/hooks/use-theme';

type Props = {
  title: string;
  /** Wie viele Einträge darunter liegen – die Zahl ist der Grund hinzuschauen. */
  count: number;
  /** Kategorie für das Zeichen links; ohne bleibt der Platz leer. */
  interest?: { name?: string | null; icon?: string | null } | null;
  /**
   * Trennlinie darüber. Beim ERSTEN Abschnitt aus: Dort trennt sie nichts, sie
   * hängt nur unter dem Kopf des Blattes.
   */
  divider?: boolean;
};

/**
 * Die Überschrift über einem Abschnitt einer Terminliste.
 *
 * ## Warum das ein eigener Baustein ist
 *
 * Erste Fassung war `type="smallBold"` in Akzentfarbe – 13 px zwischen Karten mit
 * Bildern. Damit war die Unterteilung technisch da und praktisch unsichtbar: Man
 * scrollt an einer Zeile Kleingedrucktem vorbei und merkt nicht, dass der Monat
 * gewechselt hat. Bei einer Liste, deren ganzer Zweck die Unterteilung ist, macht
 * das die Unterteilung wertlos.
 *
 * Drei Dinge machen sie sichtbar, und jedes einzeln würde nicht reichen:
 *
 *  - **Dieselbe Größe wie die Regal-Überschriften** (19 px, 800). Beide antworten
 *    auf „was liegt in diesem Block?" – zwei Größen würden eine Rangordnung
 *    behaupten, die es nicht gibt.
 *  - **Die Zahl als gefüllte Pille**, nicht als graue Ziffer. Sie ist der Grund,
 *    überhaupt hinzuschauen („lohnt sich das?"), und die Füllung trennt sie vom
 *    Titel, sodass beides einzeln lesbar bleibt.
 *  - **Eine Trennlinie darüber.** Ohne sie liest sich auch eine große Überschrift
 *    als Beschriftung der Karte DARUNTER statt als Schnitt durch die Liste. Der
 *    Schnitt ist die Aussage.
 *
 * Bewusst NICHT in Großbuchstaben: Deutsche Kategorienamen mit Umlauten lesen
 * sich gesperrt schlecht, und die App macht es an keiner anderen Stelle.
 */
export function ListSectionHeader({ title, count, interest, divider = true }: Props) {
  const surface = useBrandSurface();

  return (
    <View style={styles.wrap}>
      {divider ? (
        <View style={[styles.divider, { backgroundColor: surface.cardBorder }]} />
      ) : null}
      <View style={styles.row}>
        {interest ? <CategoryIcon interest={interest} size={20} color={surface.accent} /> : null}
        <ThemedText style={[styles.title, { color: surface.text }]} numberOfLines={1}>
          {title}
        </ThemedText>
        <ThemedText
          type="small"
          style={[styles.count, { color: surface.chipText, backgroundColor: surface.chipBg }]}>
          {count}
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.two, paddingTop: Spacing.two },
  divider: { height: StyleSheet.hairlineWidth * 2, width: '100%' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  // Maße wie `styles.title` in `activity-shelf.tsx` – gleiche Rolle, gleiche Form.
  title: {
    flexShrink: 1,
    fontSize: 19,
    lineHeight: 26,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  // Und wie `styles.count` dort.
  count: {
    fontWeight: '700',
    fontSize: 12,
    lineHeight: 16,
    borderRadius: 999,
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
    overflow: 'hidden',
  },
});
