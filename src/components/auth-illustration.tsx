import { Platform, StyleSheet, View } from 'react-native';
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';

/**
 * Maskottchen: detaillierte Interessen-Symbole (Sport, Leute, Entdecken, Foto,
 * Liebe) schweben als weiche Kreis-Badges in einem Bogen über der Gruppe
 * verbundener Personen. Die Personen bleiben bewusst schlicht (Strichzeichnung).
 */

type Badge = {
  cx: number;
  cy: number;
  border: string;
  color: string;
  light: string;
  icon: (c: string, cl: string) => React.ReactNode;
};

// Detaillierte, zweifarbige Icons (24×24).
const icons = {
  heart: (c: string) => (
    <>
      <Path
        d="M12 21l-1.6-1.45C4.9 14.6 2 11.9 2 8.6 2 6 4 4 6.5 4c1.5 0 2.9.7 3.8 1.8L12 8l1.7-2.2C14.6 4.7 16 4 17.5 4 20 4 22 6 22 8.6c0 3.3-2.9 6-8.4 10.95L12 21z"
        fill={c}
      />
      <Path d="M6.4 6.3c-1 .15-1.7 1-1.7 2" stroke="#ffffff" strokeOpacity={0.7} strokeWidth={1.3} strokeLinecap="round" fill="none" />
    </>
  ),
  bike: (c: string) => (
    <>
      <Circle cx="6" cy="16.5" r="3.6" stroke={c} strokeWidth={1.6} fill="none" />
      <Circle cx="18" cy="16.5" r="3.6" stroke={c} strokeWidth={1.6} fill="none" />
      <Circle cx="6" cy="16.5" r="1" fill={c} />
      <Circle cx="18" cy="16.5" r="1" fill={c} />
      <Circle cx="11" cy="16.5" r="0.9" fill={c} />
      <Path d="M6 16.5 11 16.5 9.5 9 M11 16.5 15 9 18 16.5 M9.5 9 15 9" stroke={c} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <Path d="M8.4 9h2.2" stroke={c} strokeWidth={1.6} strokeLinecap="round" />
      <Path d="M14 9h2.4" stroke={c} strokeWidth={1.6} strokeLinecap="round" />
    </>
  ),
  people: (c: string, cl: string) => (
    <>
      <Circle cx="4.7" cy="9" r="2" fill={cl} />
      <Path d="M1.8 18v-2.3a2.9 2.9 0 015.8 0V18z" fill={cl} />
      <Circle cx="19.3" cy="9" r="2" fill={cl} />
      <Path d="M16.4 18v-2.3a2.9 2.9 0 015.8 0V18z" fill={cl} />
      <Circle cx="12" cy="6.6" r="2.7" fill={c} />
      <Path d="M7.4 18.5v-2.7a4.6 4.6 0 019.2 0v2.7z" fill={c} />
    </>
  ),
  compass: (c: string, cl: string) => (
    <>
      <Circle cx="12" cy="12" r="9" stroke={c} strokeWidth={1.6} fill="none" />
      <Path d="M12 12 15.6 8.4 13.4 13.2Z" fill={c} />
      <Path d="M12 12 8.4 15.6 10.6 10.8Z" fill={cl} />
      <Circle cx="12" cy="12" r="1.1" fill={c} />
    </>
  ),
  camera: (c: string, cl: string) => (
    <>
      <Path d="M8.6 6 9.5 4.4H14.5L15.4 6Z" fill={c} />
      <Rect x="3" y="6" width="18" height="13" rx="2.6" fill={cl} />
      <Circle cx="12" cy="12.6" r="3.7" fill="#ffffff" />
      <Circle cx="12" cy="12.6" r="3.7" stroke={c} strokeWidth={1.6} fill="none" />
      <Circle cx="12" cy="12.6" r="1.5" fill={c} />
      <Circle cx="17.6" cy="9" r="0.9" fill={c} />
    </>
  ),
};

const BADGES: Badge[] = [
  { cx: 28, cy: 118, border: '#fecdd3', color: '#f43f5e', light: '#fda4af', icon: (c) => icons.heart(c) },
  { cx: 80, cy: 58, border: '#ddd6fe', color: '#8b5cf6', light: '#c4b5fd', icon: (c) => icons.bike(c) },
  { cx: 150, cy: 32, border: '#fbcfe8', color: '#ec4899', light: '#f9a8d4', icon: (c, cl) => icons.people(c, cl) },
  { cx: 220, cy: 58, border: '#fed7aa', color: '#f97316', light: '#fdba74', icon: (c, cl) => icons.compass(c, cl) },
  { cx: 272, cy: 118, border: '#e0e7ff', color: '#6366f1', light: '#a5b4fc', icon: (c, cl) => icons.camera(c, cl) },
];

const BASE_W = 300;
const BASE_H = 235;

export function AuthIllustration({ size = 'normal' }: { size?: 'normal' | 'large' }) {
  const W = size === 'large' ? 300 : 240;
  const s = W / BASE_W;
  const H = BASE_H * s;
  const D = 56 * s; // Badge-Durchmesser
  const iconSize = D * 0.55;

  return (
    <View style={{ width: W, height: H, alignSelf: 'center' }} pointerEvents="none">
      {/* Bogen (gepunktet) + Personen im Hintergrund */}
      <Svg style={StyleSheet.absoluteFill} viewBox={`0 0 ${BASE_W} ${BASE_H}`}>
        <Path
          d="M28 118 Q52 82 80 58 Q112 34 150 32 Q188 34 220 58 Q248 82 272 118"
          stroke="#c4b5fd"
          strokeWidth={2}
          strokeLinecap="round"
          strokeDasharray="1 8"
          fill="none"
        />
        <G transform="translate(38 118) scale(0.8)" stroke="#a78bfa" strokeOpacity={0.7} strokeWidth={2.2} fill="none">
          <Path d="M40 95 C40 95 55 60 70 60 C85 60 90 80 100 80 C110 80 115 55 130 55 C145 55 150 75 160 75 C170 75 175 50 190 50 C205 50 210 70 220 70 C230 70 240 95 240 95" strokeLinecap="round" />
          <Circle cx="70" cy="52" r="14" />
          <Circle cx="100" cy="48" r="14" />
          <Circle cx="130" cy="45" r="14" />
          <Circle cx="160" cy="48" r="14" />
          <Circle cx="190" cy="45" r="14" />
          <Circle cx="220" cy="52" r="14" />
          <Path d="M56 66 C56 66 70 78 84 78 M96 74 C96 74 110 86 124 86 M126 71 C126 71 140 83 154 83 M156 74 C156 74 170 86 184 86 M196 71 C196 71 210 83 224 83" strokeLinecap="round" />
        </G>
      </Svg>

      {/* Badges als weiche Kreise auf dem Bogen */}
      {BADGES.map((b, i) => (
        <View
          key={i}
          style={[
            styles.badge,
            {
              left: b.cx * s - D / 2,
              top: b.cy * s - D / 2,
              width: D,
              height: D,
              borderRadius: D / 2,
              borderColor: b.border,
            },
          ]}>
          <Svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none">
            {b.icon(b.color, b.light)}
          </Svg>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    borderWidth: 2,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      android: { elevation: 3 },
      default: {
        shadowColor: '#7c3aed',
        shadowOpacity: 0.18,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 3 },
      },
    }),
  },
});
