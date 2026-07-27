import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, useWindowDimensions, View, type ViewProps } from 'react-native';
import Svg, { Defs, Path, RadialGradient, Stop } from 'react-native-svg';

import { useResolvedScheme } from '@/lib/theme-preference';

/**
 * Home-Hintergrund in derselben Farbpalette wie der Pre-Login-Screen
 * (GoennBackground): Pfirsich → Pink → Lavendel plus weiche Pfirsich-/Pink-
 * Scheine. Bewusst minimalistisch – hier statisch, ohne die animierten
 * Wellen und Kreise des Login-Screens.
 *
 * Im Dark-Mode (App-Einstellung) kippt die Palette in dunkle Violett-/Nacht-
 * Töne, damit der Hintergrund spürbar abdunkelt.
 */

// Heller Modus: Pfirsich → Pink → Lavendel.
const LIGHT = {
  base: '#ffdcc4',
  gradient: ['#ffdcc4', '#ffcbe6', '#dcc0ff'] as const,
  peach: '#ffb28c',
  peachOpacity: 0.9,
  pink: '#ff9ecf',
  pinkOpacity: 0.55,
};

// Dunkler Modus: tiefe Nacht-Violett-Töne, gleiche Komposition.
const DARK = {
  base: '#0d0b16',
  gradient: ['#151022', '#1c1330', '#241a3d'] as const,
  peach: '#7c3aed',
  peachOpacity: 0.45,
  pink: '#9f67ff',
  pinkOpacity: 0.35,
};

export function HomeBackground({ children, style, ...rest }: ViewProps) {
  const { width, height } = useWindowDimensions();
  const scheme = useResolvedScheme();
  const p = scheme === 'dark' ? DARK : LIGHT;

  return (
    <View style={[styles.container, { backgroundColor: p.base }, style]} {...rest}>
      {/* Basis-Verlauf */}
      <LinearGradient
        colors={p.gradient}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      {/* Weiche Farbscheine: oben rechts, unten links */}
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" pointerEvents="none">
        <Defs>
          <RadialGradient id="home-peach" cx="88%" cy="6%" r="60%">
            <Stop offset="0" stopColor={p.peach} stopOpacity={String(p.peachOpacity)} />
            <Stop offset="0.7" stopColor={p.peach} stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id="home-pink" cx="8%" cy="72%" r="55%">
            <Stop offset="0" stopColor={p.pink} stopOpacity={String(p.pinkOpacity)} />
            <Stop offset="0.75" stopColor={p.pink} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Path d={`M0 0 H${width} V${height} H0 Z`} fill="url(#home-peach)" />
        <Path d={`M0 0 H${width} V${height} H0 Z`} fill="url(#home-pink)" />
      </Svg>

      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: 'hidden',
  },
});
