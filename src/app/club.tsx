import { LinearGradient } from 'expo-linear-gradient';
import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Mascot } from '@/components/mascot';
import { PlanBadge } from '@/components/plan-badge';
import { PlanComparison, PlanFaq, PlanSectionTitle, TripExample } from '@/components/plan-overview';
import { Button } from '@/components/ui/button';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { PullToCloseScroll } from '@/components/ui/pull-to-close';
import { FontFamily, MaxContentWidth, Night, PlanLook, Radius, Spacing, Stroke } from '@/constants/theme';
import {
  creditValidityLabel,
  discountFor,
  formatEuro,
  formatPercent,
  groupPercentFor,
  periodPriceCents,
  stampRewardFor,
  yearlySavingsCents,
  type ClubInterval,
  type ClubPlan,
} from '@/domain/club';
import { formatDay } from '@/domain/date-format';
import { useTheme } from '@/hooks/use-theme';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { CLUB_RULES } from '@/lib/club-rules';
import { confirmAction, notifyUser } from '@/lib/confirm';
import * as feedback from '@/lib/feedback';
import { useMarket } from '@/lib/market-context';

/**
 * Der Club: Free Plan, Gold Plan, Platinum Plan.
 *
 * Jede Stufe als eigene Karte mit ihren Vorteilen: Gruppenrabatt von–bis und
 * ein Beispiel – „zu sechst sparst du X %" sagt mehr als eine Tabelle.
 *
 * Oben wählt man monatlich oder jährlich. Das Jahresabo kostet zehn
 * Monatspreise; die Monats-Credits kommen trotzdem jeden Monat. Nach dem ersten
 * Jahr läuft es monatlich weiter (monatlich kündbar). Während eines laufenden
 * Jahresabos gibt es keinen Stufenwechsel – das rechnet der Server genauso.
 *
 * Unter den Karten der Überblick (src/components/plan-overview.tsx): alle
 * Vorteile als Tabelle, ein Beispiel-Ausflug zum Durchklicken und die häufigen
 * Fragen. Die Karten selbst zeigen darum nur das Wichtigste je Stufe.
 */
