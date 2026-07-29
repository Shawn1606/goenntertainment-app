/**
 * Prämien: Punkte einlösen.
 *
 * Der Katalog kommt vom Server (`/api/me/rewards`) und nicht aus der App – auch
 * wenn `src/domain/rewards.ts` denselben kennt. Grund: Der Server entscheidet, ob
 * das Guthaben reicht, also muss der angezeigte Preis derselbe sein, gegen den
 * geprüft wird. Der eingebaute Katalog ist nur die Vorgabe, solange der Abruf
 * läuft.
 *
 * Eingelöste Coupons stehen oben, nicht unten: Wer diesen Bildschirm ein zweites
 * Mal öffnet, kommt meistens wegen eines Codes, den er vorzeigen will – nicht wegen
 * des Katalogs.
 */
import { Stack, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HomeBackground } from '@/components/home-background';
import { MascotError } from '@/components/mascot';
import { ThemedText } from '@/components/themed-text';
import { CountUp } from '@/components/ui/count-up';
import { Entrance } from '@/components/ui/entrance';
import { GlassButton, GlassCard, GlassProgressBar, SectionHeader } from '@/components/ui/glass';
import { Glow } from '@/components/ui/glow';
import { Icon } from '@/components/ui/icon';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { accountAbilities } from '@/domain/account';
import {
  COUPONS,
  POINTS_PER_ACTIVITY,
  activitiesUntil,
  canAfford,
  couponFor,
  couponProgress,
  missingFor,
  type Coupon,
} from '@/domain/rewards';
import { isUiIconName } from '@/domain/ui-icon';
import { useBrandSurface, useSignals } from '@/hooks/use-theme';
import { ApiError, api, type Redemption, type RewardTotals } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { confirmAction } from '@/lib/confirm';
import * as feedback from '@/lib/feedback';

const EMPTY_TOTALS: RewardTotals = { earned: 0, spent: 0, balance: 0 };

/** Ein Coupon, wie der Server ihn schickt. */
type ServerCoupon = { slug: string; title: string; description: string; cost: number; icon: string };

/**
 * Coupon aus Server- und App-Wissen zusammensetzen.
 *
 * **Preis und Verfügbarkeit kommen vom Server** – nur er entscheidet, ob das
 * Guthaben reicht, also muss der angezeigte Preis derselbe sein, gegen den geprüft
 * wird. **Die Wörter kommen aus der App**, solange sie den Coupon kennt: Der
 * Server ist auf ASCII geschrieben, seine Texte kämen sonst als „Heissgetraenk"
 * in der Überschrift an. Für einen Coupon, den dieses App-Bündel noch nicht kennt,
 * gilt der Servertext – lieber eine holprige Schreibweise als ein leerer Eintrag.
 *
 * Der Symbol-Name wird geprüft: Ein neuerer Server könnte einen schicken, den das
 * Set hier nicht hat – dann lieber ein Ticket als ein Absturz.
 */
function mergeCoupon(coupon: ServerCoupon): Coupon {
  const known = couponFor(coupon.slug);
  return {
    slug: coupon.slug,
    title: known?.title ?? coupon.title,
    description: known?.description ?? coupon.description,
    cost: coupon.cost,
    icon: known?.icon ?? (isUiIconName(coupon.icon) ? coupon.icon : 'ticket'),
  };
}

/** Titel einer Einlösung – wieder mit der Schreibweise der App, wenn sie sie kennt. */
function redemptionTitle(redemption: Redemption): string {
  return couponFor(redemption.coupon_slug)?.title ?? redemption.title;
}

