import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { MascotEmpty } from '@/components/mascot';
import { PartnerLogo } from '@/components/partner-logo';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { FontFamily, MaxContentWidth, Spacing } from '@/constants/theme';
import { BOOKING_STATUS_LABEL } from '@/domain/booking-status';
import { formatCredits, formatEuro } from '@/domain/club';
import { formatDay } from '@/domain/date-format';
import { useTheme } from '@/hooks/use-theme';
import type { Booking } from '@/lib/api';
import { useMarket } from '@/lib/market-context';

/** Alle eigenen Buchungen: offene oben, Vergangenes darunter. */
export default function BookingsScreen() {
  const router = useRouter();
  const colors = useTheme();
  const market = useMarket();
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    void market.refreshBookings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const open = market.bookings.filter((b) => b.status === 'confirmed');
  const past = market.bookings.filter((b) => b.status !== 'confirmed');

  const refresh = async () => {
    setRefreshing(true);
    await market.refreshBookings();
    setRefreshing(false);
  };

  return (
    <View style={[styles.flex, { backgroundColor: colors.backgroundElement }]}>
      <Stack.Screen options={{ headerShown: true, title: 'Buchungen' }} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.tint} />}>
        {market.bookings.length === 0 ? (
          <Card>
            <MascotEmpty mood="thinking" gesture="wave">
              <Text style={[styles.emptyTitle, { color: colors.text }]}>Noch nichts gebucht</Text>
              <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                Such dir im Finder etwas aus – allein oder mit deiner Gruppe.
              </Text>
              <Button title="Zum Finder" icon="search" onPress={() => router.navigate('/finder')} />
            </MascotEmpty>
          </Card>
        ) : null}

        {open.length > 0 ? <Text style={[styles.section, { color: colors.text }]}>Offen</Text> : null}
        {open.map((b) => (
          <BookingRow key={b.id} booking={b} />
        ))}

        {past.length > 0 ? <Text style={[styles.section, { color: colors.text }]}>Vergangen</Text> : null}
        {past.map((b) => (
          <BookingRow key={b.id} booking={b} />
        ))}
      </ScrollView>
    </View>
  );
}

function BookingRow({ booking }: { booking: Booking }) {
  const colors = useTheme();
  const router = useRouter();
  const open = booking.status === 'confirmed';

  return (
    <Card onPress={() => router.push({ pathname: '/booking/[id]', params: { id: String(booking.id) } })} accessibilityLabel={booking.offer_title}>
      <View style={[styles.row, !open && styles.dim]}>
        <PartnerLogo name={booking.partner_name} uri={booking.partner?.logo_url} size={46} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
            {booking.offer_title}
          </Text>
          <Text style={[styles.meta, { color: colors.textSecondary }]} numberOfLines={1}>
            {booking.partner_name} · {booking.people} P. ·{' '}
            {booking.pay_method === 'money' ? formatEuro(booking.total_cents) : `${formatCredits(booking.total_credits)} Credits`}
          </Text>
          <Text style={[styles.meta, { color: open ? colors.tint : colors.textSecondary }]}>
            {BOOKING_STATUS_LABEL[booking.status]}
            {open ? ` · bis ${formatDay(booking.valid_until)}` : ''}
            {booking.group ? ` · ${booking.group.name}` : ''}
          </Text>
        </View>
        <Icon name="chevron-right" size={18} color={colors.textSecondary} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.two, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', paddingBottom: Spacing.six },
  section: { fontFamily: FontFamily.bold, fontSize: 17, marginTop: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  dim: { opacity: 0.65 },
  title: { fontFamily: FontFamily.bold, fontSize: 15.5 },
  meta: { fontFamily: FontFamily.medium, fontSize: 13 },
  emptyTitle: { fontFamily: FontFamily.bold, fontSize: 19 },
  emptyText: { fontFamily: FontFamily.medium, fontSize: 14, textAlign: 'center', marginBottom: Spacing.two },
});
