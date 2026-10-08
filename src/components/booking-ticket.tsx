/**
 * Eine Buchung als Ticket – in der Ticket-Liste, in der Gruppe, auf der Startseite.
 *
 * Was man auf einen Blick sehen muss, in dieser Reihenfolge:
 *  1. **Was** (Angebot, Partner, Personen) und ob es noch gilt (Status),
 *  2. **wann es verfällt** – farbig, mit Tagen bis dahin („Verfällt in 3 Tagen"),
 *  3. **der Code** zum Vorzeigen,
 *  4. **wann gekauft**.
 *
 * Gestaltet wie ein Eintrittskarten-Abriss (Lochung mit Kerben), damit klar ist:
 * Das ist etwas, das man vorzeigt – nicht bloß ein Listeneintrag.
 */
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { PartnerLogo } from '@/components/partner-logo';
import { Icon } from '@/components/ui/icon';
import { PressableScale } from '@/components/ui/pressable-scale';
import { FontFamily, Radius, Spacing, Stroke } from '@/constants/theme';
import { BOOKING_STATUS_LABEL, expiryInfo, type ExpiryTone } from '@/domain/booking-status';
import { formatCredits, formatEuro } from '@/domain/club';
import { formatDay } from '@/domain/date-format';
import { useSignals, useTheme } from '@/hooks/use-theme';
import { useNow } from '@/hooks/use-now';
import type { Booking } from '@/lib/api';

/** Farben je Dringlichkeit – Bernstein und Rot nur, wenn wirklich etwas abläuft. */
export function useExpiryColors() {
  const colors = useTheme();
  const signals = useSignals();
  return (tone: ExpiryTone) =>
    tone === 'urgent'
      ? { fg: '#e11d48', bg: 'rgba(225,29,72,0.10)', line: 'rgba(225,29,72,0.35)' }
      : tone === 'soon'
        ? { fg: signals.warn, bg: signals.warnBg, line: signals.warnBorder }
        : tone === 'over'
          ? { fg: colors.textSecondary, bg: colors.backgroundSelected, line: colors.border }
          : { fg: '#059669', bg: 'rgba(16,185,129,0.10)', line: 'rgba(16,185,129,0.3)' };
}

