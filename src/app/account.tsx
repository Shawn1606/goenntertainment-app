import { Image } from 'expo-image';
import { Stack, useRouter, type Href } from 'expo-router';
import { useEffect } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { PlanBadge } from '@/components/plan-badge';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { PressableScale } from '@/components/ui/pressable-scale';
import { FontFamily, MaxContentWidth, Night, PlanLook, Spacing } from '@/constants/theme';
import { formatCredits, planFor } from '@/domain/club';
import { initialsOf } from '@/domain/initials';
import type { UiIconName } from '@/domain/ui-icon';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { CLUB_RULES } from '@/lib/club-rules';
import { confirmAction } from '@/lib/confirm';
import { useMarket } from '@/lib/market-context';

type Row = { key: string; icon: UiIconName; title: string; hint?: string; href: Href; badge?: number };

/**
 * Dein Konto – hinter dem Profilbild oben rechts.
 *
 * Ein öffentliches Profil gibt es nicht mehr. Was hier steht, gehört nur dir:
 * Club-Stufe, Credits, Stempel, Buchungen, Gruppen, Pass und Einstellungen.
 */
export default function AccountScreen() {
  const router = useRouter();
  const colors = useTheme();
  const { user, logout } = useAuth();
  const market = useMarket();

  useEffect(() => {
    void market.refreshClub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!user) return null;

  const plan = planFor(CLUB_RULES, user.club_plan);
  const look = PlanLook[plan.key];
  const stamps = market.club?.stamps;
  const openBookings = market.bookings.filter((b) => b.status === 'confirmed').length;
  const unread = market.groups.reduce((s, g) => s + g.unread, 0);

  const rows: Row[] = [
    { key: 'club', icon: 'crown', title: 'Club & Abo', hint: plan.name, href: '/club' },
    { key: 'wallet', icon: 'coin', title: 'Credits & Gutscheine', hint: `${formatCredits(user.credits_balance)} Credits`, href: '/wallet' },
    { key: 'stamps', icon: 'stamp', title: 'Stempelkarte', hint: stamps ? `${stamps.filled}/${stamps.fields} Stempel` : undefined, href: '/stamps' },
    { key: 'bookings', icon: 'ticket', title: 'Buchungen', hint: openBookings ? `${openBookings} offen` : undefined, href: '/bookings', badge: openBookings },
    { key: 'groups', icon: 'users', title: 'Gruppen', hint: `${market.groups.length}`, href: '/groups', badge: unread },
    { key: 'pass', icon: 'qr', title: 'Mein Pass', hint: 'Zum Vorzeigen beim Partner', href: { pathname: '/checkin', params: { mode: 'pass' } } },
  ];

  const extra: Row[] = [
    ...(user.is_partner_staff ? [{ key: 'partner', icon: 'scan' as const, title: 'Partner-Modus', hint: 'Kunden-Pässe scannen, Buchungen einlösen', href: '/partner-mode' as Href }] : []),
    ...(user.is_admin ? [{ key: 'admin', icon: 'shield' as const, title: 'Admin-Bereich', hint: 'Partner, Angebote, Gutscheine, Nutzer', href: '/admin-dashboard' as Href }] : []),
    { key: 'settings', icon: 'gear', title: 'Einstellungen', hint: 'Konto, Sicherheit, Darstellung, Recht', href: '/settings' },
  ];

  const onLogout = async () => {
    if (await confirmAction('Abmelden', 'Möchtest du dich wirklich abmelden?', 'Abmelden', true)) await logout();
  };

  return (
    <View style={[styles.flex, { backgroundColor: colors.backgroundElement }]}>
      <Stack.Screen options={{ headerShown: true, title: 'Konto' }} />
      <ScrollView contentContainerStyle={styles.content}>
        <Card tone="night" style={styles.hero}>
          <View style={[styles.avatarRing, { borderColor: look.ring }]}>
            <View style={styles.avatar}>
              {user.avatar ? <Image source={{ uri: user.avatar }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <Text style={styles.initials}>{initialsOf(user.name)}</Text>}
            </View>
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={styles.name} numberOfLines={1}>
              {user.name}
            </Text>
            {user.username ? <Text style={styles.handle}>@{user.username}</Text> : null}
            <PlanBadge plan={plan.key} size="small" tone="night" />
          </View>
        </Card>

        <View style={styles.stats}>
          <Stat label="Credits" value={formatCredits(user.credits_balance)} icon="coin" onPress={() => router.push('/wallet')} />
          <Stat label="Stempel" value={stamps ? `${stamps.filled}/${stamps.fields}` : '–'} icon="stamp" onPress={() => router.push('/stamps')} />
          <Stat label="Offen" value={String(openBookings)} icon="ticket" onPress={() => router.push('/bookings')} />
        </View>

        <RowList rows={rows} />
        <RowList rows={extra} />

        <PressableScale onPress={onLogout} accessibilityRole="button" style={[styles.logout, { borderColor: '#fecaca' }]}>
          <Icon name="logout" size={18} color="#e11d48" />
          <Text style={styles.logoutText}>Abmelden</Text>
        </PressableScale>
      </ScrollView>
    </View>
  );
}

function Stat({ label, value, icon, onPress }: { label: string; value: string; icon: UiIconName; onPress: () => void }) {
  const colors = useTheme();
  return (
    <View style={styles.statWrap}>
      <Card onPress={onPress} accessibilityLabel={`${label}: ${value}`} style={styles.stat}>
        <Icon name={icon} size={20} color={colors.tint} />
        <Text style={[styles.statValue, { color: colors.text }]}>{value}</Text>
        <Text style={[styles.statLabel, { color: colors.textSecondary }]}>{label}</Text>
      </Card>
    </View>
  );
}

function RowList({ rows }: { rows: Row[] }) {
  const colors = useTheme();
  const router = useRouter();
  return (
    <Card padded={false}>
      {rows.map((row, i) => (
        <PressableScale
          key={row.key}
          onPress={() => router.push(row.href)}
          haptic="tap"
          scaleTo={0.99}
          accessibilityRole="button"
          accessibilityLabel={row.title}
          style={[styles.row, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
          <View style={[styles.rowIcon, { backgroundColor: colors.backgroundSelected }]}>
            <Icon name={row.icon} size={19} color={colors.tint} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.rowTitle, { color: colors.text }]}>{row.title}</Text>
            {row.hint ? <Text style={[styles.rowHint, { color: colors.textSecondary }]}>{row.hint}</Text> : null}
          </View>
          {row.badge ? (
            <View style={[styles.badge, { backgroundColor: colors.tint }]}>
              <Text style={styles.badgeText}>{row.badge > 9 ? '9+' : row.badge}</Text>
            </View>
          ) : null}
          <Icon name="chevron-right" size={18} color={colors.textSecondary} />
        </PressableScale>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.three, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', paddingBottom: Spacing.six },
  hero: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  avatarRing: { width: 72, height: 72, borderRadius: 36, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  avatar: { width: 62, height: 62, borderRadius: 31, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.15)' },
  initials: { color: '#ffffff', fontFamily: FontFamily.bold, fontSize: 22 },
  name: { color: '#ffffff', fontFamily: FontFamily.bold, fontSize: 21 },
  handle: { color: Night.textMuted, fontFamily: FontFamily.medium, fontSize: 13.5 },
  stats: { flexDirection: 'row', gap: Spacing.two },
  statWrap: { flex: 1 },
  stat: { alignItems: 'center', gap: 2 },
  statValue: { fontFamily: FontFamily.bold, fontSize: 19 },
  statLabel: { fontFamily: FontFamily.medium, fontSize: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingHorizontal: Spacing.three, paddingVertical: 12 },
  rowIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontFamily: FontFamily.semibold, fontSize: 15.5 },
  rowHint: { fontFamily: FontFamily.medium, fontSize: 12.5 },
  badge: { minWidth: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  badgeText: { color: '#ffffff', fontFamily: FontFamily.bold, fontSize: 11 },
  logout: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.two, borderWidth: 1.5, borderRadius: 999, paddingVertical: 12 },
  logoutText: { color: '#e11d48', fontFamily: FontFamily.bold, fontSize: 15 },
});
