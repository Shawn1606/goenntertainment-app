import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Mascot } from '@/components/mascot';
import { PlanBadge } from '@/components/plan-badge';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { ListRow, ListSection } from '@/components/ui/list-row';
import { PressableScale } from '@/components/ui/pressable-scale';
import { FontFamily, MaxContentWidth, Night, PlanLook, Radius, Spacing, Stroke } from '@/constants/theme';
import { formatCredits, planFor } from '@/domain/club';
import { initialsOf } from '@/domain/initials';
import type { UiIconName } from '@/domain/ui-icon';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { CLUB_RULES } from '@/lib/club-rules';
import { confirmAction } from '@/lib/confirm';
import { useMarket } from '@/lib/market-context';

/**
 * Dein Konto – hinter dem Profilbild oben rechts.
 *
 * Oben du selbst (Bild antippen = Profil bearbeiten) und deine drei wichtigsten
 * Zahlen; darunter in zwei Abschnitten alles, was dir gehört, und ganz unten
 * Einstellungen und Abmelden. Ein öffentliches Profil gibt es nicht.
 *
 * Gruppen und Tickets stehen hier nicht mehr: Sie haben eigene Tabs unten.
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

  const onLogout = async () => {
    if (await confirmAction('Abmelden', 'Möchtest du dich wirklich abmelden?', 'Abmelden', true)) await logout();
  };

  return (
    <View style={[styles.flex, { backgroundColor: colors.backgroundElement }]}>
      <Stack.Screen options={{ headerShown: true, title: 'Konto' }} />
      <ScrollView contentContainerStyle={styles.content}>
        <LinearGradient colors={[...Night.gradient]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
          <PressableScale onPress={() => router.push('/profile')} accessibilityRole="button" accessibilityLabel="Profil bearbeiten" scaleTo={0.96}>
            <View style={[styles.avatarRing, { borderColor: look.ring }]}>
              <View style={styles.avatar}>
                {user.avatar ? (
                  <Image source={{ uri: user.avatar }} style={StyleSheet.absoluteFill} contentFit="cover" />
                ) : (
                  <Text style={styles.initials}>{initialsOf(user.name)}</Text>
                )}
              </View>
              <View style={[styles.editBadge, { backgroundColor: colors.tint }]}>
                <Icon name="camera" size={13} color="#ffffff" />
              </View>
            </View>
          </PressableScale>
          <View style={styles.heroText}>
            <Text style={styles.name} numberOfLines={1}>
              {user.name}
            </Text>
            {user.username ? <Text style={styles.handle}>@{user.username}</Text> : null}
            <PlanBadge plan={plan.key} size="small" tone="night" />
          </View>
          <Mascot mood="happy" size={58} lively style={styles.heroMascot} />
          <PressableScale onPress={() => router.push('/profile')} accessibilityRole="button" accessibilityLabel="Profil bearbeiten" style={styles.editButton}>
            <Icon name="edit" size={15} color="#ffffff" />
            <Text style={styles.editText}>Profil bearbeiten</Text>
          </PressableScale>
        </LinearGradient>

        <View style={styles.stats}>
          <Stat label="Credits" value={formatCredits(user.credits_balance)} icon="coin" onPress={() => router.push('/wallet')} />
          <Stat label="Stempel" value={stamps ? `${stamps.filled}/${stamps.fields}` : '–'} icon="stamp" onPress={() => router.push('/stamps')} />
          <Stat label="Tickets" value={String(openBookings)} icon="ticket" onPress={() => router.dismissTo('/bookings')} />
        </View>

        <ListSection title="Mein GÖ4Fun">
          <ListRow first icon="crown" title="Club & Abo" value={plan.name} onPress={() => router.push('/club')} />
          <ListRow icon="coin" title="Credits & Gutscheine" value={`${formatCredits(user.credits_balance)}`} onPress={() => router.push('/wallet')} />
          <ListRow icon="stamp" title="Stempelkarte" value={stamps ? `${stamps.filled}/${stamps.fields}` : undefined} onPress={() => router.push('/stamps')} />
          <ListRow icon="qr" title="Mein Pass" hint="Zum Vorzeigen beim Partner" onPress={() => router.push({ pathname: '/checkin', params: { mode: 'pass' } })} />
          <ListRow icon="trophy" title="Abzeichen" hint="Deine Meilensteine mit Datum" onPress={() => router.push('/badges')} />
        </ListSection>

        {user.is_partner_staff || user.is_admin ? (
          <ListSection title="Verwaltung">
            {user.is_partner_staff ? (
              <ListRow first icon="scan" title="Partner-Modus" hint="Kunden-Pässe scannen, Buchungen einlösen" onPress={() => router.push('/partner-mode')} />
            ) : null}
            {user.is_admin ? (
              <ListRow first={!user.is_partner_staff} icon="shield" title="Admin-Bereich" hint="Partner, Angebote, Gutscheine, Nutzer" onPress={() => router.push('/admin-dashboard')} />
            ) : null}
          </ListSection>
        ) : null}

        <ListSection title="App">
          <ListRow first icon="gear" title="Einstellungen" hint="Anmeldung, Mitteilungen, Darstellung, Hilfe" onPress={() => router.push('/settings')} />
        </ListSection>

        <PressableScale onPress={onLogout} accessibilityRole="button" style={[styles.logout, { borderColor: 'rgba(225,29,72,0.4)', backgroundColor: colors.background }]}>
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
        {/* Kleiner Pfeil oben rechts: Die Kachel ist ein Knopf. */}
        <View style={styles.statArrow}>
          <Icon name="chevron-right" size={14} color={colors.textSecondary} />
        </View>
        <Icon name={icon} size={20} color={colors.tint} />
        <Text style={[styles.statValue, { color: colors.text }]} numberOfLines={1}>
          {value}
        </Text>
        <Text style={[styles.statLabel, { color: colors.textSecondary }]}>{label}</Text>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.four, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', paddingBottom: Spacing.six },
  hero: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing.three,
    borderRadius: Radius.panel,
    borderWidth: Stroke,
    borderColor: Night.line,
    padding: Spacing.three,
  },
  avatarRing: { width: 76, height: 76, borderRadius: 38, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  avatar: { width: 66, height: 66, borderRadius: 33, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.15)' },
  initials: { color: '#ffffff', fontFamily: FontFamily.bold, fontSize: 23 },
  editBadge: { position: 'absolute', right: -2, bottom: -2, width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: Night.deep, alignItems: 'center', justifyContent: 'center' },
  heroText: { flex: 1, gap: 4, minWidth: 120 },
  name: { color: '#ffffff', fontFamily: FontFamily.bold, fontSize: 21 },
  handle: { color: Night.textMuted, fontFamily: FontFamily.medium, fontSize: 13.5 },
  heroMascot: { marginRight: -Spacing.one },
  editButton: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  editText: { color: '#ffffff', fontFamily: FontFamily.bold, fontSize: 14 },
  stats: { flexDirection: 'row', gap: Spacing.two },
  statWrap: { flex: 1 },
  stat: { alignItems: 'center', gap: 2 },
  statArrow: { position: 'absolute', top: 6, right: 6 },
  statValue: { fontFamily: FontFamily.bold, fontSize: 19 },
  statLabel: { fontFamily: FontFamily.medium, fontSize: 12 },
  logout: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.two, borderWidth: 1.5, borderRadius: 999, paddingVertical: 14 },
  logoutText: { color: '#e11d48', fontFamily: FontFamily.bold, fontSize: 15 },
});
