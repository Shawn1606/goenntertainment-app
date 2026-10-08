import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AdminScreen, SectionTitle } from '@/components/admin-ui';
import { useCelebrate } from '@/components/celebration';
import { MascotBuddy } from '@/components/mascot-buddy';
import { TestphaseMore } from '@/components/testphase-more';
import { ChallengeCard, StreakCard, TYPE_LOOK } from '@/components/testphase-ui';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { PressableScale } from '@/components/ui/pressable-scale';
import { FontFamily, Night, Radius, Spacing, Stroke } from '@/constants/theme';
import { formatCredits } from '@/domain/club';
import { CHALLENGE_TYPES, TYPE_LABEL, coachTips, openClaims, type ChallengeType, type TestphaseChallenge, type TestphaseClaim, type TestphaseState } from '@/domain/testphase';
import type { UiIconName } from '@/domain/ui-icon';
import { useTheme } from '@/hooks/use-theme';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { confirmAction, notifyUser } from '@/lib/confirm';
import * as feedback from '@/lib/feedback';
import { useMarket } from '@/lib/market-context';

/**
 * Der Admin-Bildschirm „Test": Ideen in der Testphase.
 *
 * Nur Admins sehen ihn (und nur für sie ist z. B. der doppelte Stempel beim
 * Erstbesuch aktiv). Gerechnet wird mit dem EIGENEN Konto – Besuche, Buchungen
 * und Gruppen zählen wie bei echten Nutzer:innen, Belohnungen sind echte
 * Credits. So lässt sich jede Idee im Alltag ausprobieren, bevor sie für alle
 * kommt (api/app/Support/TestPhase).
 *
 *   Kopf:        Goenni als Coach, der Stand in drei Zahlen, was abholbereit ist
 *   Serie:       Flamme, Wochen-Leiste, Meilenstein-Pfad
 *   Challenges:  nach Art filterbar, je Karte Fortschrittsring und Frist
 */
