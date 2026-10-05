/**
 * Die Stempelkarte – das Sammelalbum der App.
 *
 * ## Warum so viel Glitzer
 *
 * Ein Stempel ist hier eine kleine Belohnung, die man sich abgeholt hat: Man war
 * beim Partner, hat das Handy an den Aufkleber gehalten, und es hat „klick"
 * gemacht. Das soll sich anfühlen wie früher eine glänzende Sammelkarte im
 * Fußballalbum – etwas Wertvolles, das man gern anschaut. Deshalb:
 *
 *  - **Holo-Verlauf** in allen Markenfarben, schräg wie auf einer Glitzerkarte,
 *  - ein **Lichtband**, das langsam darüber zieht,
 *  - **funkelnde Sterne**, jeder im eigenen Takt,
 *  - ein **gezackter Rand** wie bei einem echten Stempel und eine leichte
 *    Schräglage – kein Stempel sitzt ganz gerade.
 *
 * Der frischeste Stempel landet mit einem „Aufdrücken" (groß → klein, leichte
 * Drehung) – genau der Moment, für den es die Karte gibt.
 *
 * Wer „Bewegung reduzieren" eingestellt hat, bekommt dieselbe Karte ohne
 * Funkeln und Lichtband. Wertvoll aussehen tut sie trotzdem.
 */
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useMemo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';

import { Icon } from '@/components/ui/icon';
import { Shimmer } from '@/components/ui/glow';
import { FontFamily, HoloGradient, Night, Radius, Spacing, Stroke } from '@/constants/theme';
import type { StampCard as StampCardData, StampEntry } from '@/lib/api';

/** Leichte Schräglage je Feld – fest, damit die Karte beim Neuzeichnen nicht zappelt. */
const TILTS = [-9, 6, -4, 11, -7, 5, -12, 8, -3, 10];

/** Vierzackiger Funkelstern in einer 24er-Box. */
const SPARKLE = 'M12 2l2.2 7.8L22 12l-7.8 2.2L12 22l-2.2-7.8L2 12l7.8-2.2z';

