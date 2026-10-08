/**
 * Leuchten, Pulsieren, Schimmern – die „lebendigen" Bausteine der App.
 *
 * Grundregel: **Leuchten ist ein Signal, keine Deko.** Es markiert genau die
 * Stellen, an denen gerade etwas passiert oder etwas zu holen ist (Serie in
 * Gefahr, Event läuft jetzt, Hauptknopf). Überall sonst bleibt die App ruhig –
 * sonst gewöhnt sich das Auge daran und das Leuchten sagt nichts mehr aus.
 * Genau daran scheitern die meisten „animierten" Apps: alles wackelt, also
 * bedeutet nichts mehr etwas.
 *
 * Technisch bewusst sparsam: alles läuft auf den schon installierten Paketen
 * (`react-native-reanimated`, `expo-linear-gradient`). Kein neues Native-Modul,
 * also kein Neubau des Dev-Clients. Der Weichzeichner kommt aus `boxShadow`
 * (React Native 0.76+, neue Architektur); wo der fehlt, bleibt der farbige Ring
 * stehen und die Stelle ist immer noch markiert.
 *
 * „Bewegung reduzieren" wird überall beachtet (`useStill()`): Wer es im System
 * gesetzt hat, bekommt den Zustand als ruhiges Bild statt als Animation –
 * sichtbar bleibt er trotzdem. Dasselbe gilt für Seiten, die gerade nicht vorn
 * sind (src/components/ui/motion-pause.tsx).
 */
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { useBeat, useStill } from '@/components/ui/motion-pause';
import { Radius } from '@/constants/theme';

/** Wie kräftig geleuchtet wird. `strong` nur für „jetzt oder nie"-Momente. */
export type GlowIntensity = 'soft' | 'strong';

const INTENSITY = {
  soft: { blur: 16, spread: 0, ring: 1.2, min: 0.3, max: 0.7, scaleTo: 1.004 },
  strong: { blur: 28, spread: 1, ring: 1.6, min: 0.5, max: 1, scaleTo: 1.01 },
} as const;

export type GlowProps = {
  children: ReactNode;
  /** Aus = gar keine Extra-Ebene. Der Ruhezustand kostet dadurch nichts. */
  active?: boolean;
  /** Leuchtfarbe. Am besten der Akzent oder eine Warnfarbe – nie beides gemischt. */
  color: string;
  /** Muss zur Rundung des Kindes passen, sonst sitzt der Schein schief. */
  radius?: number;
  intensity?: GlowIntensity;
  /** Ein voller Atemzug in Millisekunden. Langsam wirkt teuer, schnell wirkt hektisch. */
  durationMs?: number;
  style?: StyleProp<ViewStyle>;
};

/**
 * Legt einen atmenden Lichthof hinter (genauer: um) sein Kind.
 *
 * Der Hof liegt als eigene Ebene knapp AUSSERHALB des Kindes – nicht darin.
 * Das ist wichtig, weil Karten `overflow: 'hidden'` haben: innen würde der
 * Schein abgeschnitten und man sähe nur eine harte Kante.
 */
