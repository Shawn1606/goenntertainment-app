import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useIsFocused, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { RefreshControl, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';

import { DiscountMeter, GroupBadge } from '@/components/group-ui';
import { MascotBuddy } from '@/components/mascot-buddy';
import { useGarlandSpace } from '@/components/seasonal-decor';
import { useDockScroll, useDockSuppression } from '@/components/mascot-dock';
import { TopBar } from '@/components/top-bar';
import { AvatarStack } from '@/components/ui/avatar-stack';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Entrance } from '@/components/ui/entrance';
import { Icon } from '@/components/ui/icon';
import { KeyboardForm } from '@/components/ui/keyboard-form';
import { MotionPause } from '@/components/ui/motion-pause';
import { PressableScale } from '@/components/ui/pressable-scale';
import { TextField } from '@/components/ui/text-field';
import { FontFamily, MaxContentWidth, Night, Radius, Spacing, Stroke } from '@/constants/theme';
import { discountFor, formatPercent, planFor } from '@/domain/club';
import type { UiIconName } from '@/domain/ui-icon';
import { useTheme } from '@/hooks/use-theme';
import { api, errorMessage, type Group } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { CLUB_RULES } from '@/lib/club-rules';
import * as feedback from '@/lib/feedback';
import { useMarket } from '@/lib/market-context';

/** Diese Gruppengrößen zeigt die Rabatt-Treppe. */
const LADDER = [2, 4, 6, 10];

/**
 * Gruppen – ein eigener Tab, weil sie der Grund für den Rabatt sind.
 *
 *   Kopf:     Goenni erklärt, zwei große Wege hinein (neu anlegen, mit Code beitreten)
 *   Leer:     So funktioniert's in drei Schritten
 *   Gruppen:  je eine Karte mit eigener Farbe, wer dabei ist, Rabatt-Balken,
 *             und direkt die zwei häufigsten Wege: Chat und „Was machen wir?"
 *   Treppe:   so viel spart ihr mit 2, 4, 6, 10 Personen (deine Club-Stufe)
 *
 * In der Gruppenkarte sind Kopf (→ Gruppe öffnen) und Knöpfe Geschwister, nicht
 * ineinander: Knopf in Knopf ist im Web ungültig.
 */
