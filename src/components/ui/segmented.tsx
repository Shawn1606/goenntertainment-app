import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, type LayoutChangeEvent } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { GlassSurface } from '@/components/ui/glass';
import { FontFamily, Radius, Spacing } from '@/constants/theme';
import { useBrandSurface } from '@/hooks/use-theme';
import * as feedback from '@/lib/feedback';

export type Segment<T extends string> = {
  value: T;
  label: string;
  /** Zahl rechts am Titel – zeigt sofort, wo etwas liegt. */
  count?: number;
};

export type SegmentedProps<T extends string> = {
  segments: Segment<T>[];
  value: T;
  onChange: (value: T) => void;
};

/**
 * Straff und ohne Nachwippen: Der Marker soll ankommen, nicht federn.
 * Ein weicher Wert sieht bei einem Umschalter nach Gummi aus.
 */
const SPRING = { damping: 20, stiffness: 260, mass: 0.7 } as const;

/**
 * Umschalter für mehrere Ansichten desselben Screens.
 *
 * Bewusst kein Tab-Balken: Tabs versprechen eigene Bereiche, hier bleibt man
 * im selben Screen und filtert nur die Sicht. Die Zahl je Segment nimmt das
 * Ergebnis vorweg – man muss nicht erst umschalten, um zu sehen, ob dort
 * überhaupt etwas liegt.
 *
 * ## Der gleitende Marker
 *
 * Die aktive Fläche ist eine **eigene Ebene**, die zur gewählten Position
 * fährt – vorher sprang die Hintergrundfarbe von einem Segment zum anderen.
 * Der Unterschied ist nicht Kosmetik: Die Bewegung zeigt, *woher* man kommt.
 * Bei einem harten Umschalten muss man den Text lesen, um zu wissen, wo man
 * jetzt ist; bei einer Bewegung hat man es gesehen.
 *
 * Umgesetzt über die gemessene Breite eines Segments statt über prozentuale
 * Werte: Die Bahn hat Innenabstand und Lücken zwischen den Segmenten, die sich
 * nicht als Prozent ausdrücken lassen, ohne bei drei Segmenten schief zu sitzen.
 *
 * ## Und was, wenn nicht gemessen wird
 *
 * Die Breite kommt aus `onLayout`. Das ist eine Zusage, die nicht überall
 * eingehalten wird – im Browser hängt sie an einem `ResizeObserver`, der in
 * einem unsichtbaren Tab nicht feuert. Ohne Rückfall stünde dann **gar keine**
 * Markierung da und man könnte nicht sehen, welche Ansicht offen ist.
 *
 * Deshalb zwei Stufen: Solange nichts gemessen ist, färbt sich das aktive
 * Segment selbst ein (springt, ist aber richtig). Sobald die Breite steht,
 * übernimmt der gleitende Marker und die Einfärbung fällt weg. Dieselbe Regel
 * wie beim Eintritt in `entrance.tsx`: Bewegung darf verschönern, niemals
 * tragen.
 */
