/**
 * Die Prämien-Karte auf der Startseite – der Platz, an dem vorher die Serie stand.
 *
 * ## Warum sie die Serie ersetzt
 *
 * Die Serie hat gefragt: „Warst du heute da?" Das ist eine Frage an die
 * Anwesenheit. Die Prämien fragen: „Was hast du gemacht?" – und beantworten sie mit
 * etwas, das man tatsächlich bekommt. Punkte gibt es nur für erstellte
 * Aktivitäten, also für genau die Handlung, um die es in dieser App geht.
 *
 * ## Was die Karte zeigt (und was nicht)
 *
 * Drei Dinge: den Stand, das nächste erreichbare Ziel und wie weit es noch ist.
 * Bewusst NICHT den ganzen Katalog – der steht auf `/rewards`. Eine Karte, die
 * sechs Coupons auflistet, ist eine Liste und keine Karte, und die Startseite hat
 * schon vier Regale.
 *
 * Das Ziel ist immer der günstigste Coupon, den man sich NOCH NICHT leisten kann
 * (`nextGoal` in `src/domain/rewards.ts`). Sonst zeigte die Karte ewig auf den
 * Kaffee, obwohl man den längst dreimal einlösen könnte.
 */
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { CountUp } from '@/components/ui/count-up';
import { GlassCard, GlassProgressBar } from '@/components/ui/glass';
import { Glow } from '@/components/ui/glow';
import { Icon } from '@/components/ui/icon';
import { Radius, Spacing } from '@/constants/theme';
import {
  COUPONS,
  POINTS_PER_ACTIVITY,
  activitiesUntil,
  canAfford,
  couponProgress,
  missingFor,
  nextGoal,
  type Coupon,
} from '@/domain/rewards';
import { useBrandSurface, useSignals } from '@/hooks/use-theme';
import * as feedback from '@/lib/feedback';

export type RewardsCardProps = {
  /** Verfügbares Guthaben. */
  balance: number;
  /** Wie viele Coupons schon eingelöst sind – nur als Fußnote. */
  redeemedCount: number;
  /**
   * Der Katalog, gegen den gerechnet wird. Ohne Angabe der eingebaute – so zeigt
   * die Karte auch dann etwas Sinnvolles, wenn der Abruf noch läuft.
   */
  catalog?: readonly Coupon[];
  onPress?: () => void;
};

export function RewardsCard({ balance, redeemedCount, catalog, onPress }: RewardsCardProps) {
  const surface = useBrandSurface();
  const signal = useSignals();

  // Einmal auflösen und überall denselben Katalog benutzen: Sonst rechnete
  // `nextGoal` mit dem eingebauten und das Leuchten mit einem leeren.
  const list = catalog ?? COUPONS;
  const goal = nextGoal(balance, list);
  const missing = goal ? missingFor(goal, balance) : 0;
  const events = goal ? activitiesUntil(goal, balance) : 0;

  /**
   * Geleuchtet wird, wenn etwas zu HOLEN ist – also sobald mindestens ein Coupon
   * bezahlbar ist. Das ist der einzige Zustand dieser Karte, der eine Handlung
   * nahelegt; alles andere ist eine Standsanzeige und darf ruhig bleiben.
   */
  const redeemable = list.some((coupon) => canAfford(coupon, balance));

  return (
    <Glow
      active={redeemable}
      color={signal.goodGlow}
      radius={Radius.panel}
      intensity="soft"
      durationMs={2800}>
      <Pressable
        onPress={
          onPress
            ? () => {
                feedback.tapped();
                onPress();
              }
            : undefined
        }
        accessibilityRole={onPress ? 'button' : undefined}
        accessibilityLabel={
          goal
            ? `${balance} Punkte. Noch ${missing} Punkte bis „${goal.title}". Prämien öffnen.`
            : `${balance} Punkte. Alle Prämien erreichbar. Prämien öffnen.`
        }
        style={({ pressed }) => pressed && styles.pressed}>
        <GlassCard tone="accent" radius={Radius.panel} style={styles.card}>
          <View style={styles.head}>
            <Icon name="ticket" size={24} color={surface.accent} />
            <View style={styles.headText}>
              <View style={styles.titleRow}>
                <CountUp value={balance} style={[styles.count, { color: surface.accent }]} />
                <ThemedText style={[styles.unit, { color: surface.accent }]}>
                  {balance === 1 ? 'Punkt' : 'Punkte'}
                </ThemedText>
              </View>
              <ThemedText type="small" style={{ color: surface.textMuted }}>
                {`${POINTS_PER_ACTIVITY} Punkte für jede Aktivität, die du erstellst.`}
              </ThemedText>
            </View>
            <Icon name="chevron-right" size={18} color={surface.textMuted} />
          </View>

          {goal ? (
            <View style={styles.goal}>
              <GlassProgressBar progress={couponProgress(goal, balance)} />
              <ThemedText type="small" style={{ color: surface.textMuted }}>
                {`Noch ${missing} ${missing === 1 ? 'Punkt' : 'Punkte'} bis „${goal.title}" – das sind ${
                  events === 1 ? 'eine Aktivität' : `${events} Aktivitäten`
                }.`}
              </ThemedText>
            </View>
          ) : (
            <View style={styles.goal}>
              <GlassProgressBar progress={1} />
              <ThemedText type="small" style={{ color: signal.good }}>
                Du kannst jede Prämie einlösen – schau rein, was dabei ist.
              </ThemedText>
            </View>
          )}

          {redeemedCount > 0 ? (
            <View style={[styles.footer, { borderTopColor: surface.chipBorder }]}>
              <Icon name="check" size={15} color={signal.good} />
              <ThemedText type="small" style={{ color: signal.good }}>
                {redeemedCount === 1
                  ? '1 Prämie eingelöst – dein Code liegt bereit.'
                  : `${redeemedCount} Prämien eingelöst – deine Codes liegen bereit.`}
              </ThemedText>
            </View>
          ) : null}
        </GlassCard>
      </Pressable>
    </Glow>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  card: { gap: Spacing.three, padding: Spacing.three },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  headText: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.one },
  count: { fontSize: 24, lineHeight: 28, fontWeight: '800', letterSpacing: -0.5 },
  unit: { fontSize: 15, lineHeight: 20, fontWeight: '700' },
  goal: { gap: Spacing.two },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth * 2,
    paddingTop: Spacing.two,
  },
});