export default function GroupsScreen() {
  const router = useRouter();
  const colors = useTheme();
  const { token, user } = useAuth();
  const market = useMarket();
  const [mode, setMode] = useState<'create' | 'join' | null>(null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const garland = useGarlandSpace();
  // Goenni steht schon im Kopf – das Dock kommt erst, wenn der Kopf weggescrollt ist.
  const [heroVisible, setHeroVisible] = useState(true);
  const focused = useIsFocused();
  useDockSuppression('groups-hero', focused && heroVisible);
  // Ganz schnell nach unten gescrollt? Dann fliegt Goenni hoch (mascot-dock.tsx).
  const dockScroll = useDockScroll();
  // Zwei Grenzen (Hysterese): Sonst taucht Goenni beim Scrollen um die Grenze herum ständig auf und ab.
  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = event.nativeEvent.contentOffset.y;
    if (heroVisible && y > 280) setHeroVisible(false);
    else if (!heroVisible && y < 140) setHeroVisible(true);
    dockScroll(event);
  };

  // Bei jedem Zurückkommen neu laden: Tab-Seiten bleiben geladen, und Ungelesenes aus
  // einem gerade gelesenen Chat oder neue Nachrichten sollen hier sofort stimmen.
  const { refreshGroups } = market;
  useFocusEffect(
    useCallback(() => {
      void refreshGroups();
    }, [refreshGroups]),
  );

  const plan = planFor(CLUB_RULES, user?.club_plan);
  const groups = market.groups;
  const unread = groups.reduce((sum, g) => sum + g.unread, 0);

  const openMode = (next: 'create' | 'join') => {
    setMode(mode === next ? null : next);
    setValue('');
    setError(null);
  };

  const submit = async () => {
    // Auch Enter (onSubmitEditing) läuft hier durch: Läuft schon eine Anfrage, nicht noch eine.
    if (!token || !value.trim() || !mode || busy) return;
    const name = value.trim();
    const creating = mode === 'create';
    // Die Entscheidungen stehen vor dem `try`: Bedingungen darin kann der React
    // Compiler nicht übersetzen – dann bliebe die ganze Seite unoptimiert.
    const send = () => (creating ? api.createGroup(token, name) : api.joinGroup(token, name));
    const open = (id: number) => router.push({ pathname: '/group/[id]', params: { id: String(id), ...(creating ? { created: '1' } : {}) } });
    setBusy(true);
    setError(null);
    try {
      const { data } = await send();
      feedback.joined();
      setValue('');
      setMode(null);
      await market.refreshGroups();
      open(data.id);
    } catch (e) {
      setError(errorMessage(e));
    }
    setBusy(false);
  };

  const refresh = async () => {
    setRefreshing(true);
    await market.refreshGroups();
    setRefreshing(false);
  };

  const tips = [
    ...(unread > 0 ? [{ line: unread === 1 ? 'Eine neue Nachricht wartet im Gruppenchat!' : `${unread} neue Nachrichten in deinen Gruppen!`, mood: 'cheer' as const }] : []),
    groups.length === 0
      ? { line: 'Gruppe anlegen, Link teilen, zusammen buchen – ab 2 Leuten gibt’s Rabatt!', mood: 'happy' as const }
      : { line: 'Je mehr ihr seid, desto mehr spart jeder. Lad noch wen ein!', mood: 'happy' as const },
    { line: 'Tipp: Mit „Ausflug planen“ suche ich direkt für eure ganze Gruppe.', mood: 'thinking' as const },
  ];

  return (
    <View style={[styles.flex, { backgroundColor: colors.backgroundElement }]}>
      <TopBar />
      <KeyboardForm
        contentContainerStyle={[styles.content, { paddingTop: Spacing.three + garland }]}
        keyboardShouldPersistTaps="handled"
        onScroll={onScroll}
        scrollEventThrottle={64}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.tint} />}>
        <LinearGradient colors={[...Night.gradient]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
          <Text style={styles.heroKicker}>GRUPPEN</Text>
          <Text style={styles.heroTitle}>Zusammen wird&apos;s günstiger</Text>
          {/* Aus dem Bild gescrollt, ruht Goenni (motion-pause.tsx). */}
          <MotionPause paused={!heroVisible}>
            <MascotBuddy tips={tips} tone="night" size={64} />
          </MotionPause>
          <View style={styles.heroActions}>
            <HeroAction icon="plus" label="Neue Gruppe" primary active={mode === 'create'} onPress={() => openMode('create')} />
            <HeroAction icon="link" label="Beitreten" active={mode === 'join'} onPress={() => openMode('join')} />
          </View>
        </LinearGradient>

        {mode ? (
          <Entrance>
            <Card style={styles.form}>
              <Text style={[styles.formTitle, { color: colors.text }]}>{mode === 'create' ? 'Wie heißt eure Gruppe?' : 'Einladungscode eingeben'}</Text>
              <Text style={[styles.formHint, { color: colors.textSecondary }]}>
                {mode === 'create'
                  ? 'Danach bekommst du einen Link zum Teilen – wer ihn öffnet, ist dabei.'
                  : 'Den Code oder Link hat dir jemand aus der Gruppe geschickt.'}
              </Text>
              <TextField
                label={mode === 'create' ? 'Name der Gruppe' : 'Code oder Link'}
                value={value}
                onChangeText={(v) => {
                  setValue(v);
                  setError(null);
                }}
                placeholder={mode === 'create' ? 'z. B. Familie Müller, Donnerstagsrunde' : 'ABCD-2345'}
                autoCapitalize={mode === 'join' ? 'characters' : 'sentences'}
                autoCorrect={mode === 'create'}
                autoFocus
                maxLength={mode === 'create' ? 60 : 120}
                error={error ?? undefined}
                returnKeyType="done"
                onSubmitEditing={submit}
              />
              <View style={styles.formActions}>
                <Button title="Abbrechen" variant="ghost" size="small" onPress={() => setMode(null)} disabled={busy} />
                <Button
                  title={mode === 'create' ? 'Gruppe anlegen' : 'Beitreten'}
                  icon={mode === 'create' ? 'plus' : 'users'}
                  size="small"
                  onPress={submit}
                  loading={busy}
                  disabled={mode === 'create' ? !value.trim() : value.trim().length < 4}
                />
              </View>
            </Card>
          </Entrance>
        ) : null}

        {groups.length === 0 ? (
          <Card style={styles.how}>
            <Text style={[styles.howTitle, { color: colors.text }]}>So funktioniert&apos;s</Text>
            <View style={styles.howSteps}>
              <HowStep n={1} icon="plus" title="Gruppe anlegen" text="Name ausdenken, fertig." />
              <HowArrow />
              <HowStep n={2} icon="share" title="Link teilen" text="Per WhatsApp & Co." />
              <HowArrow />
              <HowStep n={3} icon="percent" title="Sparen" text="Zusammen buchen, Rabatt sichern." />
            </View>
          </Card>
        ) : (
          <>
            <SectionTitle title={`Meine Gruppen (${groups.length})`} />
            {groups.map((g, i) => (
              <Entrance key={g.id} index={i}>
                <GroupCard
                  group={g}
                  planKey={plan.key}
                  onOpen={() => router.push({ pathname: '/group/[id]', params: { id: String(g.id) } })}
                  onChat={() => router.push({ pathname: '/chat', params: { group: String(g.id), title: g.name, people: String(g.members_count) } })}
                  onFind={() => router.navigate({ pathname: '/finder', params: { group: String(g.id) } })}
                />
              </Entrance>
            ))}
          </>
        )}

        <SectionTitle title="So viel spart ihr zusammen" />
        <Card style={styles.ladderCard}>
          <Text style={[styles.ladderHint, { color: colors.textSecondary }]}>
            Rabatt auf Partner-Angebote im {plan.name} – je mehr Personen eine Buchung hat, desto mehr.
          </Text>
          <View style={styles.ladder}>
            {LADDER.map((people, i) => {
              const percent = discountFor(CLUB_RULES, plan.key, people).percent;
              return (
                <View key={people} style={styles.ladderCol}>
                  <Text style={[styles.ladderPercent, { color: colors.tint }]}>−{formatPercent(percent)}</Text>
                  <View style={[styles.ladderBar, { height: 26 + i * 16, backgroundColor: colors.backgroundSelected }]}>
                    <LinearGradient
                      colors={['rgba(254,44,85,0.35)', 'rgba(129,52,175,0.55)']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 0, y: 1 }}
                      style={StyleSheet.absoluteFill}
                    />
                    <Icon name="users" size={14} color="#ffffff" />
                  </View>
                  <Text style={[styles.ladderPeople, { color: colors.textSecondary }]}>ab {people}</Text>
                </View>
              );
            })}
          </View>
          {plan.key === 'free' ? (
            <Button title="Mit Gold & Platinum mehr sparen" icon="crown" variant="secondary" size="small" onPress={() => router.push('/club')} />
          ) : null}
        </Card>
      </KeyboardForm>
    </View>
  );
}

