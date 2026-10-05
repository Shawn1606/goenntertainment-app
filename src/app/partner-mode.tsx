import { CameraView, useCameraPermissions } from 'expo-camera';
import { Stack, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Mascot, MascotEmpty } from '@/components/mascot';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { PressableScale } from '@/components/ui/pressable-scale';
import { FontFamily, MaxContentWidth, Radius, Spacing, Stroke } from '@/constants/theme';
import { BOOKING_STATUS_LABEL } from '@/domain/booking-status';
import { formatClock } from '@/domain/date-format';
import { useTheme } from '@/hooks/use-theme';
import { api, errorMessage, type Booking, type CheckinResult } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { notifyUser } from '@/lib/confirm';
import * as feedback from '@/lib/feedback';

type StaffPartner = { id: number; name: string; role: string };

/**
 * Der Partner-Modus – für Mitarbeitende an der Kasse.
 *
 * Kunde zeigt seinen Pass (QR in der App), du scannst ihn: Der Kunde bekommt
 * seinen Stempel, und seine offenen Buchungen bei euch stehen sofort darunter –
 * ein Tipp löst sie ein. Darunter die Buchungen des Tages.
 *
 * Freigeschaltet wird man vom GÖ4Fun-Team (Admin-Bereich → Partner → Team).
 */
export default function PartnerModeScreen() {
  const colors = useTheme();
  const { token } = useAuth();
  const [permission, requestPermission] = useCameraPermissions();
  const [partners, setPartners] = useState<StaffPartner[]>([]);
  const [partnerId, setPartnerId] = useState<number | null>(null);
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<CheckinResult | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [checkedIn, setCheckedIn] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const busy = useRef(false);

  useEffect(() => {
    if (!token) return;
    api.staffPartners(token).then(({ data }) => {
      setPartners(data);
      if (data.length > 0) setPartnerId(data[0].id);
    });
  }, [token]);

  const loadBookings = useCallback(async () => {
    if (!token || !partnerId) return;
    try {
      const res = await api.staffBookings(token, partnerId);
      setBookings(res.data);
      setCheckedIn(res.checked_in_today);
    } catch {
      // Liste bleibt stehen.
    }
  }, [token, partnerId]);

  useFocusEffect(
    useCallback(() => {
      void loadBookings();
    }, [loadBookings]),
  );

  const onScan = async (data: string) => {
    if (!token || !partnerId || busy.current) return;
    busy.current = true;
    setScanning(false);
    try {
      const res = await api.staffCheckin(token, partnerId, data);
      setResult(res.data);
      feedback.achieved();
      void loadBookings();
    } catch (e) {
      feedback.failed();
      await notifyUser('Pass nicht erkannt', errorMessage(e));
    } finally {
      busy.current = false;
    }
  };

  const redeem = async (booking: Booking) => {
    if (!token) return;
    try {
      await api.staffRedeem(token, booking.id);
      feedback.joined();
      setResult((r) => (r ? { ...r, open_bookings: r.open_bookings.filter((b) => b.id !== booking.id) } : r));
      void loadBookings();
    } catch (e) {
      await notifyUser('Einlösen hat nicht geklappt', errorMessage(e));
    }
  };

  if (partners.length === 0) {
    return (
      <View style={[styles.flex, styles.center, { backgroundColor: colors.backgroundElement }]}>
        <Stack.Screen options={{ headerShown: true, title: 'Partner-Modus' }} />
        <MascotEmpty mood="thinking">
          <Text style={[styles.text, { color: colors.textSecondary }]}>Du bist für keinen Partner freigeschaltet.</Text>
        </MascotEmpty>
      </View>
    );
  }

  const open = bookings.filter((b) => b.status === 'confirmed');
  const done = bookings.filter((b) => b.status === 'redeemed');

  return (
    <View style={[styles.flex, { backgroundColor: colors.backgroundElement }]}>
      <Stack.Screen options={{ headerShown: true, title: 'Partner-Modus' }} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await loadBookings();
              setRefreshing(false);
            }}
            tintColor={colors.tint}
          />
        }>
        {partners.length > 1 ? (
          <View style={styles.chips}>
            {partners.map((p) => (
              <PressableScale
                key={p.id}
                onPress={() => setPartnerId(p.id)}
                haptic="select"
                style={[styles.chip, { borderColor: partnerId === p.id ? colors.tint : colors.border, backgroundColor: partnerId === p.id ? colors.tint : colors.background }]}>
                <Text style={[styles.chipText, { color: partnerId === p.id ? '#ffffff' : colors.text }]}>{p.name}</Text>
              </PressableScale>
            ))}
          </View>
        ) : (
          <Text style={[styles.partner, { color: colors.text }]}>{partners[0].name}</Text>
        )}

        <View style={styles.stats}>
          <Card style={styles.stat}>
            <Text style={[styles.statValue, { color: colors.text }]}>{checkedIn}</Text>
            <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Check-ins heute</Text>
          </Card>
          <Card style={styles.stat}>
            <Text style={[styles.statValue, { color: colors.text }]}>{open.length}</Text>
            <Text style={[styles.statLabel, { color: colors.textSecondary }]}>offene Buchungen</Text>
          </Card>
        </View>

        {scanning ? (
          <View style={[styles.camera, { borderColor: colors.border }]}>
            {permission?.granted ? (
              <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={({ data }) => onScan(data)} />
            ) : (
              <View style={[styles.center, { flex: 1, gap: Spacing.two }]}>
                <Text style={[styles.text, { color: '#ffffff' }]}>Zum Scannen brauchen wir die Kamera.</Text>
                <Button title="Kamera erlauben" size="small" onPress={requestPermission} />
              </View>
            )}
            <View pointerEvents="none" style={styles.frame} />
          </View>
        ) : null}
        <Button
          title={scanning ? 'Scannen abbrechen' : 'Kunden-Pass scannen'}
          icon={scanning ? 'close' : 'scan'}
          variant={scanning ? 'secondary' : 'primary'}
          onPress={() => {
            setResult(null);
            setScanning((s) => !s);
          }}
        />

        {result ? (
          <Card style={styles.result}>
            <View style={styles.resultHead}>
              <Mascot mood="cheer" size={56} celebrate />
              <View style={{ flex: 1 }}>
                <Text style={[styles.resultTitle, { color: colors.text }]}>Hallo {result.customer?.first_name}!</Text>
                <Text style={[styles.text, { color: colors.textSecondary, textAlign: 'left' }]}>
                  {result.stamped ? `Stempel vergeben (${result.stamps.filled === 0 ? result.stamps.fields : result.stamps.filled}/${result.stamps.fields}).` : 'Heute schon gestempelt.'}
                  {result.reward_credits > 0 ? ` Karte voll – ${result.reward_credits} Credits gutgeschrieben!` : ''}
                </Text>
              </View>
            </View>
            {result.open_bookings.length === 0 ? (
              <Text style={[styles.text, { color: colors.textSecondary }]}>Keine offene Buchung bei euch.</Text>
            ) : (
              result.open_bookings.map((b) => <BookingLine key={b.id} booking={b} onRedeem={() => redeem(b)} />)
            )}
          </Card>
        ) : null}

        <Text style={[styles.section, { color: colors.text }]}>Offene Buchungen</Text>
        {open.length === 0 ? <Text style={[styles.text, { color: colors.textSecondary }]}>Gerade keine.</Text> : null}
        {open.map((b) => (
          <Card key={b.id}>
            <BookingLine booking={b} onRedeem={() => redeem(b)} />
          </Card>
        ))}

        {done.length > 0 ? <Text style={[styles.section, { color: colors.text }]}>Heute eingelöst</Text> : null}
        {done.map((b) => (
          <Card key={b.id} tone="soft">
            <BookingLine booking={b} />
          </Card>
        ))}
      </ScrollView>
    </View>
  );
}

