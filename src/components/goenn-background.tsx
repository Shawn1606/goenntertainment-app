import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, StyleSheet, useWindowDimensions, View, type ViewProps } from 'react-native';
import Svg, { Circle, Defs, Path, RadialGradient, Stop } from 'react-native-svg';

/**
 * Hintergrund nach Referenz: heller Pastell-Verlauf, weicher Pfirsich-Schein
 * oben rechts, zwei schwebende Kreise und unten mehrere lila Wellen, die sich
 * langsam hin und her bewegen (fließend). Animation via nativem Treiber am
 * Gerät; im Web JS-Treiber.
 */

const NATIVE = Platform.OS !== 'web';

function useLoop(duration: number) {
  const t = useRef(new Animated.Value(0)).current;
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
            <Stop offset="0" stopColor={color} stopOpacity="0.8" />
            <Stop offset="1" stopColor={color} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={size / 2} fill={`url(#${id})`} />
      </Svg>
    </Animated.View>
  );
}

export function GoennBackground({ children, style, ...rest }: ViewProps) {
  const { width, height } = useWindowDimensions();

  return (
    <View style={[styles.container, style]} {...rest}>
      {/* Basis-Verlauf – kräftiger als vorher (Pfirsich → Pink → Lila) */}
      <LinearGradient
        colors={['#ffdcc4', '#ffcbe6', '#dcc0ff']}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      {/* Farbige Scheine: Pfirsich oben rechts, Pink unten links */}
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" pointerEvents="none">
        <Defs>
          <RadialGradient id="peachGlow" cx="88%" cy="6%" r="60%">
            <Stop offset="0" stopColor="#ffb28c" stopOpacity="0.95" />
            <Stop offset="0.7" stopColor="#ffb28c" stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id="pinkGlow" cx="8%" cy="70%" r="55%">
            <Stop offset="0" stopColor="#ff9ecf" stopOpacity="0.6" />
            <Stop offset="0.75" stopColor="#ff9ecf" stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Path d={`M0 0 H${width} V${height} H0 Z`} fill="url(#peachGlow)" />
        <Path d={`M0 0 H${width} V${height} H0 Z`} fill="url(#pinkGlow)" />
      </Svg>

      {/* schwebende Kreise – satter */}
      <Orb id="c-purple" color="#c39bf5" size={100} x={-24} y={height * 0.42} dx={16} dy={20} duration={6000} />
      <Orb id="c-peach" color="#ffb495" size={78} x={width - 44} y={height * 0.34} dx={-14} dy={22} duration={7200} />
      <Orb id="c-pink" color="#ff9ecf" size={64} x={width * 0.5} y={height * 0.2} dx={12} dy={-16} duration={8400} />

      {/* lila/pinke Wellen unten – kräftiger */}
      <Wave color="#f0cdf5" height={height * 0.32} bottom={0} amp={22} duration={9000} />
      <Wave color="#d9a6f0" height={height * 0.24} bottom={0} amp={30} duration={7000} />
      <Wave color="#b578e6" height={height * 0.16} bottom={0} amp={26} duration={8000} />

      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffdcc4',
    overflow: 'hidden',
  },
});