function SectionTitle({ title }: { title: string }) {
  const colors = useTheme();
  return (
    <Text style={[styles.section, { color: colors.textSecondary }]} accessibilityRole="header">
      {title.toUpperCase()}
    </Text>
  );
}

function HeroAction({ icon, label, active, primary = false, onPress }: { icon: UiIconName; label: string; active: boolean; primary?: boolean; onPress: () => void }) {
  const solid = primary || active;
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ expanded: active }}
      style={[styles.heroAction, solid ? styles.heroActionSolid : null, active && !primary ? styles.heroActionActive : null]}>
      <Icon name={icon} size={18} color={solid ? Night.deep : '#ffffff'} />
      <Text style={[styles.heroActionText, solid && { color: Night.deep }]} numberOfLines={1}>
        {label}
      </Text>
    </PressableScale>
  );
}

function HowStep({ n, icon, title, text }: { n: number; icon: UiIconName; title: string; text: string }) {
  const colors = useTheme();
  return (
    <View style={styles.howStep}>
      <View style={[styles.howIcon, { backgroundColor: colors.backgroundSelected }]}>
        <Icon name={icon} size={20} color={colors.tint} />
        <View style={[styles.howNo, { backgroundColor: colors.tint, borderColor: colors.background }]}>
          <Text style={styles.howNoText}>{n}</Text>
        </View>
      </View>
      <Text style={[styles.howStepTitle, { color: colors.text }]}>{title}</Text>
      <Text style={[styles.howStepText, { color: colors.textSecondary }]}>{text}</Text>
    </View>
  );
}

