/**
 * Ein Profilbild mit Story-Ring – die EINE Stelle, an der dieser Ring wohnt.
 *
 * ## Warum das eine eigene Datei ist
 *
 * Der Ring stand vorher nur in der Story-Leiste, und die Profilseite hatte
 * daneben ihren eigenen: dort lag ein Marken-Verlauf um JEDES Profilbild, ob mit
 * Story oder ohne. Damit sagte derselbe Ring an zwei Stellen zwei verschiedene
 * Dinge – in der Leiste „hier ist etwas Neues", auf dem Profil „hier ist ein
 * Profilbild". Ein Zeichen, das mal etwas bedeutet und mal nur schmückt,
 * bedeutet am Ende nichts.
 *
 * Jetzt gilt überall dieselbe Regel: **Ring = Story.** Wer keine laufende Story
 * hat, bekommt eine haarfeine Kontur und sonst nichts.
 *
 * ## Ein Bogen je Story
 *
 * Der Ring ist kein geschlossener Kreis, sondern so viele Bögen, wie die Person
 * Storys hat – gerechnet in `ringDash` (siehe src/domain/story.ts, dort
 * getestet). Das ist der Teil, der ohne Text arbeitet: Man sieht am Ring, dass
 * drei Bilder warten, bevor man ihn antippt.
 *
 * Gezeichnet wird mit SVG und nicht mit `borderWidth`: Eine Kante kann man nicht
 * unterbrechen, und ein Verlauf durch eine Kontur laufen zu lassen geht in React
 * Native gar nicht. Der bisherige Weg (ein `LinearGradient` als Fläche, darauf
 * eine kleinere gefüllte Fläche) kann beides nicht – deshalb ein echter Strich.
 *
 * ## Dick genug, um aufzufallen
 *
 * Der Ring war 2,5 px breit und klebte direkt am Bild; auf einem Handy war er
 * eher eine Ahnung als ein Zeichen. Jetzt wächst die Strichbreite mit dem Bild
 * (rund 6 %) und zwischen Ring und Bild bleibt Luft. Diese Lücke ist die halbe
 * Arbeit: Ohne sie verschmilzt der Ring mit dem Foto und wirkt wie ein Rand des
 * Bildes, mit ihr liest er sich als etwas, das UM das Bild liegt.
 */
