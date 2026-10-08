import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { BookingTicket } from '@/components/booking-ticket';
import { DiscountMeter, GroupBadge } from '@/components/group-ui';
import { Mascot, MascotError } from '@/components/mascot';
import { AvatarStack } from '@/components/ui/avatar-stack';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { IconButton } from '@/components/ui/icon-button';
import { PullToCloseScroll } from '@/components/ui/pull-to-close';
import { QrCode } from '@/components/ui/qr-code';
import { API_URL } from '@/constants/config';
import { FontFamily, MaxContentWidth, Night, Radius, Spacing, Stroke } from '@/constants/theme';
import { planFor } from '@/domain/club';
import { initialsOf } from '@/domain/initials';
import { inviteLink, inviteText } from '@/domain/invite-link';
import { useTheme } from '@/hooks/use-theme';
import { api, errorMessage, type Group } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { CLUB_RULES } from '@/lib/club-rules';
import { confirmAction, notifyUser } from '@/lib/confirm';
import * as feedback from '@/lib/feedback';
import { useMarket } from '@/lib/market-context';
import { shareText } from '@/lib/share';

/**
 * Eine Gruppe: wer dabei ist, wie man einlädt, was zusammen gebucht wurde – und
 * die zwei Wege nach vorn: Chat und „Ausflug planen" (Entdecken mit eurer
 * Gruppengröße).
 *
 * Der Kopf zeigt den Rabatt als Balken bis zur nächsten Stufe – Einladen lohnt
 * sich sichtbar. Eingeladen wird per Link, per Code oder per QR-Code, den man
 * einfach herzeigt.
 */
