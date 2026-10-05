import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Mascot, MascotError } from '@/components/mascot';
import { PartnerLogo } from '@/components/partner-logo';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { FontFamily, MaxContentWidth, Night, Radius, Spacing } from '@/constants/theme';
import { BOOKING_STATUS_LABEL } from '@/domain/booking-status';
import { formatCredits, formatEuro, formatPercent, planFor } from '@/domain/club';
import { formatDateTime, formatDay } from '@/domain/date-format';
import { useTheme } from '@/hooks/use-theme';
import { api, errorMessage, type Booking } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { CLUB_RULES } from '@/lib/club-rules';
import { confirmAction, notifyUser } from '@/lib/confirm';
import * as feedback from '@/lib/feedback';
import { useMarket } from '@/lib/market-context';
import { openRoute } from '@/lib/open-maps';

/**
 * Das Ticket einer Buchung.
 *
 * Einlösen geht auf zwei Wegen – wie beim Stempel: Handy an den Aufkleber
 * halten (dann ist man auch gleich eingecheckt) oder den Pass zeigen, den der
 * Partner scannt. Der Code steht groß da, falls beides nicht klappt.
 */
export default function BookingScreen() {
  const { id, fresh } = useLocalSearchParams<{ id: string; fresh?: string }>();
  const router = useRouter();
  const colors = useTheme();
  const { token } = useAuth();
  const market = useMarket();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) return;
    api
      .booking(token, Number(id))
      .then(({ data }) => setBooking(data))
      .catch((e) => setError(errorMessage(e, 'Diese Buchung konnten wir nicht laden.')));
  }, [token, id]);

  if (!booking) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ headerShown: true, title: 'Buchung' }} />
        {error ? <MascotError detail={error} /> : <ActivityIndicator color={colors.tint} />}
      </View>
    );
  }

  const open = booking.status === 'confirmed';
  const plan = planFor(CLUB_RULES, booking.plan_key);

  const cancel = async () => {
    if (!token) return;
    const ok = await confirmAction(
      'Buchung stornieren?',
      booking.pay_method === 'credits'
        ? `Die ${formatCredits(booking.total_credits)} Credits bekommst du sofort zurück.`
        : 'Der Betrag wird erstattet.',
      'Stornieren',
      true,
    );
    if (!ok) return;
    setBusy(true);
    try {
      const result = await api.cancelBooking(token, booking.id);
      setBooking(result.data);
      market.setCredits(result.credits_balance);
      void market.refreshBookings();
      feedback.left();
    } catch (e) {
      await notifyUser('Storno hat nicht geklappt', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.flex, { backgroundColor: colors.backgroundElement }]}>
      <Stack.Screen options={{ headerShown: true, title: 'Dein Ticket' }} />
      <ScrollView contentContainerStyle={styles.content}>
        {fresh ? (
          <View style={styles.fresh}>
            <Mascot mood="cheer" gesture="wave" celebrate waves size={84} />
            <Text style={[styles.freshTitle, { color: colors.text }]}>Gebucht!</Text>
            <Text style={[styles.freshText, { color: colors.textSecondary }]}>
              Vor Ort einfach dein Handy an den GÖ4Fun-Aufkleber halten – oder deinen Pass zeigen.
            </Text>
          </View>
        ) : null}

        <View style={styles.ticket}>
          <LinearGradient colors={[...Night.gradient]} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={StyleSheet.absoluteFill} />
          <View style={styles.ticketHead}>
            <PartnerLogo name={booking.partner_name} uri={booking.partner?.logo_url} size={48} />
            <View style={{ flex: 1 }}>
              <Text style={styles.ticketTitle}>{booking.offer_title}</Text>
              <Text style={styles.ticketPartner}>{booking.partner_name}</Text>
            </View>
            <View style={[styles.status, !open && styles.statusDone]}>
              <Text style={[styles.statusText, !open && styles.statusTextDone]}>{BOOKING_STATUS_LABEL[booking.status]}</Text>
            </View>
          </View>

          <View style={styles.perforation}>
            <View style={[styles.notch, styles.notchLeft, { backgroundColor: colors.backgroundElement }]} />
            <View style={styles.dashes} />
            <View style={[styles.notch, styles.notchRight, { backgroundColor: colors.backgroundElement }]} />
          </View>

          <View style={styles.codeBlock}>
            <Text style={styles.codeLabel}>Buchungscode</Text>
            <Text style={styles.code} selectable>
              {booking.code ?? '—'}
            </Text>
          </View>

          <View style={styles.facts}>
            <Fact label="Personen" value={String(booking.people)} />
            <Fact label="Wann" value={booking.preferred_date ? formatDay(booking.preferred_date) : 'Flexibel'} />
            <Fact label="Gültig bis" value={formatDay(booking.valid_until)} />
          </View>
          {booking.group ? (
            <View style={styles.groupRow}>
              <Icon name="users" size={14} color="#ffffff" />
              <Text style={styles.groupText}>Gruppe „{booking.group.name}“</Text>
            </View>
          ) : null}
        </View>

        {open ? (
          <View style={styles.actions}>
            <Button title="Am Aufkleber einlösen" icon="nfc" onPress={() => router.push({ pathname: '/checkin', params: { booking: String(booking.id) } })} />
            <Button title="Pass zeigen" icon="qr" variant="secondary" onPress={() => router.push({ pathname: '/checkin', params: { mode: 'pass' } })} />
          </View>
        ) : null}

        <Card style={styles.receipt}>
          <Text style={[styles.receiptTitle, { color: colors.text }]}>Beleg</Text>
          {booking.pay_method === 'money' ? (
            <>
              <Row label={`${booking.people} × ${formatEuro(booking.unit_price_cents ?? 0)}`} value={formatEuro(booking.subtotal_cents)} />
              {booking.discount_cents > 0 ? (
                <Row
                  label={`Rabatt (${plan.name}${booking.people > 1 ? ' + Gruppe' : ''}, ${formatPercent(booking.discount_percent)})`}
                  value={`−${formatEuro(booking.discount_cents)}`}
                  good
                />
              ) : null}
              <Row label="Bezahlt" value={formatEuro(booking.total_cents)} strong />
            </>
          ) : (
            <>
              <Row label={`${booking.people} × ${formatCredits(booking.unit_credits ?? 0)} Credits`} value={formatCredits(booking.subtotal_credits)} />
              {booking.discount_percent > 0 ? (
                <Row
                  label={`Rabatt (${formatPercent(booking.discount_percent)})`}
                  value={`−${formatCredits(booking.subtotal_credits - booking.total_credits)}`}
                  good
                />
              ) : null}
              <Row label="Bezahlt mit Credits" value={formatCredits(booking.total_credits)} strong />
            </>
          )}
          <Row label="Gebucht am" value={formatDateTime(booking.created_at)} muted />
          {booking.redeemed_at ? <Row label="Eingelöst am" value={formatDateTime(booking.redeemed_at)} muted /> : null}
          {booking.cancelled_at ? <Row label="Storniert am" value={formatDateTime(booking.cancelled_at)} muted /> : null}
        </Card>

        {booking.partner?.lat != null && booking.partner?.lng != null ? (
          <Button
            title="Route zum Partner"
            icon="map"
            variant="secondary"
            onPress={() => openRoute({ lat: booking.partner!.lat!, lng: booking.partner!.lng! }, booking.partner_name)}
          />
        ) : null}
        {open ? <Button title="Buchung stornieren" variant="danger" onPress={cancel} loading={busy} /> : null}
      </ScrollView>
    </View>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
}

