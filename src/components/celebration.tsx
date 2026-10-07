/**
 * Feiern: ein Münz- oder Konfetti-Regen und ein kurzer Erfolgs-Moment mit Goenni.
 *
 * Zwei Bausteine:
 *  - **`Burst`** – nur die Teilchen, an Ort und Stelle (z. B. im Credits-Blatt,
 *    das selbst ein Modal ist und deshalb nichts darüberlegen kann).
 *  - **`CelebrationProvider` / `useCelebrate()`** – die große Fassung über der
 *    ganzen App: abgedunkelter Hintergrund, Goenni mit Salto, Titel, hochlaufende
 *    Zahl. Nach Buchung, Abo, Gutschein, voller Stempelkarte.
 *
 * Die Teilchen sind gewöhnliche Views (keine SVG) und fliegen auf dem UI-Thread –
 * zwei Dutzend davon kosten nichts. Ihre Bahnen sind fest berechnet statt
 * zufällig: Jede Feier sieht gleich gut aus, und ein Test wäre möglich.
 * Bei „Bewegung reduzieren" bleibt der Moment, aber ohne Regen.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { Mascot } from '@/components/mascot';
import { CountUp } from '@/components/ui/count-up';
import { Icon } from '@/components/ui/icon';
import { FontFamily, Night, Radius, Spacing } from '@/constants/theme';
import { formatCredits } from '@/domain/club';
import * as feedback from '@/lib/feedback';

export type BurstKind = 'coins' | 'confetti';

const CONFETTI = ['#fe2c55', '#25f4ee', '#ffd24a', '#a855f7', '#ffffff'];

/** Feste Bahnen: Goldener Winkel verteilt die Teilchen gleichmäßig rundum. */
const PARTICLES = Array.from({ length: 24 }, (_, i) => {
  const angle = ((i * 137.508) % 360) * (Math.PI / 180);
  const reach = 0.55 + ((i * 53) % 45) / 100;
  return {
    dx: Math.cos(angle) * reach,
    dy: Math.sin(angle) * reach - 0.3,
    spin: (i % 2 ? 1 : -1) * (200 + ((i * 47) % 260)),
    scale: 0.75 + ((i * 29) % 45) / 100,
    color: CONFETTI[i % CONFETTI.length],
    wide: i % 3 === 0,
  };
});

type Particle = (typeof PARTICLES)[number];

function Bit({ p, progress, radius, kind }: { p: Particle; progress: SharedValue<number>; radius: number; kind: BurstKind }) {
  const style = useAnimatedStyle(() => {
    const t = progress.value;
    return {
      opacity: t <= 0 ? 0 : interpolate(t, [0, 0.06, 0.65, 1], [0, 1, 1, 0], Extrapolation.CLAMP),
      transform: [
        { translateX: p.dx * radius * t },
        // Erst nach außen, dann fällt es: Schwerkraft wächst mit t².
        { translateY: p.dy * radius * t + t * t * radius * 0.5 },
        { rotate: `${p.spin * t}deg` },
        { scale: interpolate(t, [0, 0.15, 1], [0.3, 1, 0.8], Extrapolation.CLAMP) * p.scale },
      ],
    };
  });

  if (kind === 'coins') {
    return (
      <Animated.View style={[styles.coin, style]}>
        <View style={styles.coinInner} />
      </Animated.View>
    );
  }
  return <Animated.View style={[p.wide ? styles.confettiWide : styles.confetti, { backgroundColor: p.color }, style]} />;
}

/** Teilchen an Ort und Stelle. Jede neue `burstKey` schießt einen Regen ab. */
export function Burst({ burstKey, kind = 'coins', radius = 150 }: { burstKey: number; kind?: BurstKind; radius?: number }) {
  const reduced = useReducedMotion();
  const progress = useSharedValue(0);

  useEffect(() => {
    if (!burstKey || reduced) return;
    progress.set(0);
    progress.set(withTiming(1, { duration: 1300, easing: Easing.out(Easing.cubic) }));
  }, [burstKey, reduced, progress]);

  return (
    <View pointerEvents="none" style={styles.burstOrigin}>
      {PARTICLES.map((p, i) => (
        <Bit key={i} p={p} progress={progress} radius={radius} kind={kind} />
      ))}
    </View>
  );
}

