import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AdminScreen, Kpi, SectionTitle } from '@/components/admin-ui';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { FontFamily, Radius, Spacing } from '@/constants/theme';
import { formatCredits, formatEuro } from '@/domain/club';
import { BOOKING_STATUS_LABEL, expiryInfo } from '@/domain/booking-status';
import { formatDateTimeCompact, formatDay, formatDayShort } from '@/domain/date-format';
import type { UiIconName } from '@/domain/ui-icon';
import { useTheme } from '@/hooks/use-theme';
import { useNow } from '@/hooks/use-now';
import { api, errorMessage, type AdminBooking, type AdminStats, type AdminStatsPoint } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

/** Der Einstieg in den Admin-Bereich: Zahlen, Wege, letzte Buchungen. */
export default function AdminDashboard() {
  const router = useRouter();
  const colors = useTheme();
  const { token } = useAuth();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [bookings, setBookings] = useState<AdminBooking[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const now = useNow();

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [s, b] = await Promise.all([api.admin.stats(token), api.admin.bookings(token)]);
      setStats(s);
      setBookings(b.data.slice(0, 10));
      setError(null);
    } catch (e) {
      setError(errorMessage(e, 'Admin-Daten konnten nicht geladen werden.'));
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const t = stats?.totals;
  const links: { title: string; hint: string; icon: UiIconName; href: Href; badge?: number }[] = [
    { title: 'Partner & Angebote', hint: 'Anlegen, Bilder, Aufkleber-Code, Team', icon: 'building', href: '/admin-partners' },
    { title: 'Gutscheine', hint: 'Auflagen für den Handel, Codes als CSV', icon: 'gift', href: '/admin-vouchers' },
    { title: 'Nutzer', hint: 'Suchen, Credits gutschreiben, sperren', icon: 'users', href: '/admin-users' },
    { title: 'Meldungen', hint: 'Was Nutzer:innen gemeldet haben', icon: 'flag', href: '/admin-reports', badge: t?.open_reports },
    { title: 'Beweise', hint: 'Sperren mit Grund und Bild', icon: 'folder', href: '/admin-evidence' },
    { title: 'Funktionen für alle', hint: 'Für ALLE Nutzer an/aus: Stadt-Bingo, Saison-Thema', icon: 'users', href: '/admin-features' },
    { title: 'Nur für mich', hint: 'Vorschau fürs eigene Konto – niemand sonst sieht es', icon: 'eye', href: '/admin-preview' },
    { title: 'Test', hint: 'Testphase: Challenges, Check-in-Serie und mehr', icon: 'trophy', href: '/admin-test' },
  ];

  return (
    <AdminScreen
      title="Admin"
      refreshing={refreshing}
      onRefresh={async () => {
        setRefreshing(true);
        await load();
        setRefreshing(false);
      }}>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {t ? (
        <View style={styles.kpis}>
          <Kpi label="Nutzer" value={String(t.users)} icon="users" />
          <Kpi label="Aktive Partner" value={String(t.partners)} icon="building" />
          <Kpi label="Aktive Angebote" value={String(t.offers)} icon="ticket" />
          <Kpi label="Buchungen" value={String(t.bookings)} icon="ticket" />
          <Kpi label="Offen" value={String(t.open_bookings)} icon="clock" />
          <Kpi label="Umsatz (Euro-Buchungen)" value={formatEuro(t.revenue_cents)} icon="wallet" />
          <Kpi label="Credits im Umlauf" value={formatCredits(t.credits_outstanding)} icon="coin" />
          <Kpi label="Gold / Platinum" value={`${t.members_gold} / ${t.members_platinum}`} icon="crown" />
          <Kpi label="Check-ins (7 Tage)" value={String(t.checkins_week)} icon="stamp" />
          <Kpi label="Offene Meldungen" value={String(t.open_reports)} icon="flag" tone={t.open_reports > 0 ? 'warn' : undefined} />
        </View>
      ) : null}

      {stats ? (
        <Card style={{ gap: Spacing.three }}>
          <Bars title="Buchungen" points={stats.series.bookings} />
          <Bars title="Neue Konten" points={stats.series.signups} />
          <Bars title="Check-ins" points={stats.series.checkins} />
        </Card>
      ) : null}

      <SectionTitle>Verwalten</SectionTitle>
      {links.map((l) => (
        <Card key={l.title} onPress={() => router.push(l.href)} accessibilityLabel={l.title}>
          <View style={styles.link}>
            <View style={[styles.linkIcon, { backgroundColor: colors.backgroundSelected }]}>
              <Icon name={l.icon} size={20} color={colors.tint} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.linkTitle, { color: colors.text }]}>{l.title}</Text>
              <Text style={[styles.linkHint, { color: colors.textSecondary }]}>{l.hint}</Text>
            </View>
            {l.badge ? (
              <View style={[styles.badge, { backgroundColor: '#d97706' }]}>
                <Text style={styles.badgeText}>{l.badge}</Text>
              </View>
            ) : null}
            <Icon name="chevron-right" size={18} color={colors.textSecondary} />
          </View>
        </Card>
      ))}

      {bookings.length > 0 ? (
        <>
          <SectionTitle>Letzte Buchungen</SectionTitle>
          <Text style={[styles.linkHint, { color: colors.textSecondary }]}>
            Was Kund:innen zuletzt gebucht haben: Angebot und Partner, wer, wie viele, Status, Code zum Einlösen und bis wann es gilt.
          </Text>
          <Card padded={false}>
            {bookings.map((b, i) => {
              const open = b.status === 'confirmed';
              const expiry = open ? expiryInfo(b.valid_until, now) : null;
              const urgent = expiry?.tone === 'urgent';
              return (
                <View key={b.id} style={[styles.booking, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
                  <View style={styles.bookingTop}>
                    <View style={[styles.bookingIcon, { backgroundColor: colors.backgroundSelected }]}>
                      <Icon name="ticket" size={16} color={colors.tint} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.linkTitle, { color: colors.text }]} numberOfLines={1}>
                        {b.offer_title}
                      </Text>
                      <Text style={[styles.linkHint, { color: colors.textSecondary }]} numberOfLines={1}>
                        {b.partner_name} · {b.user?.name ?? 'gelöschtes Konto'} · {b.people} {b.people === 1 ? 'Person' : 'Personen'}
                      </Text>
                    </View>
                    <Text style={[styles.amount, { color: colors.text }]}>
                      {b.pay_method === 'money' ? formatEuro(b.total_cents) : `${formatCredits(b.total_credits)} Cr`}
                    </Text>
                  </View>
                  <View style={styles.bookingFacts}>
                    <View style={[styles.statusChip, { backgroundColor: open ? 'rgba(16,185,129,0.12)' : colors.backgroundSelected }]}>
                      <Text style={[styles.statusText, { color: open ? '#059669' : colors.textSecondary }]}>{BOOKING_STATUS_LABEL[b.status]}</Text>
                    </View>
                    {b.code ? <Text style={[styles.bookingCode, { color: colors.text, borderColor: colors.border }]}>{b.code}</Text> : null}
                    <Text style={[styles.linkHint, { color: colors.textSecondary }]}>Gekauft {formatDateTimeCompact(b.created_at)}</Text>
                    {open ? (
                      <Text style={[styles.linkHint, { color: urgent ? '#e11d48' : colors.textSecondary, fontFamily: urgent ? FontFamily.bold : FontFamily.medium }]}>
                        Verfällt {formatDay(b.valid_until)}
                        {expiry ? ` (${expiry.label.replace('Noch ', 'noch ').replace(' gültig', '')})` : ''}
                      </Text>
                    ) : null}
                  </View>
                </View>
              );
            })}
          </Card>
        </>
      ) : null}
    </AdminScreen>
  );
}