export default function ClubScreen() {
  const colors = useTheme();
  const { token, user } = useAuth();
  const market = useMarket();
  const [busy, setBusy] = useState<string | null>(null);
  const [cheer, setCheer] = useState(0);

  // `refreshClub` bleibt stabil, solange man angemeldet ist: einmal beim Öffnen.
  const { refreshClub } = market;
  useEffect(() => {
    void refreshClub();
  }, [refreshClub]);

  const club = market.club;
  const current = user?.club_plan ?? 'free';
  const currentInterval: ClubInterval = club?.interval ?? user?.club_interval ?? 'month';
  const onYearly = current !== 'free' && currentInterval === 'year';
  const [interval, setIntervalChoice] = useState<ClubInterval>(onYearly ? 'year' : 'month');
  const testMode = (club?.payments_mode ?? 'test') === 'test';

  const subscribe = async (plan: ClubPlan) => {
    if (!token) return;
    const resume = current === plan.key && user?.club_cancel_at_period_end && currentInterval === interval;
    const price = formatEuro(periodPriceCents(CLUB_RULES, plan.key, interval));
    const terms =
      interval === 'year'
        ? `${price} für ein Jahr – zwei Monate gratis. Danach läuft es monatlich weiter und ist monatlich kündbar.${plan.monthlyCredits > 0 ? ` Die ${plan.monthlyCredits} Monats-Credits bekommst du jeden Monat, die ersten sofort.` : ''}`
        : `${price} im Monat, monatlich kündbar.${plan.monthlyCredits > 0 ? ` Du bekommst sofort ${plan.monthlyCredits} Credits.` : ''}`;
    const ok = await confirmAction(
      resume ? `${plan.name} weiterlaufen lassen?` : `${plan.name}${interval === 'year' ? ' (Jahresabo)' : ''} abschließen?`,
      resume ? 'Deine Kündigung wird zurückgenommen.' : `${terms}${testMode ? '\n\nTestmodus: Es wird kein echtes Geld abgebucht.' : ''}`,
      resume ? 'Weiterlaufen lassen' : 'Zahlungspflichtig abschließen',
    );
    if (!ok) return;
    setBusy(plan.key);
    try {
      const { data } = await api.subscribe(token, plan.key, interval);
      market.applyClub(data);
      setCheer((c) => c + 1);
      feedback.achieved();
    } catch (e) {
      feedback.failed();
      await notifyUser('Hat nicht geklappt', errorMessage(e));
    }
    setBusy(null);
  };

  const cancel = async () => {
    if (!token) return;
    const ok = await confirmAction(
      'Abo kündigen?',
      `Deine Vorteile bleiben bis ${formatDay(user?.club_renews_at ?? null)}. Danach bist du im Free Plan – Stempel und Credits behältst du.`,
      'Kündigen',
      true,
    );
    if (!ok) return;
    setBusy('cancel');
    try {
      const { data } = await api.cancelPlan(token);
      market.applyClub(data);
    } catch (e) {
      await notifyUser('Hat nicht geklappt', errorMessage(e));
    }
    setBusy(null);
  };

  return (
    <View style={[styles.flex, { backgroundColor: colors.backgroundElement }]}>
      <Stack.Screen options={{ headerShown: true, title: 'GÖ4Fun Club' }} />
      <PullToCloseScroll contentContainerStyle={styles.content}>
        <Card tone="night" style={styles.hero}>
          <Mascot mood={cheer > 0 ? 'cheer' : 'happy'} gesture="wave" size={76} jumpKey={cheer} waves={cheer > 0} />
          <View style={{ flex: 1, gap: 6 }}>
            <PlanBadge plan={current} tone="night" />
            <Text style={styles.heroTitle}>
              {current === 'free' ? 'Mehr sparen mit Gold & Platinum' : 'Danke, dass du dabei bist!'}
            </Text>
            <Text style={styles.heroText}>
              {user?.club_renews_at
                ? user.club_cancel_at_period_end
                  ? `Gekündigt – läuft bis ${formatDay(user.club_renews_at)}.`
                  : onYearly
                    ? `Jahresabo bis ${formatDay(user.club_renews_at)}, danach monatlich kündbar.`
                    : `Verlängert sich am ${formatDay(user.club_renews_at)}.`
                : 'Stempelkarte und Gruppenrabatt hast du in jeder Stufe.'}
            </Text>
          </View>
        </Card>

        <View style={[styles.segment, { borderColor: colors.border, backgroundColor: colors.background }]} accessibilityRole="radiogroup">
          {(['month', 'year'] as const).map((value) => {
            const on = interval === value;
            return (
              <PressableScale
                key={value}
                onPress={() => setIntervalChoice(value)}
                haptic="select"
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                style={[styles.segItem, on && { backgroundColor: colors.tint }]}>
                <Text style={[styles.segText, { color: on ? '#ffffff' : colors.text }]}>{value === 'month' ? 'Monatlich' : 'Jährlich'}</Text>
                {value === 'year' ? (
                  <Text style={[styles.segHint, { color: on ? '#ffffff' : colors.tint }]}>2 Monate gratis</Text>
                ) : null}
              </PressableScale>
            );
          })}
        </View>

        {CLUB_RULES.plans.map((plan) => {
          const look = PlanLook[plan.key];
          const active = current === plan.key;
          const groupFrom = groupPercentFor(CLUB_RULES, plan.key, CLUB_RULES.groupDiscount.tiers[0]?.minPeople ?? 2);
          const groupTo = groupPercentFor(CLUB_RULES, plan.key, Number.MAX_SAFE_INTEGER);
          const sixPercent = discountFor(CLUB_RULES, plan.key, 6).percent;
          const stampReward = stampRewardFor(CLUB_RULES, plan.key, 1);
          const goldenReward = stampRewardFor(CLUB_RULES, plan.key, CLUB_RULES.stampCard.goldenEvery);
          const savings = yearlySavingsCents(CLUB_RULES, plan.key);
          // Schon genau so abonniert (Stufe + Laufzeit) und nicht gekündigt?
          const isCurrent = active && !user?.club_cancel_at_period_end && currentInterval === interval;
          // Während eines laufenden Jahresabos: kein Wechsel (Stufe oder zurück auf monatlich).
          const locked = onYearly && !(active && user?.club_cancel_at_period_end && interval === 'year') && !isCurrent;
          const buttonTitle =
            active && user?.club_cancel_at_period_end && currentInterval === interval
              ? 'Weiterlaufen lassen'
              : active && currentInterval === 'month' && interval === 'year'
                ? 'Auf Jahresabo umstellen'
                : current === 'free'
                  ? `${plan.name} holen`
                  : `Zu ${plan.name} wechseln`;
          return (
            <View key={plan.key} style={[styles.plan, { borderColor: active ? look.ring : colors.border, backgroundColor: colors.background }, active && styles.planActive]}>
              <LinearGradient colors={[...look.gradient]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.planHead}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.planName, { color: look.ink }]}>{plan.name}</Text>
                  <Text style={[styles.planPrice, { color: look.ink }]}>
                    {plan.priceCents === 0
                      ? 'Kostenlos'
                      : interval === 'year'
                        ? `${formatEuro(periodPriceCents(CLUB_RULES, plan.key, 'year'))} / Jahr`
                        : `${formatEuro(plan.priceCents)} / Monat`}
                  </Text>
                  {plan.priceCents > 0 && interval === 'year' && savings > 0 ? (
                    <Text style={[styles.planSave, { color: look.ink }]}>Du sparst {formatEuro(savings)} gegenüber monatlich</Text>
                  ) : null}
                </View>
                {active ? (
                  <View style={[styles.current, { borderColor: look.ink }]}>
                    <Text style={[styles.currentText, { color: look.ink }]}>Deine Stufe</Text>
                  </View>
                ) : (
                  <Icon name={plan.key === 'free' ? 'sparkles' : 'crown'} size={28} color={look.ink} />
                )}
              </LinearGradient>
              <View style={styles.planBody}>
                {/* Das Wichtigste je Stufe – alles Weitere steht im Vergleich darunter. */}
                {plan.discountPercent > 0 ? <Perk text={`${formatPercent(plan.discountPercent)} Rabatt auf jedes Partner-Angebot`} /> : null}
                <Perk text={`Gruppenrabatt ${formatPercent(groupFrom).replace(' %', '')}–${formatPercent(groupTo)}, zu sechst ${formatPercent(sixPercent)} insgesamt`} />
                {plan.monthlyCredits > 0 ? <Perk text={`${plan.monthlyCredits} Credits jeden Monat geschenkt`} /> : null}
                <Perk text={`Volle Stempelkarte: ${stampReward} Credits, golden ${goldenReward}`} />
                <Perk text={`Credits gelten ${creditValidityLabel(CLUB_RULES, plan.key)}`} />
                {plan.key !== 'free' && !isCurrent && !locked ? (
                  <Button title={buttonTitle} icon="crown" onPress={() => subscribe(plan)} loading={busy === plan.key} style={styles.planButton} />
                ) : null}
                {plan.key !== 'free' && locked ? (
                  <Text style={[styles.lockedNote, { color: colors.textSecondary }]}>
                    Dein Jahresabo läuft bis {formatDay(user?.club_renews_at ?? null)} – ein Wechsel geht danach.
                  </Text>
                ) : null}
                {active && plan.key !== 'free' && !user?.club_cancel_at_period_end ? (
                  <Button title="Abo kündigen" variant="ghost" size="small" onPress={cancel} loading={busy === 'cancel'} />
                ) : null}
              </View>
            </View>
          );
        })}

        <PlanSectionTitle title="Alle Vorteile im Vergleich" subtitle="Was jede Stufe bringt – deine ist markiert." />
        <PlanComparison current={current} />

        <PlanSectionTitle title="Was kostet ein Ausflug?" subtitle="Personen und Preis wählen – so viel zahlt ihr in jeder Stufe." />
        <TripExample current={current} />

        <PlanSectionTitle title="Häufige Fragen" />
        <PlanFaq />

        <Card tone="soft">
          <Text style={[styles.note, { color: colors.textSecondary }]}>
            {testMode ? 'Testmodus: Abos werden ohne echte Zahlung abgeschlossen. ' : ''}
            Abos laufen einen Monat oder ein Jahr und verlängern sich automatisch – das Jahresabo danach monatlich. Kündigen geht jederzeit zum Ende der Laufzeit.
          </Text>
        </Card>
      </PullToCloseScroll>
    </View>
  );
}