/** Gezackter Stempelrand: 24 Zacken um einen Kreis. */
function scallopPath(size: number, teeth = 24): string {
  const c = size / 2;
  const outer = c - 1;
  const inner = c - size * 0.06;
  let d = '';
  for (let i = 0; i < teeth * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (Math.PI * i) / teeth;
    const x = c + r * Math.cos(a);
    const y = c + r * Math.sin(a);
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`;
  }
  return `${d}Z`;
}

function initials(name: string | undefined): string {
  if (!name) return '★';
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '★';
}

/** Ein Funkelstern, der in seinem eigenen Takt aufblitzt. */
function Twinkle({ x, y, s, delay, reduced }: { x: number; y: number; s: number; delay: number; reduced: boolean }) {
  const t = useSharedValue(reduced ? 0.7 : 0);

  useEffect(() => {
    if (reduced) return;
    t.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 520, easing: Easing.out(Easing.quad) }),
          withTiming(0, { duration: 900, easing: Easing.in(Easing.quad) }),
          withTiming(0, { duration: 1400 }),
        ),
        -1,
        false,
      ),
    );
    return () => cancelAnimation(t);
  }, [reduced, delay, t]);

  const style = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0, 1], [0.15, 1]),
    transform: [{ scale: interpolate(t.value, [0, 1], [0.5, 1.15]) }, { rotate: `${interpolate(t.value, [0, 1], [0, 45])}deg` }],
  }));

  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: x, top: y, width: s, height: s }, style]}>
      <Svg width={s} height={s} viewBox="0 0 24 24">
        <Path d={SPARKLE} fill="#ffffff" />
      </Svg>
    </Animated.View>
  );
}

/** Ein gefülltes Feld: der Holo-Stempel. */
export function HoloStamp({
  size,
  index,
  entry,
  fresh = false,
}: {
  size: number;
  index: number;
  entry?: StampEntry | null;
  /** Gerade verdient – landet mit einem Aufdrücken. */
  fresh?: boolean;
}) {
  const reduced = useReducedMotion();
  const land = useSharedValue(fresh && !reduced ? 0 : 1);
  const tilt = TILTS[index % TILTS.length];
  const scallop = useMemo(() => scallopPath(size), [size]);

  useEffect(() => {
    if (!fresh || reduced) return;
    land.value = 0;
    land.value = withDelay(180, withSpring(1, { damping: 11, stiffness: 180, mass: 0.7 }));
  }, [fresh, reduced, land]);

  const stampStyle = useAnimatedStyle(() => ({
    opacity: interpolate(land.value, [0, 0.3, 1], [0, 1, 1]),
    transform: [
      { scale: interpolate(land.value, [0, 1], [1.9, 1]) },
      { rotate: `${interpolate(land.value, [0, 1], [tilt - 28, tilt])}deg` },
    ],
  }));

  const s = size;
  return (
    <Animated.View style={[{ width: s, height: s }, stampStyle]} accessible accessibilityLabel={`Stempel ${index + 1}${entry?.partner ? ` von ${entry.partner.name}` : ''}`}>
      {/* Schatten-Zacken hinten: das „aufgedrückte" Relief. */}
      <Svg width={s} height={s} style={StyleSheet.absoluteFill}>
        <Path d={scallop} fill="rgba(28,8,51,0.45)" transform={`translate(1.2 1.8)`} />
      </Svg>
      <View style={[styles.holoClip, { width: s, height: s, borderRadius: s / 2 }]}>
        <LinearGradient colors={[...HoloGradient]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        {/* Zweiter, quer laufender Verlauf: mischt die Farben wie Folie im Licht. */}
        <LinearGradient
          colors={['rgba(255,255,255,0.55)', 'rgba(255,255,255,0)', 'rgba(37,244,238,0.35)', 'rgba(255,255,255,0)']}
          start={{ x: 1, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        {reduced ? null : <Shimmer color="rgba(255,255,255,0.7)" radius={s / 2} durationMs={2600 + index * 180} />}
      </View>
      {/* Gezackter Rand und innerer Ring – das Stempel-Gesicht. */}
      <Svg width={s} height={s} style={StyleSheet.absoluteFill} pointerEvents="none">
        <Path d={scallop} fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth={1.4} />
        <Circle cx={s / 2} cy={s / 2} r={s * 0.34} fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth={1.2} strokeDasharray="2.5 2.5" />
      </Svg>
      <View style={styles.center} pointerEvents="none">
        <Text style={[styles.initials, { fontSize: s * 0.26 }]} numberOfLines={1}>
          {initials(entry?.partner?.name)}
        </Text>
      </View>
      <Twinkle x={s * 0.1} y={s * 0.06} s={s * 0.24} delay={index * 230} reduced={reduced} />
      <Twinkle x={s * 0.66} y={s * 0.62} s={s * 0.2} delay={index * 230 + 700} reduced={reduced} />
    </Animated.View>
  );
}

/** Ein leeres Feld: gestrichelter Kreis mit Nummer. Das letzte zeigt das Geschenk. */
function EmptySlot({ size, number, reward }: { size: number; number: number; reward: boolean }) {
  return (
    <View
      style={[styles.empty, { width: size, height: size, borderRadius: size / 2 }, reward && styles.emptyReward]}
      accessible
      accessibilityLabel={reward ? `Feld ${number}: hier gibt es die Credits` : `Feld ${number}, noch frei`}>
      {reward ? <Icon name="gift" size={size * 0.36} color="#fff1a8" /> : <Text style={[styles.number, { fontSize: size * 0.3 }]}>{number}</Text>}
    </View>
  );
}

/**
 * Die ganze Karte: zwei Reihen à fünf Felder auf dem Lila des Club-Auftritts.
 */
export function StampCard({
  card,
  freshIndex = null,
  compact = false,
  style,
}: {
  card: StampCardData;
  /** Welches Feld gerade verdient wurde (0-basiert) – für das Aufdrücken. */
  freshIndex?: number | null;
  /** Kompakt für die Startseite: eine Reihe, kleinere Felder, ohne Erklärtext. */
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const fields = card.fields;
  const slotSize = compact ? 26 : 54;

  return (
    <View style={[styles.card, compact && styles.cardCompact, style]}>
      <LinearGradient colors={[...Night.gradient]} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={StyleSheet.absoluteFill} />
      {/* Hintergrund-Glitzer wie im Logo. */}
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <View style={[styles.dot, { top: '18%', left: '8%', backgroundColor: '#ff7a98' }]} />
        <View style={[styles.dot, { top: '72%', right: '6%', backgroundColor: Night.sparkle }]} />
        <View style={[styles.dot, styles.dotSmall, { top: '10%', right: '24%', backgroundColor: '#ffffff' }]} />
      </View>

      {!compact ? (
        <View style={styles.head}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Stempelkarte</Text>
            <Text style={styles.subtitle}>
              {card.remaining === card.fields && card.completed_cards === 0
                ? `Sammle ${card.fields} Stempel bei unseren Partnern – dann gibt's ${card.reward_credits} Credits.`
                : `Noch ${card.remaining} bis ${card.reward_credits} Credits`}
            </Text>
          </View>
          {card.completed_cards > 0 ? (
            <View style={styles.cardsDone}>
              <Icon name="trophy" size={14} color="#fff1a8" />
              <Text style={styles.cardsDoneText}>{card.completed_cards}× voll</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={[styles.grid, compact && styles.gridCompact]}>
        {Array.from({ length: fields }, (_, i) => {
          const filled = i < card.filled;
          return (
            <View key={i} style={[styles.slot, { width: slotSize, height: slotSize }]}>
              {filled ? (
                <HoloStamp size={slotSize} index={i} entry={card.stamps[i] ?? null} fresh={freshIndex === i} />
              ) : (
                <EmptySlot size={slotSize} number={i + 1} reward={i === fields - 1} />
              )}
            </View>
          );
        })}
      </View>

      {compact ? (
        <View style={styles.compactFoot}>
          <Text style={styles.compactText}>
            <Text style={styles.compactStrong}>{card.filled}/{card.fields}</Text> Stempel · noch {card.remaining} bis {card.reward_credits} Credits
          </Text>
          <Icon name="chevron-right" size={16} color="rgba(255,255,255,0.8)" />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.panel,
    borderWidth: Stroke,
    borderColor: 'rgba(255,255,255,0.18)',
    overflow: 'hidden',
    padding: Spacing.three,
    gap: Spacing.three,
  },
  cardCompact: { padding: Spacing.three, gap: Spacing.two },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  title: { color: '#ffffff', fontFamily: FontFamily.bold, fontSize: 20 },
  subtitle: { color: Night.textMuted, fontFamily: FontFamily.medium, fontSize: 14, marginTop: 2 },
  cardsDone: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  cardsDoneText: { color: '#fff1a8', fontFamily: FontFamily.bold, fontSize: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: Spacing.three },
  gridCompact: { flexWrap: 'nowrap', rowGap: 0 },
  slot: { alignItems: 'center', justifyContent: 'center' },
  holoClip: { overflow: 'hidden', position: 'absolute' },
  center: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  initials: {
    color: '#ffffff',
    fontFamily: FontFamily.bold,
    textShadowColor: 'rgba(28,8,51,0.55)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  empty: {
    borderWidth: 1.6,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  emptyReward: { borderColor: 'rgba(255,241,168,0.7)', backgroundColor: 'rgba(255,241,168,0.08)' },
  number: { color: 'rgba(255,255,255,0.45)', fontFamily: FontFamily.bold },
  dot: { position: 'absolute', width: 6, height: 6, borderRadius: 3, opacity: 0.8 },
  dotSmall: { width: 4, height: 4, borderRadius: 2 },
  compactFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  compactText: { color: Night.textMuted, fontFamily: FontFamily.medium, fontSize: 13, flexShrink: 1 },
  compactStrong: { color: '#ffffff', fontFamily: FontFamily.bold },
});