/** Kleines Balkendiagramm der letzten Tage – ohne Bibliothek. */
function Bars({ title, points }: { title: string; points: AdminStatsPoint[] }) {
  const colors = useTheme();
  const max = Math.max(1, ...points.map((p) => p.count));
  const total = points.reduce((s, p) => s + p.count, 0);
  return (
    <View style={{ gap: 6 }}>
      <View style={styles.barsHead}>
        <Text style={[styles.linkTitle, { color: colors.text }]}>{title}</Text>
        <Text style={[styles.linkHint, { color: colors.textSecondary }]}>{total} in 14 Tagen</Text>
      </View>
      <View style={styles.bars} accessibilityLabel={`${title}: ${total} in 14 Tagen`}>
        {points.map((p) => (
          <View key={p.date} style={styles.barCol}>
            <View style={[styles.bar, { height: 4 + (p.count / max) * 56, backgroundColor: p.count > 0 ? colors.tint : colors.backgroundSelected }]} />
          </View>
        ))}
      </View>
      <View style={styles.barsHead}>
        <Text style={[styles.axis, { color: colors.textSecondary }]}>{formatDayShort(points[0]?.date)}</Text>
        <Text style={[styles.axis, { color: colors.textSecondary }]}>{formatDayShort(points.at(-1)?.date)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  error: { color: '#e11d48', fontFamily: FontFamily.semibold, textAlign: 'center' },
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  link: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  linkIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  linkTitle: { fontFamily: FontFamily.bold, fontSize: 15 },
  linkHint: { fontFamily: FontFamily.medium, fontSize: 12.5 },
  badge: { minWidth: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  badgeText: { color: '#ffffff', fontFamily: FontFamily.bold, fontSize: 11 },
  booking: { gap: Spacing.two, padding: Spacing.three },
  bookingTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  bookingIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  bookingFacts: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: Spacing.two, rowGap: 4, paddingLeft: 32 + Spacing.three },
  statusChip: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  statusText: { fontFamily: FontFamily.bold, fontSize: 11.5 },
  bookingCode: { fontFamily: FontFamily.bold, fontSize: 12, letterSpacing: 0.8, borderWidth: 1, borderStyle: 'dashed', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
  amount: { fontFamily: FontFamily.bold, fontSize: 14 },
  barsHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 62 },
  barCol: { flex: 1, justifyContent: 'flex-end' },
  bar: { borderRadius: Radius.chip, width: '100%' },
  axis: { fontFamily: FontFamily.medium, fontSize: 11 },
});