function BookingLine({ booking, onRedeem }: { booking: Booking; onRedeem?: () => void }) {
  const colors = useTheme();
  return (
    <View style={styles.line}>
      <Icon name="ticket" size={20} color={colors.tint} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.lineTitle, { color: colors.text }]}>
          {booking.offer_title} · {booking.people} P.
        </Text>
        <Text style={[styles.lineMeta, { color: colors.textSecondary }]}>
          {booking.customer?.first_name ?? 'Gast'} · {booking.code ?? ''} · {BOOKING_STATUS_LABEL[booking.status]}
          {booking.redeemed_at ? ` ${formatClock(booking.redeemed_at)}` : ''}
          {booking.pay_method === 'credits' ? ' · mit Credits bezahlt' : ' · bezahlt'}
        </Text>
      </View>
      {onRedeem && booking.status === 'confirmed' ? <Button title="Einlösen" size="small" onPress={onRedeem} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  content: { padding: Spacing.three, gap: Spacing.three, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', paddingBottom: Spacing.six },
  partner: { fontFamily: FontFamily.bold, fontSize: 22 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: { borderWidth: Stroke, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 7 },
  chipText: { fontFamily: FontFamily.semibold, fontSize: 14 },
  stats: { flexDirection: 'row', gap: Spacing.two },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { fontFamily: FontFamily.bold, fontSize: 26 },
  statLabel: { fontFamily: FontFamily.medium, fontSize: 12.5 },
  camera: { width: '100%', aspectRatio: 1, maxHeight: 420, borderWidth: Stroke, borderRadius: Radius.panel, overflow: 'hidden', backgroundColor: '#0c0418' },
  frame: { position: 'absolute', top: '18%', left: '18%', right: '18%', bottom: '18%', borderWidth: 3, borderColor: 'rgba(255,255,255,0.85)', borderRadius: 18 },
  result: { gap: Spacing.three },
  resultHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  resultTitle: { fontFamily: FontFamily.bold, fontSize: 20 },
  text: { fontFamily: FontFamily.medium, fontSize: 14, textAlign: 'center' },
  section: { fontFamily: FontFamily.bold, fontSize: 17, marginTop: Spacing.two },
  line: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  lineTitle: { fontFamily: FontFamily.bold, fontSize: 15 },
  lineMeta: { fontFamily: FontFamily.medium, fontSize: 12.5 },
});
