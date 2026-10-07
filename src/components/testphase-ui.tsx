/**
 * Bausteine der Testphase (Admin › Test): Check-in-Serie und Challenges.
 * Das Stadt-Bingo ist seit Okt. 2026 raus aus der Testphase und liegt in
 * src/components/bingo-card.tsx (per Admin-Schalter freigeschaltet).
 *
 * Gerechnet wird ausschließlich auf dem Server (api/app/Support/TestPhase).
 * Hier wird nur gezeichnet – ob etwas abholbar ist, sagt `claim.claimable`,
 * nie eine eigene Rechnung.
 *
 * ## Wie es aussehen soll
 *
 *  - **Serie** wie bei Lern-Apps: eine Flamme mit der Wochenzahl, die letzten
 *    Wochen als Leiste, darunter ein Pfad mit Geschenken an den Meilensteinen.
 *  - **Challenges** mit Fortschrittsring, Farbe je Art und „noch X Tage".
 */
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { PressableScale } from '@/components/ui/pressable-scale';
import { FontFamily, Radius, Spacing, Stroke } from '@/constants/theme';
import { formatCredits } from '@/domain/club';
import { formatDay } from '@/domain/date-format';
import { progressRatio, progressText, type ChallengeType, type TestphaseChallenge, type TestphaseClaim, type TestphaseState } from '@/domain/testphase';
import type { UiIconName } from '@/domain/ui-icon';
import { useSignals, useTheme } from '@/hooks/use-theme';

/* ============================================================== Abholen */

/** Abholen-Knopf, „abgeholt" oder nur der Betrag – je nach Stand vom Server. */
export function ClaimButton({ claim, busy, onClaim, title }: { claim: TestphaseClaim; busy: string | null; onClaim: (c: TestphaseClaim) => void; title?: string }) {
  const colors = useTheme();
  if (claim.claimed) {
    return (
      <View style={styles.claimed}>
        <Icon name="check" size={14} color="#059669" />
        <Text style={styles.claimedText}>{formatCredits(claim.reward)} abgeholt</Text>
      </View>
    );
  }
  if (!claim.claimable) {
    return (
      <View style={[styles.rewardPill, { backgroundColor: colors.backgroundSelected }]}>
        <Icon name="coin" size={13} color="#b27b00" />
        <Text style={[styles.rewardText, { color: colors.text }]}>+{formatCredits(claim.reward)}</Text>
      </View>
    );
  }
  return <Button title={title ?? `+${formatCredits(claim.reward)} abholen`} icon="coin" size="small" onPress={() => onClaim(claim)} loading={busy === claim.key} />;
}

/* =============================================================== Serie */

/** Kalenderwoche nach ISO 8601. */
function isoWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