export function Glow({
  children,
  active = true,
  color,
  radius = Radius.card,
  intensity = 'soft',
  durationMs = 2400,
  style,
}: GlowProps) {
  // Steht still bei „Bewegung reduzieren" UND solange die Seite nicht vorn ist (motion-pause.tsx).
  const reduced = useStill();
  const cfg = INTENSITY[intensity];
  const pulse = useSharedValue(0);

  useEffect(() => {
    cancelAnimation(pulse);
    if (!active) {
      pulse.value = 0;
      return;
    }
    // „Bewegung reduzieren": ein stehender, mittlerer Schein. Die Information
    // („hier ist was") bleibt, die Bewegung fällt weg.
    if (reduced) {
      pulse.value = 0.6;
      return;
    }
    pulse.value = 0;
    pulse.value = withRepeat(
      withTiming(1, { duration: durationMs, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
    return () => cancelAnimation(pulse);
  }, [active, reduced, durationMs, pulse]);

  const halo = useAnimatedStyle(() => ({
    opacity: interpolate(pulse.value, [0, 1], [cfg.min, cfg.max]),
    transform: [{ scale: interpolate(pulse.value, [0, 1], [1, cfg.scaleTo]) }],
  }));

  if (!active) return <View style={style}>{children}</View>;

  return (
    <View style={style}>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.halo,
          {
            borderRadius: radius + 3,
            borderWidth: cfg.ring,
            borderColor: color,
            // Der eigentliche Schein. Mitte bleibt durchsichtig, damit die
            // Karte darüber unverfälscht bleibt – gefüllt würde sie einfärben.
            boxShadow: `0px 0px ${cfg.blur}px ${cfg.spread}px ${color}`,
          },
          halo,
        ]}
      />
      {children}
    </View>
  );
}

export type PulseProps = {
  children: ReactNode;
  /** Aus = das Kind steht still, ohne zusätzliche Ebene. */
  active?: boolean;
  /**
   * Wie weit die Skalierung geht. 1.06 ist sichtbar, ohne dass das Element
   * „atmet wie ein Ballon" – darüber wirkt es hektisch, darunter merkt es niemand.
   */
  scaleTo?: number;
  /** Ein voller Puls in Millisekunden. */
  durationMs?: number;
  style?: StyleProp<ViewStyle>;
};

/**
 * Lässt sein Kind langsam größer und wieder kleiner werden.
 *
 * Gedacht für den EINEN Knopf, der etwas Neues in die App bringt (den ＋-Knopf).
 * Zusammen mit {@link Glow} ergibt das die Kombination „pulsieren und leicht
 * aufleuchten": Der Lichthof liegt außen und atmet in der Helligkeit, der Puls
 * bewegt das Element selbst.
 *
 * Warum die Skalierung hier und nicht im `Glow`: Der Lichthof liegt als
 * Geschwister-Ebene NEBEN dem Kind, nicht darum. Skalierte man ihn mit, wanderte
 * er unter dem Knopf hervor. Beide Ebenen brauchen also eigene Bewegung – und mit
 * unterschiedlichen Dauern (hier 1600 ms, Lichthof 3600 ms) überlagern sie sich zu
 * etwas, das nicht wie eine Schleife aussieht.
 */
export function Pulse({
  children,
  active = true,
  scaleTo = 1.06,
  durationMs = 1600,
  style,
}: PulseProps) {
  // Steht still bei „Bewegung reduzieren" UND solange die Seite nicht vorn ist (motion-pause.tsx).
  const reduced = useStill();
  const beat = useSharedValue(0);

  useEffect(() => {
    cancelAnimation(beat);
    if (!active || reduced) {
      beat.value = 0;
      return;
    }
    beat.value = 0;
    beat.value = withRepeat(
      withTiming(1, { duration: durationMs, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
    return () => cancelAnimation(beat);
  }, [active, reduced, durationMs, beat]);

  const pulse = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(beat.value, [0, 1], [1, scaleTo]) }],
  }));

  // Ohne Animation kein `Animated.View`: Der Ruhezustand soll nichts kosten.
  if (!active || reduced) return <View style={style}>{children}</View>;

  return <Animated.View style={[style, pulse]}>{children}</Animated.View>;
}

export type PulseDotProps = {
  color: string;
  size?: number;
  /** Aus = stiller Punkt, ohne Ring. */
  active?: boolean;
};

/**
 * Der „läuft gerade"-Punkt: ein Kern mit einem Ring, der aufgeht und verblasst.
 *
 * Aus Live-Sendern und Karten-Apps vertraut und in einer Zeile Text erklärt:
 * Das hier ist nicht bloß ein Datum, das passiert JETZT.
 */
export function PulseDot({ color, size = 7, active = true }: PulseDotProps) {
  // Steht still bei „Bewegung reduzieren" UND solange die Seite nicht vorn ist (motion-pause.tsx).
  const reduced = useStill();
  const wave = useSharedValue(0);

  useEffect(() => {
    cancelAnimation(wave);
    if (!active || reduced) {
      wave.value = 0;
      return;
    }
    wave.value = 0;
    wave.value = withRepeat(withTiming(1, { duration: 1600, easing: Easing.out(Easing.quad) }), -1, false);
    return () => cancelAnimation(wave);
  }, [active, reduced, wave]);

  const ring = useAnimatedStyle(() => ({
    opacity: interpolate(wave.value, [0, 1], [0.55, 0]),
    transform: [{ scale: interpolate(wave.value, [0, 1], [1, 2.8]) }],
  }));

  return (
    <View style={[styles.dotBox, { width: size, height: size }]}>
      {active ? (
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { borderRadius: size, backgroundColor: color },
            ring,
          ]}
        />
      ) : null}
      <View style={{ width: size, height: size, borderRadius: size, backgroundColor: color }} />
    </View>
  );
}

