import { StyleSheet, View, type ViewProps } from 'react-native';
import Svg, {
  Defs,
  LinearGradient as SvgLinearGradient,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';

/**
 * Der weiche Pastell-Hintergrund der alten Web-App (`goenn-bg`):
 * ein linearer Grundverlauf plus drei radiale Farbwolken
 * (Lavendel oben links, Pfirsich oben rechts, Pink unten mittig).
 */
export function GoennBackground({ children, style, ...rest }: ViewProps) {
  return (
    <View style={[styles.container, style]} {...rest}>
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
        <Defs>
          <SvgLinearGradient id="base" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#f5eeff" />
            <Stop offset="0.4" stopColor="#fff0eb" />
            <Stop offset="1" stopColor="#fde8f4" />
          </SvgLinearGradient>
          <RadialGradient id="lavender" cx="0.2" cy="0.2" r="0.6">
            <Stop offset="0" stopColor="#e8d5ff" stopOpacity="0.9" />
            <Stop offset="0.6" stopColor="#e8d5ff" stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id="peach" cx="0.8" cy="0.3" r="0.6">
            <Stop offset="0" stopColor="#ffb4a2" stopOpacity="0.85" />
            <Stop offset="0.55" stopColor="#ffb4a2" stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id="pink" cx="0.5" cy="0.85" r="0.55">
            <Stop offset="0" stopColor="#ff6bb5" stopOpacity="0.4" />
            <Stop offset="0.5" stopColor="#ff6bb5" stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#base)" />
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#lavender)" />
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#peach)" />
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#pink)" />
      </Svg>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5eeff',
  },
});
