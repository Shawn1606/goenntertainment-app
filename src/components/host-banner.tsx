// `blurRadius` gibt es bei `expo-image` am Gerät UND im Web, bei RNs `Image`
// nicht überall – dieselbe Aufteilung wie im Detail-Blatt und auf der Profilseite.
import { Image as BlurImage } from 'expo-image';
import { Image, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { hostMark } from '@/domain/host-mark';
import type { ActivityHost } from '@/lib/api';

/**
 * Wie stark der Hintergrund weichgezeichnet wird.
 *
 * Absichtlich viel: Das Bild ist hier nicht Motiv, sondern Farbe und Stimmung
 * des Hauses. Bei wenig Weichzeichnung kämpft ein erkennbares Logo mit dem Titel
 * darüber, und die Karte wird unruhig – genau das, was das Ballon-Symbol vorher
 * vermieden hat, nur bunter.
 */
const BLUR = 28;

/**
 * Der Überhang des Hintergrundbildes.
 *
 * Weichzeichnen mischt jeden Bildpunkt mit seinen Nachbarn – am Rand fehlen die,
 * und dort bliebe ein durchsichtiger Saum. Der Überhang schiebt ihn nach außen,
 * wo `overflow: 'hidden'` der Karte ihn abschneidet. Faktor 3, weil `blurRadius`
 * im Web die Streuung σ einer Gauß-Glocke ist und die rund 3 σ weit reicht –
 * dieselbe Rechnung wie in `activity-detail-modal.tsx`.
 */
const BLEED = BLUR * 3;

type Props = {
  host: ActivityHost | null;
  /** `banner` = Fläche für die Kachel, `thumb` = Quadrat für die Listenzeile. */
  variant: 'banner' | 'thumb';
  /** Höhe der Bannerfläche. Bei `thumb` bestimmt die Kachelgröße das Maß. */
  height?: number;
};

/**
 * Das Banner für ein Event, das kein eigenes Bild hat.
 *
 * ## Was hier statt eines Symbols steht
 *
 * Vorher: für jedes Event derselbe Ballon. Bei 143 Terminen aus einem Haus also
 * 143-mal dasselbe Bild – eine Fläche, die nichts aussagt.
 *
 * Jetzt kommt beides aus dem HAUS: der Hintergrund als stark weichgezeichnete
 * Fassung seines Bildes, davor sein Zeichen scharf. Zwei Termine im selben Club
 * sehen damit verwandt aus, zwei Clubs verschieden – und das ist die
 * Information, die auf einer Kachel ohne eigenes Bild überhaupt zu holen ist.
 *
 * Hat das Haus kein Bild, tritt `hostMark` ein: Kürzel auf einer festen Farbe,
 * abgeleitet aus der ID. Nicht schön wie ein Logo, aber wiedererkennbar – und
 * ohne dass jemand etwas hochladen muss.
 */
export function HostBanner({ host, variant, height = 130 }: Props) {
  const mark = hostMark(host);
  const image = host?.avatar_url ?? null;
  const thumb = variant === 'thumb';

  return (
    <View
      style={[
        thumb ? styles.thumb : [styles.banner, { height }],
        { backgroundColor: mark.background },
      ]}>
      {image ? (
        <>
          {/* Der weichgezeichnete Grund. `pointerEvents="none"`, damit er den
              Tipp auf die Karte nicht abfängt. */}
          <BlurImage
            source={{ uri: image }}
            style={[StyleSheet.absoluteFill, { margin: -BLEED }]}
            blurRadius={BLUR}
            contentFit="cover"
            pointerEvents="none"
          />
          {/* Eine dünne dunkle Lage darüber: Ein helles Logo ergibt sonst einen
              hellen Grund, auf dem das scharfe Zeichen davor verschwindet. */}
          <View style={[StyleSheet.absoluteFill, styles.scrim]} pointerEvents="none" />
        </>
      ) : null}

      {/* Das Zeichen des Anbieters davor: sein Bild, sonst sein Kürzel. */}
      {image ? (
        <Image
          source={{ uri: image }}
          style={thumb ? styles.markImageThumb : styles.markImage}
          resizeMode="cover"
        />
      ) : (
        <ThemedText
          style={[
            thumb ? styles.initialsThumb : styles.initials,
            { color: mark.foreground },
          ]}>
          {mark.initials}
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  // Maße GENAU wie `styles.thumb` in `activity-card.tsx` (68/68/Radius.field):
  // Weicht das ab, springt die Zeile, je nachdem ob ein Event ein Bild hat.
  thumb: {
    width: 68,
    height: 68,
    borderRadius: Radius.field,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  scrim: { backgroundColor: 'rgba(0,0,0,0.28)' },
  markImage: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.85)',
  },
  markImageThumb: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: 'rgba(255,255,255,0.85)',
  },
  initials: {
    fontSize: 34,
    lineHeight: 42,
    fontWeight: '800',
    letterSpacing: 1,
    // Ohne eigenes Bild ist das Kürzel das Einzige auf der Fläche – etwas Luft
    // nach oben lässt es mittig sitzen statt auf der Schrift-Grundlinie zu kleben.
    paddingTop: Spacing.one,
  },
  initialsThumb: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '800',
  },
});