import { Image } from 'expo-image';
import { useId, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { BrandGradient, FontFamily } from '@/constants/theme';
import { ringDash } from '@/domain/story';
import { useBrandSurface, useGlass } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { apiImageSource } from '@/lib/auth-image';

/** Erste Buchstaben des Namens – Rückfallbild ohne Profilbild. */
export function initialsOf(name: string): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

/**
 * Strichbreite des Rings.
 *
 * Mit dem Bild wachsend, aber nie unter 3: Darunter ist der Ring auf einem Handy
 * mit hoher Punktdichte eine Haarlinie, und genau das war der Grund, warum ihn
 * niemand als Zeichen gelesen hat.
 */
function strokeFor(size: number): number {
  return Math.max(3, Math.round(size * 0.058));
}

/** Luft zwischen Ring und Bild – siehe die Notiz oben, sie ist die halbe Arbeit. */
function gapFor(size: number): number {
  return Math.max(2, Math.round(size * 0.04));
}

export type StoryAvatarProps = {
  /**
   * AUSSENdurchmesser inklusive Ring.
   *
   * Der Ring liegt innen, das Bild wird also kleiner als `size`. So bleibt die
   * Fläche gleich, egal ob jemand eine Story hat – in einer Liste würde sonst
   * jede Zeile mit Story die anderen verschieben.
   */
  size: number;
  avatar?: string | null;
  /** Für die Initialen, wenn kein Bild da ist. */
  name: string;
  /** Wie viele Storys – so viele Bögen. 0 (Standard) = kein Ring. */
  stories?: number;
  /** true = alle gesehen: ruhige Kontur statt Verlauf. */
  seen?: boolean;
  /**
   * Bild, das einspringt, wenn es kein Profilbild gibt.
   *
   * In der Story-Leiste ist das die Story selbst: Sie steckt ohnehin hinter dem
   * Ring und sagt mehr als zwei Buchstaben.
   */
  fallbackImage?: string | null;
  /** Statt Bild und Initialen etwas Eigenes – das ＋ in „Deine Story". */
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
};

export function StoryAvatar({
  size,
  avatar,
  name,
  stories = 0,
  seen = false,
  fallbackImage,
  children,
  style,
}: StoryAvatarProps) {
  const surface = useBrandSurface();
  const glass = useGlass();
  const { token } = useAuth();
  // Für `url(#…)` brauchbar machen: `useId` liefert Zeichen wie „:r0:", und ein
  // Doppelpunkt in einer SVG-Referenz ist die Sorte Fehler, die nur auf einer
  // der Plattformen auffällt.
  const gradientId = `story-ring-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  const stroke = strokeFor(size);
  const inset = stroke + gapFor(size);
  const photo = Math.max(size - inset * 2, 1);

  const hasRing = stories > 0;
  // Der Kreis liegt in der MITTE des Strichs – sonst ragt die halbe Strichbreite
  // über die Fläche hinaus und wird abgeschnitten.
  const radius = (size - stroke) / 2;
  const dash = hasRing ? ringDash(2 * Math.PI * radius, stories, stroke * 1.6) : null;

  const face = children ?? (
    // `avatar` zuerst: Das ist die Person. Erst wenn es keins gibt, springt das
    // Story-Bild ein, und erst danach die Initialen.
    avatar ? (
      <Image source={{ uri: avatar }} style={styles.image} contentFit="cover" />
    ) : fallbackImage ? (
      // A story image (private, F-11): sent with the viewer's token.
      <Image source={apiImageSource(fallbackImage, token)} style={styles.image} contentFit="cover" cachePolicy="memory" />
    ) : (
      <ThemedText style={[styles.initials, { fontSize: photo * 0.34, color: surface.accent }]}>
        {initialsOf(name)}
      </ThemedText>
    )
  );

  return (
    <View style={[{ width: size, height: size }, style]}>
      {hasRing ? (
        <Svg width={size} height={size} style={styles.ring} pointerEvents="none">
          <Defs>
            <LinearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
              {BrandGradient.map((color, index) => (
                <Stop
                  key={color}
                  offset={`${(index / (BrandGradient.length - 1)) * 100}%`}
                  stopColor={color}
                />
              ))}
            </LinearGradient>
          </Defs>
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            // Gesehen: eine ruhige Linie. Der Verlauf ist das Signal für „neu"
            // und darf sich nicht abnutzen – hätte auch das Gesehene ihn, wäre er
            // nur noch Dekoration.
            stroke={seen ? surface.chipBorder : `url(#${gradientId})`}
            strokeWidth={stroke}
            // Stumpfe Enden: Runde Kappen wachsen über das Bogenende hinaus und
            // fressen genau die Lücke auf, die die Bögen trennt.
            strokeLinecap="butt"
            {...(dash
              ? {
                  strokeDasharray: [dash.arc, dash.gap],
                  // Eine halbe Lücke Vorlauf: So sitzt eine Lücke MITTIG oben und
                  // der Ring wirkt gesetzt statt angeschnitten.
                  strokeDashoffset: dash.arc + dash.gap / 2,
                }
              : null)}
          />
        </Svg>
      ) : null}

      <View
        style={[
          styles.face,
          {
            top: inset,
            left: inset,
            width: photo,
            height: photo,
            borderRadius: photo / 2,
            backgroundColor: surface.chipBgSolid,
          },
          // Ohne Story trägt das Bild seine eigene haarfeine Kontur: Sonst
          // schwebte es kantenlos auf der Karte, sobald der Ring wegfällt.
          !hasRing && { borderWidth: StyleSheet.hairlineWidth * 2, borderColor: glass.border },
        ]}>
        {face}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  /**
   * Der Anfang des Rings gehört nach oben.
   *
   * Ohne Drehung begänne die erste Lücke rechts auf drei Uhr, und der Ring sähe
   * verrutscht aus. Gedreht wird das ganze SVG und nicht der Kreis darin:
   * `rotation`/`origin` am `<Circle>` wären der naheliegende Weg, aber
   * react-native-svg reicht `origin` im Web als `transform-origin` ans DOM
   * durch – React lehnt das als ungültige Eigenschaft ab und schreibt bei jedem
   * Ring einen Fehler in die Konsole. Eine normale Style-Drehung dreht um die
   * Mitte der Fläche, und der Kreis sitzt ohnehin mittig: gleiches Bild, ohne
   * SVG-Sonderweg.
   */
  ring: { position: 'absolute', top: 0, left: 0, transform: [{ rotate: '-90deg' }] },
  face: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  image: { width: '100%', height: '100%' },
  initials: { fontWeight: '800', fontFamily: FontFamily.bold },
});
