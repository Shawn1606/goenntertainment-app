import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View, type ViewProps } from 'react-native';
import Svg, { Defs, Line, Pattern, RadialGradient, Rect, Stop } from 'react-native-svg';

import { Palette } from '@/constants/theme';
import { useResolvedScheme } from '@/lib/theme-preference';

/**
 * Leinwand der App – gebaut wie der Hintergrund von cira.systems, nur hell.
 *
 * Drei Schichten:
 *   1. fast weißer Grund (#fafafa) mit einem Hauch Verlauf,
 *   2. ein feines 1px-Raster (bei der Referenz weiß auf schwarz, hier dunkel
 *      auf weiß) – gibt Struktur, ohne aufzufallen,
 *   3. ein sehr dezenter Indigo-Schein oben rechts als einzige Farbe.
 *
 * Im Dunkelmodus liegen die Werte fast auf dem Original der Referenz.
 */

const GRID_SIZE = 32;

const LIGHT = {
  base: Palette.canvas,
  gradient: [Palette.canvas, '#f7f7f8', Palette.canvasAlt] as const,
  grid: Palette.grid,
  glow: Palette.indigo,
  glowOpacity: 0.1,
  glow2: Palette.cyan,
  glow2Opacity: 0.06,
};

const DARK = {
  base: Palette.canvasDark,
  gradient: [Palette.canvasDark, '#0d0d0d', Palette.canvasAltDark] as const,
  grid: Palette.gridDark,
  glow: Palette.indigoLight,
  glowOpacity: 0.16,
  glow2: Palette.cyan,
  glow2Opacity: 0.08,
};

/**
 * Bewusst OHNE `useWindowDimensions`: Die Fenstergröße ändert sich jedes Mal,
 * wenn die Tastatur auf- oder zugeht (Android läuft seit Expo SDK 54 zwingend
 * randlos). Hing die Leinwand daran, wurde bei jedem Tastendruck das komplette
 * SVG neu gezeichnet – Raster und Scheine flackerten sichtbar, während man ein
 * Formular ausfüllte. Prozentangaben überlässt das Skalieren dem nativen SVG,
 * ohne dass React neu rendern muss.
 */
export function HomeBackground({ children, style, ...rest }: ViewProps) {
  const scheme = useResolvedScheme();
  const p = scheme === 'dark' ? DARK : LIGHT;

  return (
    <View style={[styles.container, { backgroundColor: p.base }, style]} {...rest}>
      <LinearGradient
        colors={p.gradient}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" pointerEvents="none">
        <Defs>
          {/* Feines Raster – zwei 1px-Linien, gekachelt. */}
          <Pattern id="grid" width={GRID_SIZE} height={GRID_SIZE} patternUnits="userSpaceOnUse">
            <Line x1="0" y1="0" x2={GRID_SIZE} y2="0" stroke={p.grid} strokeWidth="1" />
            <Line x1="0" y1="0" x2="0" y2={GRID_SIZE} stroke={p.grid} strokeWidth="1" />
          </Pattern>
          <RadialGradient id="home-glow" cx="86%" cy="4%" r="62%">
            <Stop offset="0" stopColor={p.glow} stopOpacity={String(p.glowOpacity)} />
            <Stop offset="0.75" stopColor={p.glow} stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id="home-glow-2" cx="6%" cy="78%" r="55%">
            <Stop offset="0" stopColor={p.glow2} stopOpacity={String(p.glow2Opacity)} />
            <Stop offset="0.8" stopColor={p.glow2} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#grid)" />
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#home-glow)" />
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#home-glow-2)" />
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
