import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, StyleSheet, useWindowDimensions, View, type ViewProps } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

/**
 * Weicher Pastell-Hintergrund mit bunten Kugeln, die sich langsam wie Wellen
 * bewegen. Basis ist ein linearer Verlauf; darüber driften mehrere farbige
 * Kugeln (radialer Verlauf = weiche Ränder) in Endlosschleife.
 */

type OrbSpec = {
  id: string;
  color: string;
  size: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  duration: number;
};

function Orb({ id, color, size, x, y, dx, dy, duration }: OrbSpec) {
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(t, { toValue: 1, duration, useNativeDriver: Platform.OS !== 'web', easing: Easing.inOut(Easing.ease) }),
        Animated.timing(t, { toValue: 0, duration, useNativeDriver: Platform.OS !== 'web', easing: Easing.inOut(Easing.ease) }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [duration, t]);

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

  const orbs: OrbSpec[] = [
    { id: 'orb-lav', color: '#e8d5ff', size: width * 0.95, x: -width * 0.3, y: -height * 0.05, dx: 34, dy: 46, duration: 6200 },
    { id: 'orb-peach', color: '#ffb4a2', size: width * 0.85, x: width * 0.4, y: -height * 0.02, dx: -28, dy: 52, duration: 7400 },
    { id: 'orb-pink', color: '#ff9ec9', size: width * 0.9, x: width * 0.05, y: height * 0.58, dx: 38, dy: -44, duration: 8200 },
    { id: 'orb-purple', color: '#c4a5ff', size: width * 0.65, x: width * 0.5, y: height * 0.38, dx: -32, dy: 34, duration: 6800 },
  ];

  return (
    <View style={[styles.container, style]} {...rest}>
      <LinearGradient
        colors={['#f5eeff', '#fff0eb', '#fde8f4']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {orbs.map((orb) => (
          <Orb key={orb.id} {...orb} />
        ))}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5eeff',
    overflow: 'hidden',
  },
});