export default function AdminTestScreen() {
  const router = useRouter();
  const colors = useTheme();
  const { token } = useAuth();
  const market = useMarket();
  const celebrate = useCelebrate();
  const [state, setState] = useState<TestphaseState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<ChallengeType | 'all'>('all');

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const { data } = await api.admin.testphase.state(token);
      setState(data);
      setError(null);
    } catch (e) {
      setError(errorMessage(e, 'Die Testphase konnte nicht geladen werden.'));
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const claim = async (c: TestphaseClaim) => {
    if (!token || busy) return;
    setBusy(c.key);
    try {
      const res = await api.admin.testphase.claim(token, c.key);
      setState(res.data);
      market.setCredits(res.balance);
      celebrate({ title: 'Abgeholt!', subtitle: c.label, credits: res.credits, kind: 'coins' });
    } catch (e) {
      await notifyUser('Hat nicht geklappt', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const examples = async () => {
    if (!token || busy) return;
    setBusy('examples');
    try {
      const res = await api.admin.testphase.examples(token);
      setState(res.data);
      if (res.created === 0) await notifyUser('Schon da', 'Alle Beispiel-Challenges gibt es bereits.');
    } catch (e) {
      await notifyUser('Hat nicht geklappt', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (c: TestphaseChallenge) => {
    if (!token) return;
    const ok = await confirmAction('Challenge löschen?', `„${c.title}“ verschwindet für alle. Schon abgeholte Credits bleiben.`, 'Löschen', true);
    if (!ok) return;
    try {
      const res = await api.admin.testphase.deleteChallenge(token, c.id);
      setState(res.data);
    } catch (e) {
      await notifyUser('Hat nicht geklappt', errorMessage(e));
    }
  };

  const open = state ? openClaims(state) : [];
  const openSum = open.reduce((s, c) => s + c.reward, 0);
  const running = state ? state.challenges.filter((c) => c.allowed && c.status === 'running' && !c.claim.claimed).length : 0;
  const types = state ? CHALLENGE_TYPES.filter((t) => state.challenges.some((c) => c.type === t)) : [];
  const shown = state ? state.challenges.filter((c) => filter === 'all' || c.type === filter) : [];

  return (
    <AdminScreen
      title="Test"
      refreshing={refreshing}
      onRefresh={async () => {
        setRefreshing(true);
        await load();
        setRefreshing(false);
      }}>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {state ? (
        <>
          {/* Kopf: Goenni als Coach und der Stand auf einen Blick. */}
          <LinearGradient colors={[...Night.gradient]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
            <View style={styles.heroHead}>
              <View style={styles.badge}>
                <Icon name="flag" size={12} color={Night.sparkle} />
                <Text style={styles.badgeText}>TESTPHASE · NUR FÜR ADMINS</Text>
              </View>
            </View>
            <MascotBuddy tips={coachTips(state)} tone="night" size={72} />
            <View style={styles.stats}>
              <Stat icon="flame" value={String(state.streak.weeks)} label={state.streak.weeks === 1 ? 'Woche Serie' : 'Wochen Serie'} />
              <Stat icon="trophy" value={String(running)} label="Challenges offen" />
            </View>
            {openSum > 0 ? (
              <View style={styles.ready}>
                <Icon name="coin" size={18} color="#3b2600" />
                <Text style={styles.readyText}>
                  {formatCredits(openSum)} Credits warten auf dich – unten abholen!
                </Text>
              </View>
            ) : null}
            <Text style={styles.heroNote}>Gerechnet wird mit deinem eigenen Konto; Belohnungen sind echte Credits.</Text>
          </LinearGradient>


          <SectionTitle>Check-in-Serie</SectionTitle>
          <StreakCard state={state} busy={busy} onClaim={claim} />

          <SectionTitle action={<Button title="Neu" icon="plus" size="small" variant="secondary" onPress={() => router.push('/admin-test-challenge')} />}>
            Challenges
          </SectionTitle>
          {state.challenges.length === 0 ? (
            <Card style={{ gap: Spacing.two }}>
              <Text style={[styles.text, { color: colors.textSecondary }]}>
                Noch keine Challenges. Leg die Beispiele an – je Art mindestens eine, u. a. „10× Bowling“ und „5 Softdrinks über Gratis-Angebote“.
              </Text>
              <Button title="Beispiele anlegen" icon="sparkles" onPress={examples} loading={busy === 'examples'} />
            </Card>
          ) : (
            <>
              <View style={styles.filters}>
                <Filter label={`Alle · ${state.challenges.length}`} active={filter === 'all'} onPress={() => setFilter('all')} />
                {types.map((t) => (
                  <Filter
                    key={t}
                    label={TYPE_LOOK[t].short}
                    icon={TYPE_LOOK[t].icon}
                    color={TYPE_LOOK[t].color}
                    active={filter === t}
                    onPress={() => setFilter(t)}
                  />
                ))}
              </View>
              {CHALLENGE_TYPES.map((type) => {
                const list = shown.filter((c) => c.type === type);
                if (list.length === 0) return null;
                return (
                  <View key={type} style={{ gap: Spacing.two }}>
                    <View style={styles.groupHead}>
                      <Icon name={TYPE_LOOK[type].icon} size={15} color={TYPE_LOOK[type].color} />
                      <Text style={[styles.groupTitle, { color: colors.textSecondary }]}>{TYPE_LABEL[type]}</Text>
                    </View>
                    {list.map((c) => (
                      <ChallengeCard key={c.id} challenge={c} busy={busy} onClaim={claim} onDelete={() => remove(c)} />
                    ))}
                  </View>
                );
              })}
              <Button title="Fehlende Beispiele anlegen" variant="ghost" size="small" onPress={examples} loading={busy === 'examples'} />
            </>
          )}

          {/* Wahl-Challenges, Happy Hour & Kontingente, Treuestufen, Sammelalbum, Wunschliste, Kosten teilen, Abstimmungen, Rückmeldungen */}
          <TestphaseMore state={state} onState={setState} />

          <SectionTitle>Erstbesuch-Bonus</SectionTitle>
          <Card style={styles.row}>
            <View style={[styles.bonusIcon, { backgroundColor: colors.backgroundSelected }]}>
              <Icon name="stamp" size={20} color={colors.tint} />
            </View>
            <Text style={[styles.text, { color: colors.text, flex: 1 }]}>
              {state.first_visit_bonus.active
                ? 'Aktiv für dich: Beim allerersten Besuch bei einem Partner gibt es zwei Stempel statt einem.'
                : 'Nur für Admins aktiv.'}
            </Text>
          </Card>
        </>
      ) : null}
    </AdminScreen>
  );
}

function Stat({ icon, value, label }: { icon: UiIconName; value: string; label: string }) {
  return (
    <View style={styles.stat}>
      <Icon name={icon} size={16} color={Night.sparkle} />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function Filter({
  label,
  active,
  onPress,
  icon,
  color,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  icon?: UiIconName;
  color?: string;
}) {
  const colors = useTheme();
  const tint = color ?? colors.tint;
  return (
    <PressableScale
      onPress={() => {
        feedback.selected();
        onPress();
      }}
      haptic="none"
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={[styles.filter, { borderColor: active ? tint : colors.border, backgroundColor: active ? tint : colors.background }]}>
      {icon ? <Icon name={icon} size={13} color={active ? '#ffffff' : tint} /> : null}
      <Text style={[styles.filterText, { color: active ? '#ffffff' : colors.text }]}>{label}</Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  error: { color: '#dc2626', fontFamily: FontFamily.semibold },
  text: { fontFamily: FontFamily.medium, fontSize: 14, lineHeight: 20 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  hero: { borderRadius: Radius.panel, borderWidth: Stroke, borderColor: Night.line, padding: Spacing.three, gap: Spacing.three },
  heroHead: { flexDirection: 'row' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3, backgroundColor: 'rgba(37,244,238,0.12)' },
  badgeText: { color: Night.sparkle, fontFamily: FontFamily.bold, fontSize: 10.5, letterSpacing: 0.8 },
  stats: { flexDirection: 'row', gap: Spacing.two },
  stat: { flex: 1, alignItems: 'center', gap: 2, borderRadius: Radius.field, paddingVertical: Spacing.two, backgroundColor: 'rgba(255,255,255,0.1)' },
  statValue: { color: '#ffffff', fontFamily: FontFamily.bold, fontSize: 20 },
  statLabel: { color: Night.textMuted, fontFamily: FontFamily.medium, fontSize: 11 },
  ready: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderRadius: Radius.field, padding: Spacing.three, backgroundColor: '#f5c542' },
  readyText: { flex: 1, color: '#3b2600', fontFamily: FontFamily.bold, fontSize: 14 },
  heroNote: { color: Night.textMuted, fontFamily: FontFamily.medium, fontSize: 12, lineHeight: 16 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  filter: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: Stroke, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6 },
  filterText: { fontFamily: FontFamily.semibold, fontSize: 12.5 },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: Spacing.one },
  groupTitle: { fontFamily: FontFamily.bold, fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.6 },
  bonusIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});
