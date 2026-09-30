import { type ReactNode, useEffect, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { Palette } from '@/constants/theme';

/**
 * Maskottchen der Anmelde-Screens: eine Gruppe verbundener Menschen in der
 * Mitte, umkreist von fünf Interessen-Abzeichen (Sport, Leute, Entdecken,
 * Foto, Liebe).
 *
 * Die Abzeichen liegen als Fünfeck auf einer Umlaufbahn – berechnet aus Winkel
 * und Radius, nicht von Hand positioniert. Dadurch stimmt der Kreis bei jeder
 * Größe. Jedes Abzeichen schwebt leicht (versetzt), damit die Szene lebt,
 * ohne abzulenken. Reine Deko, kein Zustand.
 */

const NATIVE = Platform.OS !== 'web';

/** Fünfeck: oben starten, dann alle 72° weiter. */
const ANGLES = [-90, -18, 54, 126, 198] as const;

type Badge = {
  key: string;
  /** Kontur + Linienfarbe des Icons. */
  tint: string;
  /** Ring um das Abzeichen. */
  ring: string;
  icon: (color: string) => ReactNode;
};

const BADGES: Badge[] = [
  {
    key: 'sport',
    tint: '#4f46e5',
    ring: '#c7d2fe',
    // Fahrrad: zwei Laufräder mit Nabe, Rahmen, Sattel und Lenker.
    icon: (c) => (
      <>
        <Circle cx="5.4" cy="16.6" r="4.2" stroke={c} strokeWidth={1.5} />
        <Circle cx="18.6" cy="16.6" r="4.2" stroke={c} strokeWidth={1.5} />
        <Circle cx="5.4" cy="16.6" r="0.9" fill={c} />
        <Circle cx="18.6" cy="16.6" r="0.9" fill={c} />
        <Path
          d="M5.4 16.6h4.4l3.1-6.9 5.7 6.9M9.8 16.6l2.2-6.9"
          stroke={c}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Path d="M10.4 9.7h3.4M13.1 9.7l2.3-2.2h2" stroke={c} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
  },
  {
    key: 'leute',
    tint: '#7c3aed',
    ring: '#ddd6fe',
    // Drei Personen: eine vorn, zwei angeschnitten dahinter.
    icon: (c) => (
      <>
        <Circle cx="4.8" cy="10.4" r="2.1" stroke={c} strokeWidth={1.4} />
        <Path d="M1.7 18.2c0-1.9 1.3-3.5 3.1-3.8" stroke={c} strokeWidth={1.4} strokeLinecap="round" />
        <Circle cx="19.2" cy="10.4" r="2.1" stroke={c} strokeWidth={1.4} />
        <Path d="M22.3 18.2c0-1.9-1.3-3.5-3.1-3.8" stroke={c} strokeWidth={1.4} strokeLinecap="round" />
        <Circle cx="12" cy="7.6" r="3.1" stroke={c} strokeWidth={1.6} />
        <Path d="M6.4 19.6c0-3.1 2.5-5.6 5.6-5.6s5.6 2.5 5.6 5.6" stroke={c} strokeWidth={1.6} strokeLinecap="round" />
      </>
    ),
  },
  {
    key: 'entdecken',
    tint: '#0891b2',
    ring: '#a5f3fc',
    // Kompass: Gehäuse, Himmelsrichtungen, Nadel.
    icon: (c) => (
      <>
        <Circle cx="12" cy="12" r="9" stroke={c} strokeWidth={1.5} />
        <Path d="M12 3.6v1.7M12 18.7v1.7M3.6 12h1.7M18.7 12h1.7" stroke={c} strokeWidth={1.4} strokeLinecap="round" />
        <Path
          d="M15.7 8.3l-1.9 5.5-5.5 1.9 1.9-5.5z"
          stroke={c}
          strokeWidth={1.5}
          strokeLinejoin="round"
          fill={c}
          fillOpacity={0.15}
        />
        <Circle cx="12" cy="12" r="0.9" fill={c} />
      </>
    ),
  },
  {
    key: 'foto',
    tint: '#6366f1',
    ring: '#a5b4fc',
    // Kamera: Gehäuse mit Sucherbuckel, Objektiv mit Innenring, Blitz.
    icon: (c) => (
      <>
        <Path
          d="M3 8.8a2 2 0 012-2h1.5a1.6 1.6 0 001.33-.71l.72-1.08A1.6 1.6 0 019.88 4.3h4.24c.54 0 1.04.27 1.33.71l.72 1.08c.3.44.8.71 1.33.71H19a2 2 0 012 2v8.2a2 2 0 01-2 2H5a2 2 0 01-2-2V8.8z"
          stroke={c}
          strokeWidth={1.5}
          strokeLinejoin="round"
        />
        <Circle cx="12" cy="13" r="3.7" stroke={c} strokeWidth={1.5} />
        <Circle cx="12" cy="13" r="1.5" stroke={c} strokeWidth={1.1} strokeOpacity={0.55} />
        <Circle cx="17.4" cy="9.7" r="0.85" fill={c} />
      </>
    ),
  },
  {
    key: 'liebe',
    tint: '#9333ea',
    ring: '#e9d5ff',
    // Herz mit Glanzlicht und kleinem Funkeln.
    icon: (c) => (
      <>
        <Path
          d="M12 20.4l-1.1-1C6.2 15.2 3.2 12.4 3.2 9.1 3.2 6.4 5.4 4.2 8.1 4.2c1.6 0 3.1.7 4 1.9.9-1.2 2.4-1.9 4-1.9 2.7 0 4.9 2.2 4.9 4.9 0 3.3-3 6.1-7.7 10.3l-1.3 1z"
          fill={c}
          fillOpacity={0.92}
        />
        <Path d="M7.9 8.1c.1-.9.7-1.6 1.5-1.9" stroke="#ffffff" strokeOpacity={0.9} strokeWidth={1.3} strokeLinecap="round" />
        <Path d="M19.6 16.9l.42 1.08 1.08.42-1.08.42-.42 1.08-.42-1.08-1.08-.42 1.08-.42z" fill={c} fillOpacity={0.55} />
      </>
    ),
  },
];

/**
 * Die Menschengruppe in der Mitte: drei Figuren, die vordere größer. Weiß
 * gefüllt, damit die Überlappungen sauber lesbar bleiben.
 */
function CommunityGroup({ size }: { size: number }) {
  const paper = 'rgba(255,255,255,0.94)';

  return (
    <Svg width={size} height={size} viewBox="0 0 120 120" fill="none">
      <Circle cx="60" cy="62" r="47" fill={Palette.indigo} fillOpacity={0.05} />

      {/* Hintere Figuren – links violett, rechts cyan. */}
      <Path
        d="M13 96c0-9.4 7.6-17 17-17s17 7.6 17 17"
        fill={paper}
        stroke={Palette.violet}
        strokeWidth={3.2}
        strokeLinecap="round"
      />
      <Circle cx="30" cy="60" r="10.5" fill={paper} stroke={Palette.violet} strokeWidth={3.2} />
      <Path
        d="M73 96c0-9.4 7.6-17 17-17s17 7.6 17 17"
        fill={paper}
        stroke={Palette.cyan}
        strokeWidth={3.2}
        strokeLinecap="round"
      />
      <Circle cx="90" cy="60" r="10.5" fill={paper} stroke={Palette.cyan} strokeWidth={3.2} />

      {/* Vordere Figur – Indigo, größer, verdeckt die anderen leicht. */}
      <Path
        d="M37 100c0-12.7 10.3-23 23-23s23 10.3 23 23"
        fill={paper}
        stroke={Palette.indigo}
        strokeWidth={3.6}
        strokeLinecap="round"
      />
      <Circle cx="60" cy="48" r="13.5" fill={paper} stroke={Palette.indigo} strokeWidth={3.6} />
    </Svg>
  );
}

/** Ein Abzeichen auf der Umlaufbahn – schwebt versetzt zu den anderen. */
function OrbitBadge({
  badge,
  index,
  size,
  iconSize,
  left,
  top,
}: {
  badge: Badge;
  index: number;
  size: number;
  iconSize: number;
  left: number;
  top: number;
}) {
  const [float] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(float, {
          toValue: 1,
          duration: 2200,
          delay: index * 260,
          useNativeDriver: NATIVE,
          easing: Easing.inOut(Easing.ease),
        }),
        Animated.timing(float, {
          toValue: 0,
          duration: 2200,
          useNativeDriver: NATIVE,
          easing: Easing.inOut(Easing.ease),
        }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [float, index]);

  const translateY = float.interpolate({ inputRange: [0, 1], outputRange: [0, -5] });

  return (
    <Animated.View
      style={[
        styles.badge,
        {
          left,
          top,
          width: size,
          height: size,
          borderRadius: size / 2,
          borderColor: badge.ring,
          transform: [{ translateY }],
        },
      ]}>
      <Svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none">
        {badge.icon(badge.tint)}
      </Svg>
    </Animated.View>
  );
}

export function AuthIllustration({ size = 'normal' }: { size?: 'normal' | 'large' }) {
  const large = size === 'large';

  const box = large ? 300 : 226;
  const badgeSize = large ? 60 : 46;
  const iconSize = large ? 30 : 23;
  const groupSize = Math.round(box * 0.46);

  // Umlaufbahn: die Abzeichen sitzen mit ihrem Mittelpunkt auf diesem Radius.
  const center = box / 2;
  const radius = center - badgeSize / 2 - 1;

  return (
    <View style={[styles.wrapper, { width: box, height: box }]} pointerEvents="none">
      {/* Angedeutete Bahn, damit der Kreis auch ohne Bewegung lesbar ist. */}
      <Svg width={box} height={box} style={StyleSheet.absoluteFill}>
        <Circle
          cx={center}
          cy={center}
          r={radius}
          stroke={Palette.indigo}
          strokeOpacity={0.18}
          strokeWidth={1.5}
          strokeDasharray="2 8"
          strokeLinecap="round"
          fill="none"
        />
      </Svg>

      <View style={[styles.group, { top: (box - groupSize) / 2, left: (box - groupSize) / 2 }]}>
        <CommunityGroup size={groupSize} />
      </View>

      {BADGES.map((badge, i) => {
        const rad = (ANGLES[i] * Math.PI) / 180;
        return (
          <OrbitBadge
            key={badge.key}
            badge={badge}
            index={i}
            size={badgeSize}
            iconSize={iconSize}
            left={center + radius * Math.cos(rad) - badgeSize / 2}
            top={center + radius * Math.sin(rad) - badgeSize / 2}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignSelf: 'center',
  },
  group: {
    position: 'absolute',
  },
  badge: {
    position: 'absolute',
    borderWidth: 2,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      android: { elevation: 2 },
      default: {
        shadowColor: Palette.indigo,
        shadowOpacity: 0.16,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
      },
    }),
  },
});