export default function GroupScreen() {
  const { id, created } = useLocalSearchParams<{ id: string; created?: string }>();
  const router = useRouter();
  const colors = useTheme();
  const { token, user } = useAuth();
  const market = useMarket();
  const [group, setGroup] = useState<Group | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setGroup((await api.group(token, Number(id))).data);
      setError(null);
    } catch (e) {
      setError(errorMessage(e, 'Diese Gruppe konnten wir nicht laden.'));
    }
  }, [token, id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (!group) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ headerShown: true, title: 'Gruppe' }} />
        {error ? <MascotError detail={error} onRetry={load} /> : <ActivityIndicator color={colors.tint} />}
      </View>
    );
  }

  const plan = planFor(CLUB_RULES, user?.club_plan);
  const link = inviteLink(API_URL, group.invite_code);

  const invite = async () => {
    feedback.tapped();
    const outcome = await shareText(inviteText(group.name, group.invite_code, link), `Einladung: ${group.name}`);
    if (outcome === 'copied') await notifyUser('Kopiert', 'Die Einladung liegt in der Zwischenablage.');
  };

  const rotate = async () => {
    if (!token) return;
    if (!(await confirmAction('Neuen Code erstellen?', 'Der alte Code und alte Links funktionieren danach nicht mehr.', 'Neuer Code'))) return;
    try {
      setGroup((await api.rotateInviteCode(token, group.id)).data);
    } catch (e) {
      await notifyUser('Hat nicht geklappt', errorMessage(e));
    }
  };

  const remove = async (memberId: number, name: string) => {
    if (!token) return;
    if (!(await confirmAction(`${name} entfernen?`, 'Die Person kann mit dem Code wieder beitreten – erneuere ihn, wenn das nicht passieren soll.', 'Entfernen', true))) return;
    try {
      const res = await api.removeGroupMember(token, group.id, memberId);
      if (res.data) setGroup({ ...group, ...res.data });
      void market.refreshGroups();
    } catch (e) {
      await notifyUser('Hat nicht geklappt', errorMessage(e));
    }
  };

  const leaveOrDelete = async () => {
    if (!token || !user) return;
    const owner = group.is_owner;
    const ok = await confirmAction(
      owner ? 'Gruppe löschen?' : 'Gruppe verlassen?',
      owner ? 'Die Gruppe und ihr Chat verschwinden für alle. Buchungen bleiben bestehen.' : 'Du kannst mit dem Code jederzeit wieder beitreten.',
      owner ? 'Löschen' : 'Verlassen',
      true,
    );
    if (!ok) return;
    try {
      if (owner) await api.deleteGroup(token, group.id);
      else await api.removeGroupMember(token, group.id, user.id);
      await market.refreshGroups();
      router.back();
    } catch (e) {
      await notifyUser('Hat nicht geklappt', errorMessage(e));
    }
  };

  const openChat = () =>
    router.push({ pathname: '/chat', params: { group: String(group.id), title: group.name, people: String(group.members_count) } });
  const unread = market.groups.find((g) => g.id === group.id)?.unread ?? 0;

  return (
    <View style={[styles.flex, { backgroundColor: colors.backgroundElement }]}>
      <Stack.Screen options={{ headerShown: true, title: group.name }} />
      <PullToCloseScroll contentContainerStyle={styles.content}>
        <LinearGradient colors={[...Night.gradient]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
          {/* Abzeichen und Goenni oben, der Name darunter in voller Breite – lange Namen brechen sonst mitten im Wort. */}
          <View style={styles.heroTop}>
            <GroupBadge name={group.name} size={58} />
            <View style={styles.heroMeta}>
              <AvatarStack people={group.members} total={group.members_count} max={5} size={24} />
              <Text style={styles.heroText}>
                {group.members_count} {group.members_count === 1 ? 'Person' : 'Personen'}
              </Text>
            </View>
            <Mascot mood={created ? 'cheer' : 'happy'} size={62} lively celebrate={!!created} waves={!!created} style={styles.heroMascot} />
          </View>
          <View style={{ gap: 4 }}>
            <Text style={styles.heroTitle} numberOfLines={2}>
              {group.name}
            </Text>
            {group.description ? <Text style={styles.heroText}>{group.description}</Text> : null}
          </View>
          <View style={styles.discountBar}>
            <DiscountMeter
              people={group.members_count}
              plan={plan.key}
              tone="night"
              textColor="#ffffff"
              mutedColor={Night.textMuted}
              trackColor="rgba(255,255,255,0.16)"
            />
          </View>
        </LinearGradient>

        <View style={styles.actions}>
          <QuickAction icon="chat" label="Chat" badge={unread} onPress={openChat} />
          <QuickAction icon="compass" label="Ausflug planen" onPress={() => router.dismissTo({ pathname: '/finder', params: { group: String(group.id) } })} />
          <QuickAction icon="share" label="Einladen" onPress={invite} />
        </View>

        <Text style={[styles.section, { color: colors.textSecondary }]} accessibilityRole="header">
          EINLADEN
        </Text>
        <Card style={styles.invite}>
          <Text style={[styles.text, { color: colors.textSecondary }]}>Schick den Link – oder sag den Code. Beitreten kann nur, wer ihn hat.</Text>
          <View style={[styles.codeBox, { borderColor: colors.borderStrong, backgroundColor: colors.backgroundElement }]}>
            <Text style={[styles.code, { color: colors.text }]} selectable>
              {group.invite_code}
            </Text>
          </View>
          <View style={styles.qrRow}>
            <View style={[styles.qr, { borderColor: colors.border }]}>
              <QrCode value={link} size={112} label={`QR-Code zum Beitreten von ${group.name}`} />
            </View>
            <Text style={[styles.qrText, { color: colors.textSecondary }]}>Steht ihr zusammen? Lass den QR-Code scannen – so ist man in Sekunden dabei.</Text>
          </View>
          <Button title="Einladung teilen" icon="share" onPress={invite} />
          {group.is_owner ? <Button title="Neuen Code erstellen" variant="ghost" size="small" icon="refresh" onPress={rotate} /> : null}
        </Card>

        <Text style={[styles.section, { color: colors.textSecondary }]} accessibilityRole="header">
          MITGLIEDER ({group.members_count})
        </Text>
        <Card padded={false}>
          {group.members.map((m, i) => (
            <View key={m.id} style={[styles.member, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth * 2, borderTopColor: colors.border }]}>
              <View style={[styles.avatar, { backgroundColor: colors.backgroundSelected }]}>
                {m.avatar ? (
                  <Image source={{ uri: m.avatar }} style={StyleSheet.absoluteFill} contentFit="cover" />
                ) : (
                  <Text style={[styles.initials, { color: colors.tint }]}>{initialsOf(m.name)}</Text>
                )}
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[styles.memberName, { color: colors.text }]} numberOfLines={1}>
                  {m.name}
                  {m.id === user?.id ? ' (du)' : ''}
                </Text>
                {m.is_owner ? (
                  <View style={[styles.ownerChip, { backgroundColor: colors.backgroundSelected }]}>
                    <Icon name="crown" size={11} color={colors.tint} />
                    <Text style={[styles.ownerText, { color: colors.tint }]}>Gründer:in</Text>
                  </View>
                ) : null}
              </View>
              {group.is_owner && !m.is_owner ? (
                <IconButton icon="close" label={`${m.name} entfernen`} onPress={() => remove(m.id, m.name)} size={34} />
              ) : null}
            </View>
          ))}
        </Card>

        {group.bookings && group.bookings.length > 0 ? (
          <>
            <Text style={[styles.section, { color: colors.textSecondary }]} accessibilityRole="header">
              ZUSAMMEN GEBUCHT
            </Text>
            {group.bookings.map((b) => (
              <BookingTicket key={b.id} booking={b} showGroup={false} compact />
            ))}
          </>
        ) : null}

        <Button title={group.is_owner ? 'Gruppe löschen' : 'Gruppe verlassen'} icon={group.is_owner ? 'trash' : 'logout'} variant="danger" onPress={leaveOrDelete} />
      </PullToCloseScroll>
    </View>
  );
}

