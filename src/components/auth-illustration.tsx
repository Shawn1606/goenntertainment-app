import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

/**
 * Maskottchen der alten Web-App: eine Reihe runder Interessen-Badges
 * (Sport, Leute, Entdecken, Foto, Liebe) über einer Gruppe verbundener
 * Köpfchen (Community). Reine Deko.
 */

type Badge = {
  border: string;
  color: string;
  icon: React.ReactNode;
};

const BADGES: Badge[] = [
  {
    border: '#d8b4fe',
    color: '#a855f7',
    icon: (
      <>
        <Circle cx="5.5" cy="17.5" r="3.5" />
        <Circle cx="18.5" cy="17.5" r="3.5" />
        <Path
          d="M5.5 17.5h5M13.5 17.5h5M9 14l1.5-3h3L15 14"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
        />
      </>
    ),
  },
  {
    border: '#f9a8d4',
    color: '#ec4899',
    icon: (
      <Path
        d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
      />
    ),
  },
  {
    border: '#fdba74',
    color: '#f97316',
    icon: (
      <>
        <Circle cx="12" cy="12" r="9" strokeWidth={1.5} />
        <Path d="M12 3v18M3 12h18" strokeLinecap="round" strokeWidth={1.5} />
      </>
    ),
  },
  {
    border: '#c4b5fd',
    color: '#8b5cf6',
    icon: (
      <>
        <Path
          d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
        />
        <Circle cx="12" cy="13" r="3" strokeWidth={1.5} />
      </>
    ),
  },
  {
    border: '#fda4af',
    color: '#f43f5e',
    icon: (
      <Path
        d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
        fill="currentColor"
      />
    ),
  },
];

export function AuthIllustration({ size = 'normal' }: { size?: 'normal' | 'large' }) {
  const large = size === 'large';
  const badgeSize = large ? 52 : 40;
  const iconSize = large ? 26 : 20;
  const communityHeight = large ? 160 : 110;

  return (
    <View style={[styles.wrapper, large && styles.wrapperLarge]} pointerEvents="none">
      <View style={[styles.badges, large && styles.badgesLarge]}>
        {BADGES.map((badge, i) => (
          <View
            key={i}
            style={[
              styles.badge,
              { width: badgeSize, height: badgeSize, borderRadius: badgeSize / 2, borderColor: badge.border },
            ]}>
            <Svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke={badge.color} color={badge.color}>
              {badge.icon}
            </Svg>
          </View>
        ))}
      </View>

      <Svg width="100%" height={communityHeight} viewBox="0 0 280 120" fill="none">
        <Path
          d="M40 95 C40 95 55 60 70 60 C85 60 90 80 100 80 C110 80 115 55 130 55 C145 55 150 75 160 75 C170 75 175 50 190 50 C205 50 210 70 220 70 C230 70 240 95 240 95"
          stroke="#a78bfa"
          strokeOpacity={0.7}
          strokeWidth={2}
          strokeLinecap="round"
        />
        <Circle cx="70" cy="52" r="14" stroke="#a78bfa" strokeOpacity={0.7} strokeWidth={2} />
        <Circle cx="100" cy="48" r="14" stroke="#a78bfa" strokeOpacity={0.7} strokeWidth={2} />
        <Circle cx="130" cy="45" r="14" stroke="#a78bfa" strokeOpacity={0.7} strokeWidth={2} />
        <Circle cx="160" cy="48" r="14" stroke="#a78bfa" strokeOpacity={0.7} strokeWidth={2} />
        <Circle cx="190" cy="45" r="14" stroke="#a78bfa" strokeOpacity={0.7} strokeWidth={2} />
        <Circle cx="220" cy="52" r="14" stroke="#a78bfa" strokeOpacity={0.7} strokeWidth={2} />
        <Path
          d="M56 66 C56 66 70 78 84 78 M96 74 C96 74 110 86 124 86 M126 71 C126 71 140 83 154 83 M156 74 C156 74 170 86 184 86 M196 71 C196 71 210 83 224 83"
          stroke="#a78bfa"
          strokeOpacity={0.7}
          strokeWidth={2}
          strokeLinecap="round"
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    width: '100%',
    maxWidth: 320,
    alignItems: 'center',
    gap: 16,
  },
  wrapperLarge: {
    maxWidth: 420,
    gap: 22,
  },
  badges: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
  },
  badgesLarge: {
    gap: 16,
  },
  badge: {
    borderWidth: 2,
    backgroundColor: 'rgba(255,255,255,0.8)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
