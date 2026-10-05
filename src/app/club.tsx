import { LinearGradient } from 'expo-linear-gradient';
import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Mascot } from '@/components/mascot';
import { PlanBadge } from '@/components/plan-badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { FontFamily, MaxContentWidth, Night, PlanLook, Radius, Spacing, Stroke } from '@/constants/theme';
import { formatEuro, formatPercent, type ClubPlan } from '@/domain/club';
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
 * Jede Stufe als eigene Karte mit ihren Vorteilen und dem Gruppenrabatt-
 * Beispiel – „zu sechst sparst du X %" sagt mehr als „Gruppenrabatt × 1,5".
 */
export default function ClubScreen() {
  const colors = useTheme();
  const { token, user } = useAuth();
  const market = useMarket();
  const [busy, setBusy] = useState<string | null>(null);
  const [cheer, setCheer] = useState(0);

  useEffect(() => {
    void market.refreshClub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const club = market.club;
  const current = user?.club_plan ?? 'free';
  const testMode = (club?.payments_mode ?? 'test') === 'test';

  const subscribe = async (plan: ClubPlan) => {
    if (!token) return;
    const resume = current === plan.key && user?.club_cancel_at_period_end;
    const ok = await confirmAction(
      resume ? `${plan.name} weiterlaufen lassen?` : `${plan.name} abschließen?`,
      resume
        ? 'Deine Kündigung wird zurückgenommen.'
        : `${formatEuro(plan.priceCents)} im Monat, monatlich kündbar.${plan.monthlyCredits > 0 ? ` Du bekommst sofort ${plan.monthlyCredits} Credits.` : ''}${testMode ? '\n\nTestmodus: Es wird kein echtes Geld abgebucht.' : ''}`,
      resume ? 'Weiterlaufen lassen' : 'Zahlungspflichtig abschließen',
    );
    if (!ok) return;
    setBusy(plan.key);
    try {
      const { data } = await api.subscribe(token, plan.key);
      market.applyClub(data);
      setCheer((c) => c + 1);
      feedback.achieved();
    } catch (e) {
      feedback.failed();
      await notifyUser('Hat nicht geklappt', errorMessage(e));
    } finally {
      setBusy(null);
    }
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
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={[styles.flex, { backgroundColor: colors.backgroundElement }]}>
      <Stack.Screen options={{ headerShown: true, title: 'GÖ4Fun Club' }} />
      <ScrollView contentContainerStyle={styles.content}>
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
                  : `Verlängert sich am ${formatDay(user.club_renews_at)}.`
                : 'Stempelkarte und Gruppenrabatt hast du in jeder Stufe.'}
            </Text>
          </View>
        </Card>

        {CLUB_RULES.plans.map((plan) => {
          const look = PlanLook[plan.key];
          const active = current === plan.key;
          const sixPercent = Math.min(
            CLUB_RULES.discountCap.defaultPercent,
            plan.discountPercent + (CLUB_RULES.groupDiscount.tiers.find((t) => t.minPeople === 6)?.percent ?? 0) * plan.groupBoost,
          );
          return (
            <View key={plan.key} style={[styles.plan, { borderColor: active ? look.ring : colors.border, backgroundColor: colors.background }, active && styles.planActive]}>
              <LinearGradient colors={[...look.gradient]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.planHead}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.planName, { color: look.ink }]}>{plan.name}</Text>
                  <Text style={[styles.planPrice, { color: look.ink }]}>
                    {plan.priceCents === 0 ? 'Kostenlos' : `${formatEuro(plan.priceCents)} / Monat`}
                  </Text>
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
                <Perk text={plan.discountPercent > 0 ? `${formatPercent(plan.discountPercent)} Rabatt auf jedes Partner-Angebot` : 'Normale Partnerpreise'} />
                <Perk text={`Zu sechst bis ${formatPercent(sixPercent)} Rabatt`} />
                {plan.monthlyCredits > 0 ? <Perk text={`${plan.monthlyCredits} Credits jeden Monat geschenkt`} /> : null}
                <Perk text={`Stempelkarte: ${CLUB_RULES.stampCard.fields} Stempel = ${CLUB_RULES.stampCard.rewardCredits} Credits`} />
                <Perk text="Mit Credits bei Partnern bezahlen" />
                {plan.key !== 'free' && !(active && !user?.club_cancel_at_period_end) ? (
                  <Button
                    title={active ? 'Weiterlaufen lassen' : current === 'free' ? `${plan.name} holen` : `Zu ${plan.name} wechseln`}
                    icon="crown"
                    onPress={() => subscribe(plan)}
                    loading={busy === plan.key}
                    style={styles.planButton}
                  />
                ) : null}
                {active && plan.key !== 'free' && !user?.club_cancel_at_period_end ? (
                  <Button title="Abo kündigen" variant="ghost" size="small" onPress={cancel} loading={busy === 'cancel'} />
                ) : null}
              </View>
            </View>
          );
        })}

        <Card tone="soft">
          <Text style={[styles.note, { color: colors.textSecondary }]}>
            {testMode
              ? 'Testmodus: Abos werden ohne echte Zahlung abgeschlossen. '
              : ''}
            Abos laufen einen Monat und verlängern sich automatisch. Kündigen geht jederzeit zum Ende der Laufzeit. Ein Wechsel zwischen Gold und Platinum startet sofort eine neue Laufzeit.
          </Text>
        </Card>
      </ScrollView>
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
  current: { borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  currentText: { fontFamily: FontFamily.bold, fontSize: 12 },
  planBody: { padding: Spacing.three, gap: Spacing.two },
  planButton: { marginTop: Spacing.two },
  perk: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  perkDot: { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  perkText: { flex: 1, fontFamily: FontFamily.medium, fontSize: 14 },
  note: { fontFamily: FontFamily.medium, fontSize: 13, lineHeight: 19 },
});