function Row({ label, value, good, strong, muted }: { label: string; value: string; good?: boolean; strong?: boolean; muted?: boolean }) {
  const colors = useTheme();
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, { color: muted ? colors.textSecondary : colors.text }, strong && styles.strong]}>{label}</Text>
      <Text style={[styles.rowValue, { color: good ? '#059669' : muted ? colors.textSecondary : colors.text }, strong && styles.strong]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: Spacing.three, gap: Spacing.three, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', paddingBottom: Spacing.six },
  fresh: { alignItems: 'center', gap: 4, paddingVertical: Spacing.two },
  freshTitle: { fontFamily: FontFamily.bold, fontSize: 28 },
  freshText: { fontFamily: FontFamily.medium, fontSize: 14, textAlign: 'center', maxWidth: 340 },
  ticket: { borderRadius: Radius.panel, overflow: 'hidden', paddingVertical: Spacing.three },
  ticketHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingHorizontal: Spacing.three },
  ticketTitle: { color: '#ffffff', fontFamily: FontFamily.bold, fontSize: 18 },
  ticketPartner: { color: Night.textMuted, fontFamily: FontFamily.medium, fontSize: 13 },
  status: { backgroundColor: '#25f4ee', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  statusDone: { backgroundColor: 'rgba(255,255,255,0.18)' },
  statusText: { color: '#1c0833', fontFamily: FontFamily.bold, fontSize: 12 },
  statusTextDone: { color: '#ffffff' },
  perforation: { flexDirection: 'row', alignItems: 'center', marginVertical: Spacing.three },
  notch: { width: 22, height: 22, borderRadius: 11 },
  notchLeft: { marginLeft: -11 },
  notchRight: { marginRight: -11 },
  dashes: { flex: 1, borderTopWidth: 2, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.35)', marginHorizontal: Spacing.two },
  codeBlock: { alignItems: 'center', gap: 4 },
  codeLabel: { color: Night.textMuted, fontFamily: FontFamily.semibold, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6 },
  code: { color: '#ffffff', fontFamily: FontFamily.bold, fontSize: 34, letterSpacing: 3 },
  facts: { flexDirection: 'row', justifyContent: 'space-around', marginTop: Spacing.three, paddingHorizontal: Spacing.three },
  fact: { alignItems: 'center', gap: 2 },
  factLabel: { color: Night.textMuted, fontFamily: FontFamily.medium, fontSize: 12 },
  factValue: { color: '#ffffff', fontFamily: FontFamily.bold, fontSize: 15 },
  groupRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: Spacing.three },
  groupText: { color: '#ffffff', fontFamily: FontFamily.semibold, fontSize: 13 },
  actions: { gap: Spacing.two },
  receipt: { gap: Spacing.two },
  receiptTitle: { fontFamily: FontFamily.bold, fontSize: 17 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.two },
  rowLabel: { fontFamily: FontFamily.medium, fontSize: 14, flexShrink: 1 },
  rowValue: { fontFamily: FontFamily.semibold, fontSize: 14 },
  strong: { fontFamily: FontFamily.bold, fontSize: 15 },
});
