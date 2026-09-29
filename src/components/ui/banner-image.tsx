// `expo-image` und nicht RNs `Image`: gleiche Wahl wie an den anderen Bildstellen
// (Zwischenspeicher auf Platte, weiches Einblenden, `contentFit`).
import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

type Props = {
  uri: string;
  /** Höhe des Rahmens. */
  height: number;
};

/**
 * Das Banner einer Kachel oder eines Spalten-Deckels.
 *
 * ## Formatfüllend, auch wenn dabei etwas wegfällt
 *
 * Das Bild füllt den Rahmen (`cover`) und wird dafür zugeschnitten. Hier stand
 * vorher `contain` mit einer weichgezeichneten Kopie des Bildes hinter den freien
 * Flächen – damit war das Motiv vollständig, aber ein Hochformat-Plakat stand als
 * schmaler Streifen zwischen zwei weichen Balken. Ein gefüllter Rahmen wirkt wie
 * ein Plakat; ein eingepasstes Bild wirkt wie ein Bild in einem Rahmen.
 *
 * Die weiche Lage ist damit ersatzlos weg: Unter einem formatfüllenden Bild wäre
 * sie unsichtbar und würde jede Aufnahme ein zweites Mal in den Speicher laden.
 * (Für Events OHNE eigenes Bild gibt es sie weiter – dort ist der weiche Grund das
 * Bild des Veranstalters, siehe `host-banner.tsx`.)
 */
export function BannerImage({ uri, height }: Props) {
  return (
    <View style={{ height }}>
      <Image
        source={{ uri }}
        style={styles.image}
        contentFit="cover"
        cachePolicy="memory-disk"
        accessible={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  image: { ...StyleSheet.absoluteFill, width: '100%', height: '100%' },
});