export function Segmented<T extends string>({ segments, value, onChange }: SegmentedProps<T>) {
  const surface = useBrandSurface();
  const reduced = useReducedMotion();

  /** Breite eines Segments – erst nach dem ersten Layout bekannt. */
  const [itemWidth, setItemWidth] = useState(0);
  const shift = useSharedValue(0);
  /** Erst einblenden, wenn die Breite steht; sonst blitzt er links auf. */
  const ready = useSharedValue(0);

  const activeIndex = Math.max(
    0,
    segments.findIndex((segment) => segment.value === value),
  );

  useEffect(() => {
    if (itemWidth === 0) return;
    const target = activeIndex * (itemWidth + GAP);
    // Beim ersten Messen ohne Animation an die richtige Stelle setzen – sonst
    // fährt der Marker beim Öffnen des Screens einmal quer durchs Bild.
    if (ready.value === 0) {
      shift.value = target;
      ready.value = withTiming(1, { duration: 120 });
      return;
    }
    shift.value = reduced ? target : withSpring(target, SPRING);
  }, [activeIndex, itemWidth, reduced, shift, ready]);

  const marker = useAnimatedStyle(() => ({
    width: itemWidth,
    opacity: ready.value,
    transform: [{ translateX: shift.value }],
  }));

  function onItemLayout(event: LayoutChangeEvent) {
    const next = Math.round(event.nativeEvent.layout.width);
    setItemWidth((prev) => (prev === next ? prev : next));
  }

  /** Erst ab hier trägt der Marker die Markierung. */
  const measured = itemWidth > 0;

  return (
    <GlassSurface tone="accent" radius={Radius.panel} sheen={false} style={styles.track}>
      {/* Liegt HINTER den Segmenten und fängt keine Tipps ab. */}
      {measured ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.marker, { backgroundColor: surface.accent }, marker]}
        />
      ) : null}

      {segments.map((segment, index) => {
        const active = segment.value === value;

        return (
          <Pressable
            key={segment.value}
            // Nur das erste Segment messen: Alle sind `flex: 1`, also gleich
            // breit. Messen wir alle, feuert jedes ein `setState`.
            onLayout={index === 0 ? onItemLayout : undefined}
            onPress={() => {
              if (!active) feedback.selected();
              onChange(segment.value);
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            // `accessibilityState` allein reicht im Web nicht: React Native Web
            // übersetzt es bei `role="tab"` nicht nach `aria-selected`, im DOM
            // stand also nur `role=tab`. Ohne dieses Attribut kann ein
            // Screenreader nicht sagen, welche Ansicht offen ist – die Auswahl
            // wäre eine rein farbliche Information.
            aria-selected={active}
            style={({ pressed }) => [
              styles.item,
              // Rückfall, solange nichts gemessen ist – sonst wäre gar nichts
              // markiert.
              !measured && active && { backgroundColor: surface.accent },
              pressed && !active && styles.pressed,
            ]}>
            <Text
              numberOfLines={1}
              style={[styles.label, { color: active ? surface.accentText : surface.textMuted }]}>
              {segment.label}
            </Text>
            {segment.count !== undefined ? (
              <Text
                style={[
                  styles.count,
                  {
                    color: active ? surface.accentText : surface.chipText,
                    // Der Zähler liegt jetzt auf blauer Bahn – eine Stufe
                    // kräftiger, sonst ist die Pille nicht mehr zu erkennen.
                    backgroundColor: active ? 'rgba(255,255,255,0.22)' : surface.chipBgStrong,
                  },
                ]}>
                {segment.count}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </GlassSurface>
  );
}

/** Lücke zwischen zwei Segmenten – geht in die Marker-Position ein. */
const GAP = 4;
/** Innenabstand der Bahn – der Marker startet um diesen Wert eingerückt. */
const PADDING = 4;

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    padding: PADDING,
    gap: GAP,
  },
  /**
   * Absolut positioniert, damit die Segmente ihr Layout behalten: Läge der
   * Marker im Fluss, verschöbe er die Beschriftungen.
   */
  marker: {
    position: 'absolute',
    left: PADDING,
    top: PADDING,
    bottom: PADDING,
    borderRadius: Radius.card,
  },
  item: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    minHeight: 40,
    paddingHorizontal: Spacing.two,
    borderRadius: Radius.card,
  },
  pressed: { opacity: 0.6 },
  label: {
    flexShrink: 1,
    fontSize: 14,
    fontWeight: '700',
    fontFamily: FontFamily.bold,
  },
  count: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '800',
    fontFamily: FontFamily.bold,
    borderRadius: 999,
    minWidth: 20,
    textAlign: 'center',
    paddingHorizontal: 5,
    paddingVertical: 1,
    overflow: 'hidden',
  },
});