export type ShimmerProps = {
  /** Farbe des Lichtbandes – meist Weiß bzw. Schwarz mit kleiner Deckkraft. */
  color: string;
  radius?: number;
  durationMs?: number;
  /** Ruhe nach jedem Durchzug (ms). 0 = durchgehend. */
  restMs?: number;
  style?: StyleProp<ViewStyle>;
};

/**
 * Ein Lichtband, das einmal quer über die Fläche zieht.
 *
 * Zwei Aufgaben: Ladeflächen als „lädt noch" kennzeichnen und volle
 * Fortschrittsbalken als „hier ist gerade was passiert" markieren.
 */
export function Shimmer({ color, radius = 0, durationMs = 1500, restMs = 0, style }: ShimmerProps) {
  // Steht still bei „Bewegung reduzieren" UND solange die Seite nicht vorn ist (motion-pause.tsx).
  const reduced = useStill();
  const [width, setWidth] = useState(0);
  const x = useSharedValue(0);
  const running = width > 0 && !reduced;

  // Ohne Pause (`restMs` 0, etwa „lädt noch"): durchgehend.
  useEffect(() => {
    cancelAnimation(x);
    x.value = 0;
    if (!running || restMs > 0) return;
    x.value = withRepeat(withTiming(1, { duration: durationMs, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(x);
  }, [running, durationMs, restMs, x]);
  // Mit Pause im Takt (motion-pause.tsx): einmal durchziehen, dann ruht das Band
  // draußen und unsichtbar – und bis zum nächsten Mal läuft gar nichts.
  useBeat(
    () => {
      x.set(withSequence(withTiming(0, { duration: 0 }), withTiming(1, { duration: durationMs, easing: Easing.linear })));
    },
    durationMs + restMs,
    running && restMs > 0,
    0,
  );

  const sweep = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(x.value, [0, 1], [-width, width]) }],
  }));

  const onLayout = (event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.width);
    setWidth((prev) => (prev === next ? prev : next));
  };

  return (
    <View
      pointerEvents="none"
      onLayout={onLayout}
      style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: 'hidden' }, style]}>
      <Animated.View style={[styles.band, sweep]}>
        <LinearGradient
          colors={['transparent', color, 'transparent']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
    </View>
  );
}

export type SkeletonProps = {
  /** Grundfläche (ruhiges Grau/Blau aus dem Thema). */
  color: string;
  /** Farbe des Lichtbandes darüber. */
  sheenColor: string;
  width?: number | `${number}%`;
  height?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
};

/**
 * Platzhalter in der Form des späteren Inhalts.
 *
 * Ersetzt den drehenden Kreis. Ein Spinner sagt „warte"; ein Platzhalter sagt
 * „hier kommen gleich drei Karten" – die Seite wirkt dadurch messbar schneller,
 * weil das Layout schon steht, wenn die Daten eintreffen.
 */
export function Skeleton({
  color,
  sheenColor,
  width = '100%',
  height = 14,
  radius = 8,
  style,
}: SkeletonProps) {
  return (
    <View style={[{ width, height, borderRadius: radius, backgroundColor: color, overflow: 'hidden' }, style]}>
      <Shimmer color={sheenColor} radius={radius} />
    </View>
  );
}

const styles = StyleSheet.create({
  // Knapp außerhalb des Kindes: so bleibt der Schein sichtbar, auch wenn das
  // Kind selbst seinen Inhalt abschneidet.
  halo: {
    position: 'absolute',
    top: -3,
    left: -3,
    right: -3,
    bottom: -3,
  },
  dotBox: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 60 % der Breite: schmal genug, dass es als Lichtband liest, breit genug,
  // dass der Verlauf weich bleibt.
  band: {
    width: '60%',
    height: '100%',
  },
});