export default function RewardsScreen() {
  const insets = useSafeAreaInsets();
  const surface = useBrandSurface();
  const signal = useSignals();
  const { token, user } = useAuth();

  const [totals, setTotals] = useState<RewardTotals>(EMPTY_TOTALS);
  const [catalog, setCatalog] = useState<readonly Coupon[]>(COUPONS);
  const [redemptions, setRedemptions] = useState<Redemption[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Welcher Coupon gerade eingelöst wird (Schlüssel) – sperrt alle Knöpfe. */
  const [redeeming, setRedeeming] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      const res = await api.rewards(token);
      setTotals(res.points);
      setRedemptions(res.redemptions);
      setCatalog(res.coupons.map(mergeCoupon));
    } catch {
      setError('Prämien konnten nicht geladen werden. Läuft das Backend?');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    feedback.tapped();
    await load();
    setRefreshing(false);
  }, [load]);

  async function onRedeem(coupon: Coupon) {
    if (!token || redeeming) return;

    const ok = await confirmAction(
      coupon.title,
      `Dafür gehen ${coupon.cost} Punkte von deinem Guthaben ab. Du bekommst einen Code, den du beim Partner vorzeigst. Zurücknehmen lässt sich das nicht.`,
      'Einlösen',
    );
    if (!ok) return;

    setRedeeming(coupon.slug);
    setError(null);
    try {
      const res = await api.redeemCoupon(token, coupon.slug);
      setTotals(res.points);
      setRedemptions((prev) => [res.data, ...prev]);
      // Ein eingelöster Coupon ist etwas Erreichtes – dasselbe Signal wie ein
      // Abzeichen, nicht das eines gewöhnlichen Tipps.
      feedback.achieved();
    } catch (err) {
      feedback.blocked();
      setError(
        err instanceof ApiError ? err.firstError() : 'Einlösen fehlgeschlagen. Bitte erneut versuchen.',
      );
    } finally {
      setRedeeming(null);
    }
  }

  /** Wie viele Aktivitäten das Guthaben bisher gekostet hat – für die Fußnote. */
  const earnedFrom = useMemo(
    () => Math.round(totals.earned / POINTS_PER_ACTIVITY),
    [totals.earned],
  );

  const canCreate = accountAbilities(user).canCreateActivities;

  return (
    <HomeBackground style={styles.screen}>
      <Stack.Screen options={{ headerShown: true, title: 'Prämien' }} />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: Spacing.four, paddingBottom: insets.bottom + Spacing.six },
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={surface.accent}
            colors={[surface.accent]}
          />
        }>
        {/* Der Stand. Steht ganz oben, weil er die Frage beantwortet, mit der man
            diesen Bildschirm öffnet. */}
        <GlassCard tone="accent" radius={Radius.panel} style={styles.balance}>
          <View style={styles.balanceHead}>
            <View style={styles.balanceText}>
              <View style={styles.balanceRow}>
                <CountUp
                  value={totals.balance}
                  animateOnMount
                  durationMs={900}
                  style={[styles.balanceValue, { color: surface.text }]}
                />
                <ThemedText style={[styles.balanceUnit, { color: surface.textMuted }]}>
                  {totals.balance === 1 ? 'Punkt' : 'Punkte'}
                </ThemedText>
              </View>
              <ThemedText type="small" style={{ color: surface.textMuted }}>
                {totals.spent > 0
                  ? `${totals.earned} gesammelt · ${totals.spent} eingelöst`
                  : `${POINTS_PER_ACTIVITY} Punkte für jede Aktivität, die du erstellst.`}
              </ThemedText>
            </View>
            <Icon name="ticket" size={30} color={surface.accent} />
          </View>

          {!canCreate ? (
            /* Ehrlich bleiben: Ein Standard-Konto kann keine Events anlegen und
               damit auch keine Punkte sammeln. Das gehört hierhin und nicht in
               eine Fußnote am Ende. */
            <ThemedText type="small" style={{ color: surface.textMuted }}>
              {'Punkte gibt es für eigene Events – die kannst du ab dem Creator-Konto erstellen. Tippe auf der Startseite oben links auf „Upgrade".'}
            </ThemedText>
          ) : null}
        </GlassCard>

        {error ? <MascotError detail={error} onRetry={loading ? undefined : load} /> : null}

        {/* Eigene Codes zuerst – siehe Kopfkommentar. */}
        {redemptions.length > 0 ? (
          <>
            <SectionHeader title="Deine Codes" />
            {redemptions.map((redemption, index) => (
              <Entrance key={redemption.id} index={index}>
                <GlassCard tone="card" style={styles.codeCard}>
                  <View style={styles.codeHead}>
                    <ThemedText type="smallBold" style={{ color: surface.text }} numberOfLines={1}>
                      {redemptionTitle(redemption)}
                    </ThemedText>
                    <ThemedText type="small" style={{ color: surface.textMuted }}>
                      −{redemption.points}
                    </ThemedText>
                  </View>
                  {/* Der Code ist der eigentliche Inhalt: groß, mit weiten
                      Buchstabenabständen, damit er sich vom Display ablesen lässt. */}
                  <ThemedText selectable style={[styles.code, { color: surface.accent }]}>
                    {redemption.code}
                  </ThemedText>
                  <ThemedText type="small" style={{ color: surface.textMuted }}>
                    Zeig den Code beim Partner vor.
                  </ThemedText>
                </GlassCard>
              </Entrance>
            ))}
          </>
        ) : null}

        <SectionHeader title="Zum Einlösen" />
        {catalog.map((coupon, index) => {
          const affordable = canAfford(coupon, totals.balance);
          const missing = missingFor(coupon, totals.balance);
          const events = activitiesUntil(coupon, totals.balance);

          return (
            <Entrance key={coupon.slug} index={index}>
              {/* Geleuchtet wird nur um das, was man JETZT nehmen kann. Ein Ziel,
                  das noch 200 Punkte entfernt ist, leuchtet nicht – sonst
                  leuchtet die ganze Liste und nichts bedeutet mehr etwas. */}
              <Glow
                active={affordable}
                color={signal.goodGlow}
                radius={Radius.card}
                intensity="soft"
                durationMs={2800}>
                <GlassCard
                  tone={affordable ? 'accent' : 'card'}
                  style={[styles.coupon, !affordable && styles.couponLocked]}>
                  <View style={styles.couponHead}>
                    <Icon
                      name={coupon.icon}
                      size={26}
                      color={affordable ? surface.accent : surface.textMuted}
                    />
                    <View style={styles.couponText}>
                      <ThemedText type="smallBold" style={{ color: surface.text }}>
                        {coupon.title}
                      </ThemedText>
                      <ThemedText type="small" style={{ color: surface.textMuted }}>
                        {coupon.description}
                      </ThemedText>
                    </View>
                    <ThemedText style={[styles.cost, { color: surface.chipText }]}>
                      {coupon.cost}
                    </ThemedText>
                  </View>

                  {affordable ? (
                    <GlassButton
                      title={redeeming === coupon.slug ? 'Wird eingelöst …' : 'Einlösen'}
                      variant="primary"
                      disabled={redeeming !== null}
                      onPress={() => onRedeem(coupon)}
                    />
                  ) : (
                    <>
                      <GlassProgressBar
                        progress={couponProgress(coupon, totals.balance)}
                        height={5}
                        glowAt={1.1}
                      />
                      <ThemedText type="small" style={{ color: surface.textMuted }}>
                        {`Noch ${missing} ${missing === 1 ? 'Punkt' : 'Punkte'} – ${
                          events === 1 ? 'eine Aktivität' : `${events} Aktivitäten`
                        }.`}
                      </ThemedText>
                    </>
                  )}
                </GlassCard>
              </Glow>
            </Entrance>
          );
        })}

        <ThemedText type="small" style={[styles.footnote, { color: surface.textMuted }]}>
          {earnedFrom > 0
            ? `Deine ${totals.earned} Punkte kommen aus ${
                earnedFrom === 1 ? 'einer erstellten Aktivität' : `${earnedFrom} erstellten Aktivitäten`
              } – je ${POINTS_PER_ACTIVITY} Punkte.`
            : `Punkte gibt es fürs Machen: ${POINTS_PER_ACTIVITY} für jede Aktivität, die du erstellst.`}
        </ThemedText>
      </ScrollView>
    </HomeBackground>
  );
}

/** Ein Wert, der in dieser Datei zweimal gebraucht wird, aber nicht ins Thema gehört. */
const CODE_SPACING = 2.5;

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.four,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
    gap: Spacing.three,
  },
  balance: { gap: Spacing.two, padding: Spacing.four },
  balanceHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  balanceText: { flex: 1, gap: 2 },
  balanceRow: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.one },
  balanceValue: { fontSize: 30, lineHeight: 36, fontWeight: '800', letterSpacing: -0.6 },
  balanceUnit: { fontSize: 15, lineHeight: 20, fontWeight: '700' },
  codeCard: { gap: Spacing.one },
  codeHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  code: { fontSize: 22, lineHeight: 28, fontWeight: '800', letterSpacing: CODE_SPACING },
  coupon: { gap: Spacing.two },
  /** Nicht bezahlbar, aber lesbar: 0.75 wie bei den Abzeichen. */
  couponLocked: { opacity: 0.75 },
  couponHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  couponText: { flex: 1, gap: 1 },
  cost: { fontSize: 19, lineHeight: 24, fontWeight: '800' },
  footnote: { textAlign: 'center', lineHeight: 18, marginTop: Spacing.two },
});