/** Große, gut treffbare Kachel für die drei häufigsten Wege. */
function QuickAction({ icon, label, badge, onPress }: { icon: 'chat' | 'compass' | 'share'; label: string; badge?: number; onPress: () => void }) {
  const colors = useTheme();
  return (
    <View style={styles.quickWrap}>
      <Card onPress={onPress} accessibilityLabel={label} style={styles.quick}>
        <View style={[styles.quickIcon, { backgroundColor: colors.backgroundSelected }]}>
          <Icon name={icon} size={20} color={colors.tint} />
          {badge ? (
            <View style={[styles.quickBadge, { backgroundColor: colors.tint, borderColor: colors.background }]}>
              <Text style={styles.quickBadgeText}>{badge > 9 ? '9+' : badge}</Text>
            </View>
          ) : null}
        </View>
        <Text style={[styles.quickLabel, { color: colors.text }]} numberOfLines={2}>
          {label}
        </Text>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: Spacing.three, gap: Spacing.three, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', paddingBottom: Spacing.six },
  hero: { borderRadius: Radius.panel, borderWidth: Stroke, borderColor: Night.line, padding: Spacing.three, gap: Spacing.three },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  heroTitle: { color: '#ffffff', fontFamily: FontFamily.bold, fontSize: 23, letterSpacing: -0.3 },
  heroMascot: { marginLeft: 'auto' },
  heroText: { color: Night.textMuted, fontFamily: FontFamily.medium, fontSize: 13.5 },
  heroMeta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  discountBar: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: Radius.field,
    paddingHorizontal: Spacing.three,
    paddingVertical: 10,
  },
  qrRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  qr: { padding: 8, borderWidth: Stroke, borderRadius: Radius.field, backgroundColor: '#ffffff' },
  qrText: { flex: 1, fontFamily: FontFamily.medium, fontSize: 13, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: Spacing.two },
  quickWrap: { flex: 1 },
  quick: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.three },
  quickIcon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  quickBadge: { position: 'absolute', top: -4, right: -6, minWidth: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  quickBadgeText: { color: '#ffffff', fontFamily: FontFamily.bold, fontSize: 10 },
  quickLabel: { fontFamily: FontFamily.semibold, fontSize: 13, textAlign: 'center' },
  section: { fontFamily: FontFamily.bold, fontSize: 12, letterSpacing: 0.8, marginLeft: Spacing.two, marginTop: Spacing.two },
  invite: { gap: Spacing.three },
  text: { fontFamily: FontFamily.medium, fontSize: 14, lineHeight: 20 },
  codeBox: { borderWidth: Stroke, borderStyle: 'dashed', borderRadius: Radius.card, paddingVertical: Spacing.three, alignItems: 'center' },
  code: { fontFamily: FontFamily.bold, fontSize: 28, letterSpacing: 4 },
  member: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingHorizontal: Spacing.three, paddingVertical: 12, minHeight: 60 },
  avatar: { width: 40, height: 40, borderRadius: 20, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  initials: { fontFamily: FontFamily.bold, fontSize: 14 },
  memberName: { fontFamily: FontFamily.semibold, fontSize: 15 },
  memberMeta: { fontFamily: FontFamily.medium, fontSize: 12.5 },
  ownerChip: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  ownerText: { fontFamily: FontFamily.bold, fontSize: 11 },
});
