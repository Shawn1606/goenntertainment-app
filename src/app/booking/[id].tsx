import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Mascot, MascotError } from '@/components/mascot';
import { PartnerLogo } from '@/components/partner-logo';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { PressableScale } from '@/components/ui/pressable-scale';
import { TextField } from '@/components/ui/text-field';
import { API_URL } from '@/constants/config';
import { FontFamily, MaxContentWidth, Night, Radius, Spacing } from '@/constants/theme';
import { BOOKING_STATUS_LABEL, expiryInfo } from '@/domain/booking-status';
import { formatCredits, formatEuro, formatPercent, planFor } from '@/domain/club';
import { formatDateTime, formatDay } from '@/domain/date-format';
import type { UiIconName } from '@/domain/ui-icon';
import { useTheme } from '@/hooks/use-theme';
import { api, errorMessage, type Booking } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { CLUB_RULES } from '@/lib/club-rules';
import { confirmAction, notifyUser } from '@/lib/confirm';
import * as feedback from '@/lib/feedback';
import { useMarket } from '@/lib/market-context';
import { loadOfflineBookings } from '@/lib/offline-cache';
import { openRoute } from '@/lib/open-maps';

/**
 * Das Ticket einer Buchung.
 *
 * Einlösen geht auf zwei Wegen – wie beim Stempel: Handy an den Aufkleber
 * halten (dann ist man auch gleich eingecheckt) oder den Pass zeigen, den der
 * Partner scannt. Der Code steht groß da, falls beides nicht klappt.
 *
 * Auf dem Ticket steht, was man vor Ort wissen muss: Code, Personen, wann
 * gekauft – und vor allem, WANN ES VERFÄLLT: als eigenes, farbiges Band mit den
 * Tagen bis dahin (rot ab 7 Tagen, bernstein ab 30). Darunter in drei
 * Schritten, wie man einlöst.
 *
 * Offline-Pass: Ohne Netz zeigt die Seite die zuletzt gespeicherte Kopie der
 * Buchung (src/lib/offline-cache.ts) – Code und Frist reichen zum Einlösen.
 * „In den Kalender" öffnet eine .ics-Datei der API, die der Kalender des Handys
 * selbst lädt. In der Testphase (nur Admins) gibt es nach dem Einlösen eine
 * private Rückmeldung an den Partner, die Credits bringt.
 */