function Perk({ text }: { text: string }) {
  const colors = useTheme();
  return (
    <View style={styles.perk}>
      <View style={[styles.perkDot, { backgroundColor: colors.tint }]}>
        <Icon name="check" size={11} color="#ffffff" />
      </View>
      <Text style={[styles.perkText, { color: colors.text }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.three, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', paddingBottom: Spacing.six },
  hero: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  heroTitle: { color: '#ffffff', fontFamily: FontFamily.bold, fontSize: 18 },
  heroText: { color: Night.textMuted, fontFamily: FontFamily.medium, fontSize: 13 },
  plan: { borderWidth: Stroke, borderRadius: Radius.panel, overflow: 'hidden' },
  planActive: { borderWidth: 2.5 },
  planHead: { flexDirection: 'row', alignItems: 'center', padding: Spacing.three, gap: Spacing.two },
  planName: { fontFamily: FontFamily.bold, fontSize: 22 },
  planPrice: { fontFamily: FontFamily.semibold, fontSize: 15 },
  planSave: { fontFamily: FontFamily.semibold, fontSize: 12.5, opacity: 0.85 },
  lockedNote: { fontFamily: FontFamily.medium, fontSize: 13, marginTop: Spacing.two },
  segment: { flexDirection: 'row', borderWidth: Stroke, borderRadius: 999, padding: 4, gap: 4 },
  segItem: { flex: 1, borderRadius: 999, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' },
  segText: { fontFamily: FontFamily.bold, fontSize: 14 },
  segHint: { fontFamily: FontFamily.semibold, fontSize: 11 },
  current: { borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  currentText: { fontFamily: FontFamily.bold, fontSize: 12 },
  planBody: { padding: Spacing.three, gap: Spacing.two },
  planButton: { marginTop: Spacing.two },
  perk: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  perkDot: { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  perkText: { flex: 1, fontFamily: FontFamily.medium, fontSize: 14 },
  note: { fontFamily: FontFamily.medium, fontSize: 13, lineHeight: 19 },
});