export function BookingTicket({ booking, showGroup = true, compact = false }: { booking: Booking; showGroup?: boolean; compact?: boolean }) {
  const colors = useTheme();
  const router = useRouter();
  const tint = useExpiryColors();
  const open = booking.status === 'confirmed';
  const now = useNow();
  const expiry = open ? expiryInfo(booking.valid_until, now) : null;
  const tone = expiry?.tone ?? 'over';
  const look = tint(tone);
  const price = booking.pay_method === 'money' ? formatEuro(booking.total_cents) : `${formatCredits(booking.total_credits)} Credits`;
  const canOpen = booking.code !== null;

  return (
    <PressableScale
      onPress={() => router.push({ pathname: '/booking/[id]', params: { id: String(booking.id) } })}
      disabled={!canOpen}
      scaleTo={0.985}
      accessibilityRole="button"
      accessibilityLabel={`${booking.offer_title} bei ${booking.partner_name}. ${BOOKING_STATUS_LABEL[booking.status]}${expiry ? `, ${expiry.label}` : ''}. Ticket öffnen.`}
      style={[styles.ticket, { backgroundColor: colors.background, borderColor: open ? colors.borderStrong : colors.border }, !open && styles.dim]}>
      {/* Farbiger Streifen links: so dringend ist es. */}
      <View style={[styles.stripe, { backgroundColor: open ? look.fg : colors.border }]} />

      <View style={styles.top}>
        <PartnerLogo name={booking.partner_name} uri={booking.partner?.logo_url} size={compact ? 40 : 46} />
        <View style={styles.topText}>
          <Text style={[styles.title, { color: colors.text }]} numberOfLines={2}>
            {booking.offer_title}
          </Text>
          <Text style={[styles.meta, { color: colors.textSecondary }]} numberOfLines={1}>
            {booking.partner_name} · {booking.people} {booking.people === 1 ? 'Person' : 'Personen'} · {price}
          </Text>
          {showGroup && booking.group ? (
            <View style={styles.groupRow}>
              <Icon name="users" size={12} color={colors.textSecondary} />
              <Text style={[styles.meta, { color: colors.textSecondary }]} numberOfLines={1}>
                {booking.group.name}
                {booking.booked_by ? ` · gebucht von ${booking.booked_by}` : ''}
              </Text>
            </View>
          ) : null}
        </View>
        <View style={[styles.status, { backgroundColor: open ? 'rgba(16,185,129,0.12)' : colors.backgroundSelected }]}>
          <Text style={[styles.statusText, { color: open ? '#059669' : colors.textSecondary }]}>{BOOKING_STATUS_LABEL[booking.status]}</Text>
        </View>
      </View>

      {/* Abriss: Kerben links und rechts, gestrichelte Linie dazwischen. */}
      <View style={styles.perforation}>
        <View style={[styles.notch, styles.notchLeft, { backgroundColor: colors.backgroundElement, borderColor: open ? colors.borderStrong : colors.border }]} />
        <View style={[styles.dashes, { borderColor: colors.border }]} />
        <View style={[styles.notch, styles.notchRight, { backgroundColor: colors.backgroundElement, borderColor: open ? colors.borderStrong : colors.border }]} />
      </View>

      <View style={styles.bottom}>
        {open && expiry ? (
          <View style={[styles.expiry, { backgroundColor: look.bg, borderColor: look.line }]}>
            <Icon name="hourglass" size={15} color={look.fg} />
            <View style={{ flexShrink: 1 }}>
              <Text style={[styles.expiryLabel, { color: look.fg }]}>{expiry.label}</Text>
              <Text style={[styles.expiryDate, { color: look.fg }]}>Verfällt am {formatDay(booking.valid_until)}</Text>
            </View>
          </View>
        ) : (
          <View style={styles.pastInfo}>
            <Text style={[styles.factLabel, { color: colors.textSecondary }]}>
              {booking.status === 'redeemed' ? 'Eingelöst' : booking.status === 'cancelled' ? 'Storniert' : 'Abgelaufen am'}
            </Text>
            <Text style={[styles.factValue, { color: colors.text }]}>
              {formatDay(booking.redeemed_at ?? booking.cancelled_at ?? booking.valid_until)}
            </Text>
          </View>
        )}
        {booking.code ? (
          <View style={styles.codeBox}>
            <Text style={[styles.factLabel, { color: colors.textSecondary }]}>Code</Text>
            <Text style={[styles.code, { color: colors.text }]}>{booking.code}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.foot}>
        <Text style={[styles.footText, { color: colors.textSecondary }]}>
          Gekauft am {formatDay(booking.created_at)}
          {booking.preferred_date ? ` · Wunschtermin ${formatDay(booking.preferred_date)}` : ''}
        </Text>
        {canOpen ? (
          <View style={styles.openHint}>
            <Text style={[styles.openText, { color: colors.tint }]}>Ticket öffnen</Text>
            <Icon name="chevron-right" size={15} color={colors.tint} />
          </View>
        ) : null}
      </View>
    </PressableScale>
  );
}

const NOTCH = 18;

const styles = StyleSheet.create({
  ticket: { borderWidth: Stroke, borderRadius: Radius.card, overflow: 'hidden', paddingVertical: Spacing.three, paddingLeft: Spacing.three + 4 },
  dim: { opacity: 0.72 },
  stripe: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 5 },
  top: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingRight: Spacing.three },
  topText: { flex: 1, gap: 2 },
  title: { fontFamily: FontFamily.bold, fontSize: 16 },
  meta: { fontFamily: FontFamily.medium, fontSize: 12.5, flexShrink: 1 },
  groupRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  status: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3, alignSelf: 'flex-start' },
  statusText: { fontFamily: FontFamily.bold, fontSize: 11.5 },
  perforation: { flexDirection: 'row', alignItems: 'center', marginVertical: Spacing.two + 2, marginLeft: -(Spacing.three + 4) },
  notch: { width: NOTCH, height: NOTCH, borderRadius: NOTCH / 2, borderWidth: Stroke },
  notchLeft: { marginLeft: -NOTCH / 2 },
  notchRight: { marginRight: -NOTCH / 2 },
  dashes: { flex: 1, borderTopWidth: 1.5, borderStyle: 'dashed', marginHorizontal: Spacing.two },
  bottom: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingRight: Spacing.three },
  expiry: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderWidth: 1, borderRadius: Radius.field, paddingHorizontal: Spacing.two + 2, paddingVertical: Spacing.two },
  expiryLabel: { fontFamily: FontFamily.bold, fontSize: 14 },
  expiryDate: { fontFamily: FontFamily.semibold, fontSize: 12 },
  pastInfo: { flex: 1, gap: 1 },
  codeBox: { alignItems: 'flex-end', gap: 1 },
  factLabel: { fontFamily: FontFamily.semibold, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 },
  factValue: { fontFamily: FontFamily.bold, fontSize: 14 },
  code: { fontFamily: FontFamily.bold, fontSize: 16, letterSpacing: 1.5 },
  foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two, marginTop: Spacing.two + 2, paddingRight: Spacing.three },
  footText: { fontFamily: FontFamily.medium, fontSize: 12, flexShrink: 1 },
  openHint: { flexDirection: 'row', alignItems: 'center', gap: 1 },
  openText: { fontFamily: FontFamily.bold, fontSize: 12.5 },
});