function HowArrow() {
  const colors = useTheme();
  return (
    <View style={styles.howArrow}>
      <Icon name="chevron-right" size={16} color={colors.textSecondary} />
    </View>
  );
}

/**
 * Eine Gruppe als Karte. Oben (antippbar → Gruppe öffnen): Abzeichen, Name, wer
 * dabei ist, Rabatt-Balken. Unten zwei Knöpfe: Gruppenchat und „Ausflug planen".
 */
function GroupCard({ group, planKey, onOpen, onChat, onFind }: { group: Group; planKey: string; onOpen: () => void; onChat: () => void; onFind: () => void }) {
  const colors = useTheme();
  return (
    <View style={[styles.groupCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
      <PressableScale
        onPress={onOpen}
        scaleTo={0.985}
        accessibilityRole="button"
        accessibilityLabel={`${group.name} öffnen, ${group.members_count} Personen`}
        style={styles.groupTop}>
        <View style={styles.groupHead}>
          <GroupBadge name={group.name} size={52} />
          <View style={styles.groupText}>
            <Text style={[styles.groupName, { color: colors.text }]} numberOfLines={1}>
              {group.name}
            </Text>
            <View style={styles.groupMeta}>
              <AvatarStack people={group.members} total={group.members_count} max={4} size={22} />
              <Text style={[styles.groupMetaText, { color: colors.textSecondary }]} numberOfLines={1}>
                {group.members_count} {group.members_count === 1 ? 'Person' : 'Personen'}
                {group.is_owner ? ' · von dir' : ''}
              </Text>
            </View>
          </View>
          <View style={[styles.chevron, { backgroundColor: colors.backgroundSelected }]}>
            <Icon name="chevron-right" size={18} color={colors.text} />
          </View>
        </View>
        <DiscountMeter people={group.members_count} plan={planKey} textColor={colors.text} mutedColor={colors.textSecondary} trackColor={colors.backgroundSelected} />
      </PressableScale>
      <View style={[styles.groupActions, { borderTopColor: colors.border }]}>
        <PressableScale onPress={onChat} haptic="tap" accessibilityRole="button" accessibilityLabel={`Chat von ${group.name}${group.unread ? `, ${group.unread} neu` : ''}`} style={styles.groupAction}>
          <Icon name="chat" size={17} color={colors.tint} />
          <Text style={[styles.groupActionText, { color: colors.text }]}>Gruppenchat</Text>
          {group.unread > 0 ? (
            <View style={[styles.unread, { backgroundColor: colors.tint }]}>
              <Text style={styles.unreadText}>{group.unread > 9 ? '9+' : group.unread}</Text>
            </View>
          ) : null}
        </PressableScale>
        <View style={[styles.actionDivider, { backgroundColor: colors.border }]} />
        <PressableScale onPress={onFind} haptic="tap" accessibilityRole="button" accessibilityLabel={`Ausflug mit ${group.name} planen`} style={styles.groupAction}>
          <Icon name="compass" size={17} color={colors.tint} />
          <Text style={[styles.groupActionText, { color: colors.text }]}>Ausflug planen</Text>
        </PressableScale>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.three, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', paddingBottom: Spacing.six + 40 },
  hero: { borderRadius: Radius.panel, borderWidth: Stroke, borderColor: Night.line, padding: Spacing.three, gap: Spacing.three },
  heroKicker: { color: Night.sparkle, fontFamily: FontFamily.bold, fontSize: 11.5, letterSpacing: 1, marginBottom: -Spacing.two },
  heroTitle: { color: '#ffffff', fontFamily: FontFamily.bold, fontSize: 23, letterSpacing: -0.3 },
  heroActions: { flexDirection: 'row', gap: Spacing.two },
  heroAction: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 13,
    paddingHorizontal: Spacing.two,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  heroActionSolid: { backgroundColor: '#ffffff', borderColor: '#ffffff' },
  heroActionActive: { borderColor: Night.sparkle },
  heroActionText: { color: '#ffffff', fontFamily: FontFamily.bold, fontSize: 14, flexShrink: 1 },
  form: { gap: Spacing.two + 2 },
  formTitle: { fontFamily: FontFamily.bold, fontSize: 17 },
  formHint: { fontFamily: FontFamily.medium, fontSize: 13, lineHeight: 18 },
  formActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: Spacing.two },
  section: { fontFamily: FontFamily.bold, fontSize: 12, letterSpacing: 0.8, marginLeft: Spacing.two, marginTop: Spacing.two, marginBottom: -Spacing.one },
  how: { gap: Spacing.three },
  howTitle: { fontFamily: FontFamily.bold, fontSize: 17 },
  howSteps: { flexDirection: 'row', alignItems: 'flex-start' },
  howStep: { flex: 1, alignItems: 'center', gap: 4 },
  howIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  howNo: { position: 'absolute', top: -4, right: -4, width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  howNoText: { color: '#ffffff', fontFamily: FontFamily.bold, fontSize: 10.5 },
  howStepTitle: { fontFamily: FontFamily.bold, fontSize: 13, textAlign: 'center' },
  howStepText: { fontFamily: FontFamily.medium, fontSize: 11.5, textAlign: 'center', lineHeight: 15 },
  howArrow: { paddingTop: 16 },
  groupCard: {
    borderWidth: Stroke,
    borderRadius: Radius.card,
    overflow: 'hidden',
    shadowColor: '#1c0833',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },
  groupTop: { padding: Spacing.three, gap: Spacing.three },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  groupText: { flex: 1, gap: 5 },
  groupName: { fontFamily: FontFamily.bold, fontSize: 17 },
  groupMeta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  groupMetaText: { fontFamily: FontFamily.medium, fontSize: 12.5, flexShrink: 1 },
  chevron: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  groupActions: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth * 2 },
  groupAction: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12 },
  groupActionText: { fontFamily: FontFamily.bold, fontSize: 14 },
  actionDivider: { width: StyleSheet.hairlineWidth * 2, marginVertical: 8 },
  unread: { minWidth: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  unreadText: { color: '#ffffff', fontFamily: FontFamily.bold, fontSize: 10.5 },
  ladderCard: { gap: Spacing.three },
  ladderHint: { fontFamily: FontFamily.medium, fontSize: 13.5, lineHeight: 19 },
  ladder: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.two },
  ladderCol: { flex: 1, alignItems: 'center', gap: 6 },
  ladderPercent: { fontFamily: FontFamily.bold, fontSize: 16 },
  ladderBar: { width: '100%', borderRadius: Radius.field, overflow: 'hidden', alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 6 },
  ladderPeople: { fontFamily: FontFamily.semibold, fontSize: 12 },
});
