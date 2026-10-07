/**
 * Bausteine für Gruppen: Gruppen-Abzeichen in eigener Farbe und der
 * Rabatt-Balken („−10 % – noch 2 Personen bis −12,5 %").
 *
 * Jede Gruppe bekommt einen eigenen Verlauf (aus dem Namen abgeleitet, also
 * immer derselbe): In einer Liste mit „Familie", „Uni-Clique" und
 * „Donnerstagsrunde" findet man seine Gruppe so am Bild, nicht nur am Text.
 */
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

import { Icon } from '@/components/ui/icon';
import { FontFamily, Radius } from '@/constants/theme';
import { formatPercent } from '@/domain/club';
import { discountStep } from '@/domain/group-discount';
import { initialsOf } from '@/domain/initials';
import { CLUB_RULES } from '@/lib/club-rules';

const GRADIENTS = [
  ['#fe2c55', '#8134af'],
  ['#8134af', '#3b82f6'],
  ['#f97316', '#fe2c55'],
  ['#0ea5e9', '#10b981'],
  ['#dd2a7b', '#f59e0b'],
  ['#6366f1', '#ec4899'],
] as const;

/** Immer derselbe Verlauf für denselben Namen. */
export function groupGradient(name: string): readonly [string, string] {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return GRADIENTS[hash % GRADIENTS.length];
}

export function GroupBadge({ name, size = 52 }: { name: string; size?: number }) {
  return (
    <LinearGradient colors={[...groupGradient(name)]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.badge, { width: size, height: size, borderRadius: size * 0.3 }]}>
      <Text style={[styles.badgeText, { fontSize: size * 0.34 }]}>{initialsOf(name)}</Text>
    </LinearGradient>
  );
}

/**
 * Rabatt der Gruppe heute und der Weg zur nächsten Stufe. `tone="night"` für
 * die lila Kopf-Flächen.
 */
export function DiscountMeter({ people, plan, tone = 'plain', textColor, mutedColor, trackColor }: {
  people: number;
  plan: string | null | undefined;
  tone?: 'plain' | 'night';
  textColor: string;
  mutedColor: string;
  trackColor: string;
}) {
  const reduced = useReducedMotion();
  const step = discountStep(CLUB_RULES, plan, people);
  const fill = useSharedValue(reduced ? step.progress : 0);

  useEffect(() => {
    fill.set(reduced ? step.progress : withDelay(200, withTiming(step.progress, { duration: 700, easing: Easing.out(Easing.cubic) })));
  }, [reduced, step.progress, fill]);

  const fillStyle = useAnimatedStyle(() => ({ width: `${Math.max(6, fill.value * 100)}%` }));
  const missing = step.next ? step.next.people - Math.max(1, people) : 0;
  const night = tone === 'night';

  return (
    <View style={styles.meter} accessible accessibilityLabel={meterLabel(step.percent, missing, step.next?.percent ?? null)}>
      <View style={styles.meterHead}>
        <View style={styles.meterNow}>
          <Icon name="percent" size={14} color={night ? '#ffd24a' : '#059669'} />
          <Text style={[styles.meterPercent, { color: textColor }]}>
            {step.percent > 0 ? `−${formatPercent(step.percent)} zusammen` : 'Noch kein Gruppenrabatt'}
          </Text>
        </View>
        {step.next ? (
          <Text style={[styles.meterNext, { color: mutedColor }]}>
            noch {missing} {missing === 1 ? 'Person' : 'Personen'} bis −{formatPercent(step.next.percent)}
          </Text>
        ) : (
          <Text style={[styles.meterNext, { color: mutedColor }]}>Höchstrabatt</Text>
        )}
      </View>
      <View style={[styles.track, { backgroundColor: trackColor }]}>
        <Animated.View style={[styles.fillWrap, fillStyle]}>
          <LinearGradient colors={night ? ['#ffd24a', '#f59e0b'] : ['#34d399', '#059669']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
        </Animated.View>
      </View>
    </View>
  );
}

function meterLabel(percent: number, missing: number, next: number | null): string {
  const now = percent > 0 ? `Gruppenrabatt ${formatPercent(percent)}` : 'Noch kein Gruppenrabatt';
  return next !== null ? `${now}. Noch ${missing} bis ${formatPercent(next)}.` : `${now}. Höchstrabatt erreicht.`;
}

const styles = StyleSheet.create({
  badge: { alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#ffffff', fontFamily: FontFamily.bold },
  meter: { gap: 6 },
  meterHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
  meterNow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  meterPercent: { fontFamily: FontFamily.bold, fontSize: 13.5 },
  meterNext: { fontFamily: FontFamily.medium, fontSize: 12 },
  track: { height: 8, borderRadius: Radius.chip, overflow: 'hidden' },
  fillWrap: { height: '100%', borderRadius: Radius.chip, overflow: 'hidden' },
});
