import { Image } from 'expo-image';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Mascot, MascotError } from '@/components/mascot';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { PressableScale } from '@/components/ui/pressable-scale';
import { API_URL } from '@/constants/config';
import { FontFamily, MaxContentWidth, Night, Radius, Spacing, Stroke } from '@/constants/theme';
import { BOOKING_STATUS_LABEL } from '@/domain/booking-status';
import { discountFor, formatPercent, planFor } from '@/domain/club';
import { formatDay } from '@/domain/date-format';
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
 * die zwei Wege nach vorn: Chat und „Was machen wir?" (der Finder mit eurer
 * Gruppengröße).
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
  const discount = discountFor(CLUB_RULES, plan.key, group.members_count);
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

  return (
    <View style={[styles.flex, { backgroundColor: colors.backgroundElement }]}>
      <Stack.Screen options={{ headerShown: true, title: group.name }} />
      <ScrollView contentContainerStyle={styles.content}>
        <Card tone="night" style={styles.hero}>
          <Mascot mood={created ? 'cheer' : 'happy'} gesture="wave" size={70} celebrate={!!created} waves={!!created} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={styles.heroTitle}>{group.name}</Text>
            {group.description ? <Text style={styles.heroText}>{group.description}</Text> : null}
            <Text style={styles.heroText}>
              {group.members_count} {group.members_count === 1 ? 'Person' : 'Personen'}
              {discount.percent > 0 ? ` · zusammen bis −${formatPercent(discount.percent)}` : ' · ab 2 Personen gibt’s Rabatt'}
            </Text>
          </View>
        </Card>

        <View style={styles.row2}>
          <Button
            title="Chat"
            icon="chat"
            variant="secondary"
            onPress={() => router.push({ pathname: '/chat', params: { group: String(group.id), title: group.name, people: String(group.members_count) } })}
            style={styles.flex}
          />
          <Button
            title="Was machen wir?"
            icon="search"
            onPress={() => router.navigate({ pathname: '/finder' })}
            style={styles.flex}
          />
        </View>

        {/* Einladen */}
        <Card style={styles.invite}>
          <Text style={[styles.title, { color: colors.text }]}>Leute einladen</Text>
          <Text style={[styles.text, { color: colors.textSecondary }]}>Schick den Link – oder sag den Code. Beitreten kann nur, wer ihn hat.</Text>
          <View style={[styles.codeBox, { borderColor: colors.borderStrong }]}>
            <Text style={[styles.code, { color: colors.text }]} selectable>
              {group.invite_code}
            </Text>
          </View>
          <Button title="Einladung teilen" icon="share" onPress={invite} />
          {group.is_owner ? <Button title="Neuen Code erstellen" variant="ghost" size="small" icon="refresh" onPress={rotate} /> : null}
        </Card>

        {/* Mitglieder */}
        <Text style={[styles.section, { color: colors.text }]}>Dabei</Text>
        <Card padded={false}>
          {group.members.map((m, i) => (
            <View key={m.id} style={[styles.member, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
              <View style={[styles.avatar, { backgroundColor: colors.backgroundSelected }]}>
                {m.avatar ? <Image source={{ uri: m.avatar }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <Text style={[styles.initials, { color: colors.text }]}>{initialsOf(m.name)}</Text>}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.memberName, { color: colors.text }]}>
                  {m.name}
                  {m.id === user?.id ? ' (du)' : ''}
                </Text>
                {m.is_owner ? <Text style={[styles.memberMeta, { color: colors.tint }]}>hat die Gruppe angelegt</Text> : null}
              </View>
              {group.is_owner && !m.is_owner ? (
                <PressableScale onPress={() => remove(m.id, m.name)} accessibilityRole="button" accessibilityLabel={`${m.name} entfernen`} hitSlop={8}>
                  <Icon name="close" size={18} color={colors.textSecondary} />
                </PressableScale>
              ) : null}
            </View>
          ))}
        </Card>

        {/* Gemeinsame Buchungen */}
        {group.bookings && group.bookings.length > 0 ? (
          <>
            <Text style={[styles.section, { color: colors.text }]}>Zusammen gebucht</Text>
            {group.bookings.map((b) => (
              <Card
                key={b.id}
                onPress={b.code ? () => router.push({ pathname: '/booking/[id]', params: { id: String(b.id) } }) : undefined}
                accessibilityLabel={b.offer_title}>
                <View style={styles.bookingRow}>
                  <Icon name="ticket" size={20} color={colors.tint} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.memberName, { color: colors.text }]}>{b.offer_title}</Text>
                    <Text style={[styles.memberMeta, { color: colors.textSecondary }]}>
                      {b.partner_name} · {b.people} P. · {BOOKING_STATUS_LABEL[b.status]}
                      {b.preferred_date ? ` · ${formatDay(b.preferred_date)}` : ''}
                      {b.booked_by ? ` · gebucht von ${b.booked_by}` : ''}
                    </Text>
                  </View>
                </View>
              </Card>
            ))}
          </>
        ) : null}

        <Button title={group.is_owner ? 'Gruppe löschen' : 'Gruppe verlassen'} variant="danger" onPress={leaveOrDelete} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: Spacing.three, gap: Spacing.three, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', paddingBottom: Spacing.six },
  hero: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  heroTitle: { color: '#ffffff', fontFamily: FontFamily.bold, fontSize: 21 },
  heroText: { color: Night.textMuted, fontFamily: FontFamily.medium, fontSize: 13.5 },
  row2: { flexDirection: 'row', gap: Spacing.two },
  invite: { gap: Spacing.three },
  title: { fontFamily: FontFamily.bold, fontSize: 17 },
  text: { fontFamily: FontFamily.medium, fontSize: 14 },
  codeBox: { borderWidth: Stroke, borderStyle: 'dashed', borderRadius: Radius.card, paddingVertical: Spacing.three, alignItems: 'center' },
  code: { fontFamily: FontFamily.bold, fontSize: 28, letterSpacing: 4 },
  section: { fontFamily: FontFamily.bold, fontSize: 17, marginTop: Spacing.two },
  member: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: Spacing.three },
  avatar: { width: 38, height: 38, borderRadius: 19, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  initials: { fontFamily: FontFamily.bold, fontSize: 13 },
  memberName: { fontFamily: FontFamily.semibold, fontSize: 15 },
  memberMeta: { fontFamily: FontFamily.medium, fontSize: 12.5 },
  bookingRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
});