/** Flamme, die leise flackert, solange die Serie lebt. */
function Flame({ alive, warn }: { alive: boolean; warn: boolean }) {
  const reduced = useReducedMotion();
  const flick = useSharedValue(0);
  useEffect(() => {
    if (reduced || !alive) return;
    flick.set(
      withRepeat(
        withSequence(withTiming(1, { duration: 420, easing: Easing.inOut(Easing.quad) }), withTiming(-0.6, { duration: 380, easing: Easing.inOut(Easing.quad) })),
        -1,
        true,
      ),
    );
    return () => cancelAnimation(flick);
  }, [reduced, alive, flick]);
  const style = useAnimatedStyle(() => ({ transform: [{ scaleY: 1 + flick.value * 0.06 }, { rotate: `${flick.value * 4}deg` }] }));

  return (
    <View style={styles.flameRing}>
      <LinearGradient
        colors={alive ? (warn ? ['#fbbf24', '#f59e0b'] : ['#fb923c', '#fe2c55']) : ['#d4d4d8', '#a1a1aa']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <Animated.View style={[{ transformOrigin: ['50%', '90%', 0] }, style]}>
        <Icon name="flame" size={40} color="#ffffff" />
      </Animated.View>
    </View>
  );
}

export function StreakCard({ state, busy, onClaim }: { state: TestphaseState; busy: string | null; onClaim: (c: TestphaseClaim) => void }) {
  const colors = useTheme();
  const signals = useSignals();
  const { streak } = state;
  const alive = streak.weeks > 0;
  const status =
    streak.weeks === 0
      ? 'Noch keine Serie – ein Check-in diese Woche startet sie.'
      : streak.active_this_week
        ? 'Diese Woche schon eingecheckt – weiter so!'
        : 'Diese Woche fehlt noch ein Check-in, sonst reißt die Serie.';

  // Die letzten 6 Wochen und diese: gefüllt, soweit die Serie zurückreicht.
  const now = new Date();
  const past = streak.active_this_week ? streak.weeks - 1 : streak.weeks;
  const weeks = Array.from({ length: 7 }, (_, i) => {
    const back = 6 - i; // 0 = diese Woche
    const date = new Date(now.getTime() - back * 7 * 86_400_000);
    const filled = back === 0 ? streak.active_this_week : back <= past;
    return { back, label: `KW ${isoWeek(date)}`, filled };
  });

  // Meilensteine stehen gleichmäßig verteilt (genau über ihren Beschriftungen);
  // der Balken füllt sich abschnittsweise bis zur aktuellen Wochenzahl.
  const marks = streak.milestones.map((m, i) => ({ ...m, at: (i + 0.5) / streak.milestones.length }));
  let fill = 0;
  for (let i = 0; i < marks.length; i++) {
    const fromWeeks = i === 0 ? 0 : marks[i - 1].weeks;
    const fromAt = i === 0 ? 0 : marks[i - 1].at;
    if (streak.weeks >= marks[i].weeks) {
      fill = marks[i].at;
      continue;
    }
    fill = fromAt + ((streak.weeks - fromWeeks) / (marks[i].weeks - fromWeeks)) * (marks[i].at - fromAt);
    break;
  }
  if (marks.length > 0 && streak.weeks >= marks[marks.length - 1].weeks) fill = 1;

  return (
    <View style={[styles.streak, { backgroundColor: colors.background, borderColor: colors.border }]}>
      <View style={styles.streakHead}>
        <Flame alive={alive} warn={streak.at_risk} />
        <View style={{ flex: 1 }}>
          <View style={styles.streakNumberRow}>
            <Text style={[styles.streakNumber, { color: colors.text }]}>{streak.weeks}</Text>
            <Text style={[styles.streakUnit, { color: colors.text }]}>{streak.weeks === 1 ? 'Woche' : 'Wochen'} in Folge</Text>
          </View>
          <Text style={[styles.streakStatus, { color: streak.at_risk ? signals.warn : colors.textSecondary }]}>{status}</Text>
        </View>
      </View>

      <View style={styles.weekRow}>
        {weeks.map((w) => {
          const current = w.back === 0;
          return (
            <View key={w.back} style={styles.weekCol}>
              <View
                style={[
                  styles.weekBubble,
                  w.filled
                    ? { backgroundColor: '#fb923c', borderColor: '#fb923c' }
                    : { backgroundColor: colors.backgroundElement, borderColor: current && streak.at_risk ? signals.warn : colors.border, borderStyle: current ? 'dashed' : 'solid' },
                ]}>
                {w.filled ? <Icon name="flame" size={15} color="#ffffff" /> : current ? <Text style={[styles.weekQ, { color: colors.textSecondary }]}>?</Text> : null}
              </View>
              <Text style={[styles.weekLabel, { color: current ? colors.text : colors.textSecondary }, current && styles.weekLabelNow]}>{current ? 'Jetzt' : w.label}</Text>
            </View>
          );
        })}
      </View>

      {/* Pfad zu den Meilensteinen. */}
      <View style={styles.path}>
        <View style={[styles.pathTrack, { backgroundColor: colors.backgroundSelected }]}>
          <LinearGradient colors={['#fb923c', '#fe2c55']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.pathFill, { width: `${Math.max(fill * 100, alive ? 4 : 0)}%` }]} />
        </View>
        {marks.map((m) => {
          const reached = streak.weeks >= m.weeks;
          return (
            <View key={m.weeks} style={[styles.milestone, { left: `${m.at * 100}%` }]}>
              <View
                style={[
                  styles.milestoneNode,
                  { borderColor: colors.background },
                  m.claim.claimed ? styles.nodeClaimed : m.claim.claimable ? styles.nodeReady : reached ? styles.nodeReached : { backgroundColor: colors.backgroundSelected },
                ]}>
                <Icon name={m.claim.claimed ? 'check' : 'gift'} size={15} color={m.claim.claimed || m.claim.claimable || reached ? '#ffffff' : colors.textSecondary} />
              </View>
            </View>
          );
        })}
      </View>
      <View style={styles.milestoneLabels}>
        {streak.milestones.map((m) => (
          <View key={m.weeks} style={styles.milestoneLabel}>
            <Text style={[styles.milestoneWeeks, { color: colors.text }]}>{m.weeks} Wochen</Text>
            <ClaimButton claim={m.claim} busy={busy} onClaim={onClaim} title={`+${formatCredits(m.reward)}`} />
          </View>
        ))}
      </View>

      {streak.joker ? (
        <View style={[styles.joker, { backgroundColor: colors.backgroundSelected }]}>
          <Icon name="shield" size={15} color={colors.tint} />
          <Text style={[styles.jokerHint, { color: colors.text }]}>
            Platinum-Joker: Eine Woche ohne Check-in darf fehlen{streak.joker_used ? ' – schon eingesetzt.' : '.'}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/* ========================================================== Challenges */

export const TYPE_LOOK: Record<ChallengeType, { icon: UiIconName; color: string; short: string }> = {
  monthly: { icon: 'calendar', color: '#6366f1', short: 'Monat' },
  weekly: { icon: 'clock', color: '#0ea5e9', short: 'Woche' },
  season: { icon: 'sparkles', color: '#f97316', short: 'Saison' },
  group: { icon: 'users', color: '#16a34a', short: 'Gruppe' },
  partner: { icon: 'building', color: '#dd2a7b', short: 'Partner' },
};

/** Lesbare Namen der Stufen für „nur Gold/Platinum". */
const PLAN_NAME: Record<string, string> = { free: 'Free', gold: 'Gold', platinum: 'Platinum' };

/** Fortschrittsring mit „x/y" in der Mitte. */
function ProgressRing({ ratio, label, color, track, size = 58 }: { ratio: number; label: string; color: string; track: string; size?: number }) {
  const stroke = 6;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={stroke} fill="none" />
        {ratio > 0 ? (
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${ratio * c} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        ) : null}
      </Svg>
      <Text style={[styles.ringText, { color }]}>{label}</Text>
    </View>
  );
}

function daysLeft(iso: string | null): number | null {
  if (!iso) return null;
  const end = new Date(iso).getTime();
  if (Number.isNaN(end)) return null;
  return Math.max(0, Math.ceil((end - Date.now()) / 86_400_000));
}

export function ChallengeCard({
  challenge: c,
  busy,
  onClaim,
  onDelete,
}: {
  challenge: TestphaseChallenge;
  busy: string | null;
  onClaim: (claim: TestphaseClaim) => void;
  onDelete: () => void;
}) {
  const colors = useTheme();
  const look = TYPE_LOOK[c.type];
  const ratio = progressRatio(c);
  const left = daysLeft(c.ends_at);
  const scope = [c.partner?.name, c.interest?.name, c.match_text ? `„${c.match_text}“` : null, c.offer_kind === 'perk' ? 'Gratis-Angebote' : null].filter(
    (x): x is string => !!x,
  );
  const when =
    c.status === 'upcoming'
      ? `startet am ${formatDay(c.starts_at)}`
      : c.status === 'ended'
        ? `vorbei seit ${formatDay(c.ends_at)}`
        : left !== null
          ? left === 0
            ? 'endet heute'
            : `noch ${left} ${left === 1 ? 'Tag' : 'Tage'}`
          : c.period_label;
  const ready = c.allowed && c.claim.claimable;
  // Geheime Challenge: Fortschritt erst zeigen, wenn sie sich offenbart hat.
  const hidden = c.is_secret === true && c.revealed === false;
  // Wahl-Challenge, die (noch) nicht gewählt ist: zählt nicht.
  const unchosen = c.is_choice === true && !c.chosen;

  return (
    <View
      style={[
        styles.challenge,
        { backgroundColor: colors.background, borderColor: ready ? '#f5c542' : colors.border },
        ready && styles.challengeReady,
        !c.allowed && styles.challengeLocked,
      ]}>
      <View style={[styles.challengeStripe, { backgroundColor: look.color }]} />
      <View style={styles.challengeTop}>
        <ProgressRing
          ratio={hidden ? 0 : ratio}
          label={hidden ? '?' : `${Math.min(c.progress, c.target)}/${c.target}`}
          color={c.claim.claimed ? '#059669' : look.color}
          track={colors.backgroundSelected}
        />
        <View style={{ flex: 1, gap: 3 }}>
          <View style={styles.challengeTags}>
            <View style={[styles.typeChip, { backgroundColor: `${look.color}1f` }]}>
              <Icon name={look.icon} size={11} color={look.color} />
              <Text style={[styles.typeChipText, { color: look.color }]}>{look.short}</Text>
            </View>
            <Text style={[styles.when, { color: c.status === 'running' && left !== null && left <= 3 ? '#e11d48' : colors.textSecondary }]}>{when}</Text>
          </View>
          <Text style={[styles.challengeTitle, { color: colors.text }]} numberOfLines={2}>
            {c.title}
          </Text>
          <Text style={[styles.challengeMeta, { color: colors.textSecondary }]} numberOfLines={2}>
            {hidden ? 'Geheim – zeigt sich, wenn du sie geschafft hast' : progressText(c)}
            {!hidden && scope.length ? ` · ${scope.join(' · ')}` : ''}
          </Text>
          {unchosen ? (
            <Text style={[styles.challengeMeta, { color: colors.tint }]}>Mit Wahl – zählt erst, wenn du sie unter „Challenges mit Wahl“ auswählst</Text>
          ) : null}
        </View>
      </View>
      {c.description ? <Text style={[styles.challengeDesc, { color: colors.textSecondary }]}>{c.description}</Text> : null}
      <View style={styles.challengeFoot}>
        {c.plans ? (
          <View style={[styles.planChip, { borderColor: colors.borderStrong }]}>
            <Icon name={c.allowed ? 'crown' : 'lock'} size={12} color={colors.textSecondary} />
            <Text style={[styles.planChipText, { color: colors.textSecondary }]}>{c.plans.map((p) => PLAN_NAME[p] ?? p).join(' & ')}</Text>
          </View>
        ) : null}
        <View style={{ flex: 1 }} />
        {c.allowed ? (
          <ClaimButton claim={c.claim} busy={busy} onClaim={onClaim} />
        ) : (
          <Text style={[styles.challengeMeta, { color: colors.textSecondary }]}>Nicht in deiner Stufe</Text>
        )}
        <PressableScale onPress={onDelete} haptic="tap" hitSlop={8} accessibilityRole="button" accessibilityLabel={`Challenge „${c.title}“ löschen`} style={[styles.trash, { borderColor: colors.border }]}>
          <Icon name="trash" size={15} color={colors.textSecondary} />
        </PressableScale>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  claimed: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  claimedText: { color: '#059669', fontFamily: FontFamily.bold, fontSize: 12.5 },
  rewardPill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  rewardText: { fontFamily: FontFamily.bold, fontSize: 12.5 },

  streak: { borderWidth: Stroke, borderRadius: Radius.panel, padding: Spacing.three, gap: Spacing.three },
  streakHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  flameRing: { width: 68, height: 68, borderRadius: 34, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  streakNumberRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  streakNumber: { fontFamily: FontFamily.bold, fontSize: 38, lineHeight: 42 },
  streakUnit: { fontFamily: FontFamily.bold, fontSize: 15 },
  streakStatus: { fontFamily: FontFamily.medium, fontSize: 13, lineHeight: 18 },
  weekRow: { flexDirection: 'row', justifyContent: 'space-between' },
  weekCol: { alignItems: 'center', gap: 4 },
  weekBubble: { width: 34, height: 34, borderRadius: 17, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  weekQ: { fontFamily: FontFamily.bold, fontSize: 15 },
  weekLabel: { fontFamily: FontFamily.medium, fontSize: 10 },
  weekLabelNow: { fontFamily: FontFamily.bold },
  path: { height: 34, justifyContent: 'center' },
  pathTrack: { height: 8, borderRadius: 4, overflow: 'hidden' },
  pathFill: { height: '100%', borderRadius: 4 },
  milestone: { position: 'absolute', top: 0, marginLeft: -17 },
  milestoneNode: { width: 34, height: 34, borderRadius: 17, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  nodeReached: { backgroundColor: '#fb923c' },
  nodeReady: { backgroundColor: '#f5c542' },
  nodeClaimed: { backgroundColor: '#059669' },
  milestoneLabels: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.two },
  milestoneLabel: { flex: 1, alignItems: 'center', gap: 4 },
  milestoneWeeks: { fontFamily: FontFamily.bold, fontSize: 12.5 },
  joker: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderRadius: Radius.field, padding: Spacing.two + 2 },
  jokerHint: { flex: 1, fontFamily: FontFamily.medium, fontSize: 13 },

  challenge: { borderWidth: Stroke, borderRadius: Radius.card, padding: Spacing.three, paddingLeft: Spacing.three + 4, gap: Spacing.two, overflow: 'hidden' },
  challengeReady: { borderWidth: 2 },
  challengeLocked: { opacity: 0.72 },
  challengeStripe: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 5 },
  challengeTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  challengeTags: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flexWrap: 'wrap' },
  typeChip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  typeChipText: { fontFamily: FontFamily.bold, fontSize: 11 },
  when: { fontFamily: FontFamily.semibold, fontSize: 11.5 },
  challengeTitle: { fontFamily: FontFamily.bold, fontSize: 16 },
  challengeMeta: { fontFamily: FontFamily.medium, fontSize: 12.5 },
  challengeDesc: { fontFamily: FontFamily.medium, fontSize: 13, lineHeight: 18 },
  challengeFoot: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  planChip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  planChipText: { fontFamily: FontFamily.semibold, fontSize: 11.5 },
  trash: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  ringText: { fontFamily: FontFamily.bold, fontSize: 12.5 },
});
