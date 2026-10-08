import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { Animated, Dimensions, Easing, Platform, StyleSheet, View, type ViewProps } from 'react-native';
import Svg, { Circle, Defs, Line, Path, Pattern, RadialGradient, Rect, Stop } from 'react-native-svg';

import { Palette } from '@/constants/theme';

/**
 * Hintergrund der Anmelde-Screens – gleiche helle Leinwand wie in der App
 * (fast weiß + feines Raster + ein Indigo-Schein), aber mit Bewegung: zwei
 * schwebende Scheine und eine sehr weiche Welle unten.
 *
 * Bewusst zurückhaltend: die Bewegung soll man eher spüren als sehen. Animation
 * via nativem Treiber am Gerät; im Web JS-Treiber.
 */

const GRID_SIZE = 32;

const NATIVE = Platform.OS !== 'web';

function useLoop(duration: number) {
  const [t] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(t, { toValue: 1, duration, useNativeDriver: NATIVE, easing: Easing.inOut(Easing.ease) }),
        Animated.timing(t, { toValue: 0, duration, useNativeDriver: NATIVE, easing: Easing.inOut(Easing.ease) }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [duration, t]);
  return t;
}

/** Eine lila Welle am unteren Rand, die seitlich schwingt. */
function Wave({ color, height, bottom, amp, duration }: { color: string; height: number; bottom: number; amp: number; duration: number }) {
  const t = useLoop(duration);
  const translateX = t.interpolate({ inputRange: [0, 1], outputRange: [-amp, amp] });

  return (
    <Animated.View
      pointerEvents="none"
      style={{ position: 'absolute', left: -amp - 20, right: -amp - 20, bottom, height, transform: [{ translateX }] }}>
      <Svg width="100%" height={height} viewBox="0 0 400 120" preserveAspectRatio="none">
        <Path d="M0,55 C70,15 150,20 210,50 C270,80 340,85 400,45 L400,120 L0,120 Z" fill={color} />
      </Svg>
    </Animated.View>
  );
}

/** Kleiner schwebender Kreis mit weichem Rand. */
function Orb({ id, color, size, x, y, dx, dy, duration }: { id: string; color: string; size: number; x: number; y: number; dx: number; dy: number; duration: number }) {
  const t = useLoop(duration);
  const translateX = t.interpolate({ inputRange: [0, 1], outputRange: [0, dx] });
  const translateY = t.interpolate({ inputRange: [0, 1], outputRange: [0, dy] });

  return (
    <Animated.View
      pointerEvents="none"
      style={{ position: 'absolute', left: x, top: y, width: size, height: size, transform: [{ translateX }, { translateY }] }}>
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id={id} cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={color} stopOpacity="0.22" />
            <Stop offset="1" stopColor={color} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={size / 2} fill={`url(#${id})`} />
      </Svg>
    </Animated.View>
  );
}

/**
 * Bewusst OHNE `useWindowDimensions()`: Unter dem ab SDK 54 erzwungenen
 * edge-to-edge ändert sich die Fenstergröße bei JEDEM Auf- und Zugehen der
 * Tastatur. Hing der Hintergrund daran, wurden auf den Anmelde-Screens beim
 * Tippen das komplette SVG, drei animierte Scheine und zwei Wellen neu
 * aufgebaut – sichtbares Flackern genau dort, wo man gerade schreibt.
 *
 * Flächen nehmen deshalb Prozentwerte (skalieren nativ ohne Re-Render), und die
 * Positionen der Scheine/Wellen stehen auf einem Maß, das beim Einhängen einmal
 * gelesen wird. Die App ist auf Hochformat festgelegt, also ändert sich dieses
 * Maß im Betrieb ohnehin nicht. `home-background.tsx` ist genauso gebaut.
 */
export function GoennBackground({ children, style, ...rest }: ViewProps) {
  const [{ width, height }] = useState(() => Dimensions.get('window'));

  return (
    <View style={[styles.container, style]} {...rest}>
      {/* Fast weißer Grund mit einem Hauch Verlauf */}
      <LinearGradient
        colors={[Palette.canvas, '#f7f7f8', Palette.canvasAlt]}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      {/* Feines Raster + zwei dezente Scheine (Indigo oben rechts, Cyan unten links) */}
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" pointerEvents="none">
        <Defs>
          <Pattern id="auth-grid" width={GRID_SIZE} height={GRID_SIZE} patternUnits="userSpaceOnUse">
            <Line x1="0" y1="0" x2={GRID_SIZE} y2="0" stroke={Palette.grid} strokeWidth="1" />
            <Line x1="0" y1="0" x2="0" y2={GRID_SIZE} stroke={Palette.grid} strokeWidth="1" />
          </Pattern>
          <RadialGradient id="indigoGlow" cx="86%" cy="4%" r="62%">
            <Stop offset="0" stopColor={Palette.indigo} stopOpacity="0.14" />
            <Stop offset="0.75" stopColor={Palette.indigo} stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id="cyanGlow" cx="6%" cy="72%" r="55%">
            <Stop offset="0" stopColor={Palette.cyan} stopOpacity="0.08" />
            <Stop offset="0.8" stopColor={Palette.cyan} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#auth-grid)" />
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#indigoGlow)" />
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#cyanGlow)" />
      </Svg>

      {/* Schwebende Scheine – sehr leise */}
      <Orb id="c-indigo" color={Palette.indigo} size={110} x={-30} y={height * 0.42} dx={16} dy={20} duration={6000} />
      <Orb id="c-violet" color={Palette.violet} size={84} x={width - 48} y={height * 0.34} dx={-14} dy={22} duration={7200} />
      <Orb id="c-cyan" color={Palette.cyan} size={68} x={width * 0.5} y={height * 0.2} dx={12} dy={-16} duration={8400} />

      {/* Eine weiche Welle unten statt drei bunter */}
      <Wave color="rgba(99,102,241,0.09)" height={height * 0.26} bottom={0} amp={24} duration={9000} />
      <Wave color="rgba(6,182,212,0.05)" height={height * 0.18} bottom={0} amp={30} duration={7000} />

      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Palette.canvas,
    overflow: 'hidden',
  },
});