export default function BookingScreen() {
  const { id, fresh } = useLocalSearchParams<{ id: string; fresh?: string }>();
  const router = useRouter();
  const colors = useTheme();
  const { token, user } = useAuth();
  const market = useMarket();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Ohne Netz: Stand der gespeicherten Kopie. */
  const [offlineSince, setOfflineSince] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    api
      .booking(token, Number(id))
      .then(({ data }) => {
        setBooking(data);
        setOfflineSince(null);
      })
      .catch(async (e) => {
        // Offline-Pass: die zuletzt gespeicherte Kopie (oder was die Liste schon hat).
        const fromList = market.bookings.find((b) => b.id === Number(id));
        const cached = await loadOfflineBookings();
        const copy = fromList ?? cached?.bookings.find((b) => b.id === Number(id)) ?? null;
        if (copy) {
          setBooking(copy);
          setOfflineSince(cached?.savedAt ?? new Date().toISOString());
        } else {
          setError(errorMessage(e, 'Diese Buchung konnten wir nicht laden.'));
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  const expiry = open ? expiryInfo(booking.valid_until, new Date()) : null;
  const band =
    expiry?.tone === 'urgent'
      ? { bg: '#e11d48', fg: '#ffffff', sub: 'rgba(255,255,255,0.85)' }
      : expiry?.tone === 'soon'
        ? { bg: '#f59e0b', fg: '#3b2600', sub: 'rgba(59,38,0,0.75)' }
        : { bg: 'rgba(37,244,238,0.16)', fg: '#25f4ee', sub: 'rgba(255,255,255,0.75)' };
  const where = [booking.partner?.address, booking.partner?.city].filter(Boolean).join(', ');
  const paid = booking.pay_method === 'money' ? formatEuro(booking.total_cents) : `${formatCredits(booking.total_credits)} Credits`;

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

  const addToCalendar = async () => {
    if (!booking.calendar_path) return;
    const url = `${API_URL}${booking.calendar_path}`;
    try {
      await Linking.openURL(url);
    } catch {
      await notifyUser('Kalender ließ sich nicht öffnen', url);
    }
  };

  return (
    <View style={[styles.flex, { backgroundColor: colors.backgroundElement }]}>
      <Stack.Screen options={{ headerShown: true, title: 'Dein Ticket' }} />
      <ScrollView contentContainerStyle={styles.content}>
        {offlineSince ? (
          <Card tone="soft" style={styles.offline}>
            <Icon name="clock" size={18} color={colors.textSecondary} />
            <Text style={[styles.offlineText, { color: colors.textSecondary }]}>
              Offline – gespeicherter Stand vom {formatDateTime(offlineSince)}. Code und Frist gelten trotzdem.
            </Text>
          </Card>
        ) : null}
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

          {/* Das Wichtigste nach dem Code: wann es verfällt. */}
          {open && expiry ? (
            <View style={[styles.expiry, { backgroundColor: band.bg }]} accessible accessibilityLabel={`${expiry.label}, gültig bis ${formatDay(booking.valid_until)}`}>
              <Icon name="hourglass" size={22} color={band.fg} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.expiryLabel, { color: band.fg }]}>{expiry.label}</Text>
                <Text style={[styles.expiryDate, { color: band.sub }]}>Gültig bis einschließlich {formatDay(booking.valid_until)}</Text>
              </View>
            </View>
          ) : (
            <View style={[styles.expiry, { backgroundColor: 'rgba(255,255,255,0.1)' }]}>
              <Icon name={booking.status === 'redeemed' ? 'check' : 'hourglass'} size={20} color="#ffffff" />
              <Text style={[styles.expiryLabel, { color: '#ffffff' }]}>
                {booking.status === 'redeemed'
                  ? `Eingelöst am ${formatDay(booking.redeemed_at)}`
                  : booking.status === 'cancelled'
                    ? `Storniert am ${formatDay(booking.cancelled_at)}`
                    : `Abgelaufen am ${formatDay(booking.valid_until)}`}
              </Text>
            </View>
          )}

          <View style={styles.facts}>
            <Fact icon="users" label="Personen" value={String(booking.people)} />
            <Fact icon="calendar" label="Wunschtermin" value={booking.preferred_date ? formatDay(booking.preferred_date) : 'Flexibel'} />
            <Fact icon="ticket" label="Gekauft am" value={formatDay(booking.created_at)} />
            <Fact icon="coin" label="Bezahlt" value={paid} />
          </View>
          {where ? (
            <View style={styles.groupRow}>
              <Icon name="map-pin" size={14} color="#ffffff" />
              <Text style={styles.groupText} numberOfLines={2}>
                {where}
              </Text>
            </View>
          ) : null}
          {booking.group ? (
            <View style={styles.groupRow}>
              <Icon name="users" size={14} color="#ffffff" />
              <Text style={styles.groupText}>Gruppe „{booking.group.name}“</Text>
            </View>
          ) : null}
        </View>

        {open ? (
          <Card style={styles.how}>
            <Text style={[styles.receiptTitle, { color: colors.text }]}>So löst du dein Ticket ein</Text>
            <HowStep n={1} icon="map-pin" text={`Geh bis zum ${formatDay(booking.valid_until)} zu ${booking.partner_name}.`} />
            <HowStep n={2} icon="nfc" text="Halte dein Handy an den GÖ4Fun-Aufkleber – oder zeig den Code oben." />
            <HowStep n={3} icon="stamp" text="Fertig! Einen Stempel für deine Stempelkarte gibt’s obendrauf." />
          </Card>
        ) : null}

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

        {booking.status === 'redeemed' && user?.is_admin && !booking.feedback_given && token && !offlineSince ? (
          <FeedbackCard
            partnerName={booking.partner_name}
            onSend={async (rating, comment) => {
              const res = await api.bookingFeedback(token, booking.id, rating, comment);
              setBooking(res.data);
              market.setCredits(res.credits_balance);
              feedback.achieved();
              await notifyUser('Danke!', `Deine Rückmeldung ist bei ${booking.partner_name}. +${formatCredits(res.credits)} Credits.`);
            }}
          />
        ) : null}

        {open && booking.calendar_path && !offlineSince ? (
          <Button title="In den Kalender" icon="calendar" variant="secondary" onPress={addToCalendar} />
        ) : null}

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

/**
 * Testphase: private Rückmeldung an den Partner – Sterne und ein Satz. Nur der
 * Partner und GÖ4Fun sehen sie, nichts davon ist öffentlich.
 */
function FeedbackCard({ partnerName, onSend }: { partnerName: string; onSend: (rating: number, comment: string | null) => Promise<void> }) {
  const colors = useTheme();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    if (rating === 0) return;
    setSending(true);
    setError(null);
    try {
      await onSend(rating, comment.trim() || null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <Card style={styles.feedback}>
      <Text style={[styles.receiptTitle, { color: colors.text }]}>Wie war’s bei {partnerName}?</Text>
      <Text style={[styles.feedbackHint, { color: colors.textSecondary }]}>
        Nur der Partner sieht deine Rückmeldung – dafür gibt’s 10 Credits. (Testphase)
      </Text>
      <View style={styles.stars} accessibilityRole="radiogroup" accessibilityLabel="Bewertung">
        {[1, 2, 3, 4, 5].map((n) => (
          <PressableScale
            key={n}
            onPress={() => setRating(n)}
            haptic="select"
            accessibilityRole="radio"
            accessibilityLabel={`${n} ${n === 1 ? 'Stern' : 'Sterne'}`}
            accessibilityState={{ selected: rating === n }}
            style={styles.star}>
            <Icon name={n <= rating ? 'star-filled' : 'star'} size={30} color={n <= rating ? '#f59e0b' : colors.border} />
          </PressableScale>
        ))}
      </View>
      <TextField label="Was sollen sie wissen? (optional)" value={comment} onChangeText={setComment} multiline maxLength={500} error={error ?? undefined} />
      <Button title="Rückmeldung senden" icon="check" onPress={send} loading={sending} disabled={rating === 0} />
    </Card>
  );
}

function Fact({ icon, label, value }: { icon: UiIconName; label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <View style={styles.factHead}>
        <Icon name={icon} size={12} color={Night.textMuted} />
        <Text style={styles.factLabel}>{label}</Text>
      </View>
      <Text style={styles.factValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function HowStep({ n, icon, text }: { n: number; icon: UiIconName; text: string }) {
  const colors = useTheme();
  return (
    <View style={styles.step}>
      <View style={[styles.stepNo, { backgroundColor: colors.tint }]}>
        <Text style={styles.stepNoText}>{n}</Text>
      </View>
      <Icon name={icon} size={18} color={colors.tint} />
      <Text style={[styles.stepText, { color: colors.text }]}>{text}</Text>
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
  offline: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  offlineText: { flex: 1, fontFamily: FontFamily.medium, fontSize: 13, lineHeight: 18 },
  feedback: { gap: Spacing.two },
  feedbackHint: { fontFamily: FontFamily.medium, fontSize: 13, lineHeight: 18 },
  stars: { flexDirection: 'row', gap: Spacing.one, justifyContent: 'center' },
  star: { padding: 4 },
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
  expiry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    marginTop: Spacing.three,
    marginHorizontal: Spacing.three,
    borderRadius: Radius.field,
    paddingHorizontal: Spacing.three,
    paddingVertical: 12,
  },
  expiryLabel: { fontFamily: FontFamily.bold, fontSize: 18 },
  expiryDate: { fontFamily: FontFamily.semibold, fontSize: 13 },
  facts: { flexDirection: 'row', flexWrap: 'wrap', rowGap: Spacing.three, marginTop: Spacing.three, paddingHorizontal: Spacing.three },
  fact: { width: '50%', gap: 2 },
  factHead: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  factLabel: { color: Night.textMuted, fontFamily: FontFamily.medium, fontSize: 12 },
  factValue: { color: '#ffffff', fontFamily: FontFamily.bold, fontSize: 15 },
  groupRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: Spacing.three },
  groupText: { color: '#ffffff', fontFamily: FontFamily.semibold, fontSize: 13 },
  actions: { gap: Spacing.two },
  how: { gap: Spacing.three },
  step: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  stepNo: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  stepNoText: { color: '#ffffff', fontFamily: FontFamily.bold, fontSize: 12 },
  stepText: { flex: 1, fontFamily: FontFamily.medium, fontSize: 14, lineHeight: 20 },
  receipt: { gap: Spacing.two },
  receiptTitle: { fontFamily: FontFamily.bold, fontSize: 17 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.two },
  rowLabel: { fontFamily: FontFamily.medium, fontSize: 14, flexShrink: 1 },
  rowValue: { fontFamily: FontFamily.semibold, fontSize: 14 },
  strong: { fontFamily: FontFamily.bold, fontSize: 15 },
});