export type Celebration = {
  title: string;
  subtitle?: string;
  /** Hochlaufende Zahl mit Münze, z. B. die gekauften Credits. */
  credits?: number;
  kind?: BurstKind;
};

type CelebrateFn = (celebration: Celebration) => void;

const CelebrationContext = createContext<CelebrateFn>(() => {});

/** `celebrate({ title, credits })` – von überall, nach einem Erfolg. */
export function useCelebrate(): CelebrateFn {
  return useContext(CelebrationContext);
}

/** So lange steht der Moment, wenn man nicht vorher tippt. */
const SHOW_MS = 2800;

export function CelebrationProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<(Celebration & { key: number }) | null>(null);
  const counter = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const close = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setCurrent(null);
  }, []);

  const celebrate = useCallback<CelebrateFn>(
    (celebration) => {
      counter.current += 1;
      feedback.achieved();
      setCurrent({ ...celebration, key: counter.current });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(close, SHOW_MS);
    },
    [close],
  );

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const value = useMemo(() => celebrate, [celebrate]);

  return (
    <CelebrationContext.Provider value={value}>
      {children}
      {current ? <CelebrationOverlay key={current.key} celebration={current} onClose={close} /> : null}
    </CelebrationContext.Provider>
  );
}

function CelebrationOverlay({ celebration, onClose }: { celebration: Celebration & { key: number }; onClose: () => void }) {
  const reduced = useReducedMotion();
  const appear = useSharedValue(0);

  useEffect(() => {
    appear.set(reduced ? 1 : withSpring(1, { damping: 13, stiffness: 180 }));
  }, [reduced, appear]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: Math.min(1, appear.value) }));
  const cardStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, appear.value * 1.4),
    transform: [{ scale: interpolate(appear.value, [0, 1], [0.7, 1]) }],
  }));

  return (
    <View style={StyleSheet.absoluteFill} accessibilityViewIsModal accessibilityLiveRegion="assertive">
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Schließen" />
      </Animated.View>
      <View pointerEvents="box-none" style={styles.center}>
        <Burst burstKey={celebration.key} kind={celebration.kind ?? 'confetti'} radius={190} />
        <Animated.View style={[styles.card, cardStyle]}>
          <Mascot mood="cheer" size={112} trick="flip" trickKey={celebration.key} waves />
          <Text style={styles.title} accessibilityRole="header">
            {celebration.title}
          </Text>
          {typeof celebration.credits === 'number' ? (
            <View style={styles.amount}>
              <Icon name="coin" size={26} color="#ffd24a" />
              <CountUp value={celebration.credits} animateOnMount durationMs={900} format={(v) => `+${formatCredits(v)}`} style={styles.amountText} />
            </View>
          ) : null}
          {celebration.subtitle ? <Text style={styles.subtitle}>{celebration.subtitle}</Text> : null}
          <Text style={styles.hint}>Antippen zum Schließen</Text>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  burstOrigin: { position: 'absolute', left: '50%', top: '50%', width: 0, height: 0, alignItems: 'center', justifyContent: 'center' },
  coin: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#ffd24a',
    borderWidth: 2,
    borderColor: '#e3a60b',
    alignItems: 'center',
    justifyContent: 'center',
  },
  coinInner: { width: 8, height: 8, borderRadius: 4, borderWidth: 1.5, borderColor: '#e3a60b' },
  confetti: { position: 'absolute', width: 8, height: 8, borderRadius: 2 },
  confettiWide: { position: 'absolute', width: 12, height: 5, borderRadius: 2 },
  backdrop: { backgroundColor: 'rgba(12,4,24,0.62)' },
  center: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', padding: Spacing.four },
  card: {
    width: '100%',
    maxWidth: 340,
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.four,
    paddingHorizontal: Spacing.four,
    borderRadius: Radius.panel + 6,
    backgroundColor: Night.deep,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  title: { color: '#ffffff', fontFamily: FontFamily.bold, fontSize: 24, textAlign: 'center' },
  amount: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  amountText: { color: '#ffd24a', fontFamily: FontFamily.bold, fontSize: 36, lineHeight: 42 },
  subtitle: { color: Night.textMuted, fontFamily: FontFamily.medium, fontSize: 15, lineHeight: 21, textAlign: 'center' },
  hint: { color: 'rgba(255,255,255,0.45)', fontFamily: FontFamily.medium, fontSize: 12, marginTop: Spacing.one },
});
