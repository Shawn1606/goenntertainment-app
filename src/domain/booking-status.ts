/** Wie der Zustand einer Buchung heißt – überall gleich (Ticket, Liste, Partner-Modus). */
export const BOOKING_STATUS_LABEL = {
  confirmed: 'Gültig',
  redeemed: 'Eingelöst',
  cancelled: 'Storniert',
  expired: 'Abgelaufen',
} as const;

export type BookingStatusKey = keyof typeof BOOKING_STATUS_LABEL;

/**
 * Wie dringend ein Ticket abläuft.
 *
 *  - `over`   – das Datum ist vorbei,
 *  - `urgent` – höchstens 7 Tage (rot/bernstein, gehört nach oben),
 *  - `soon`   – höchstens 30 Tage,
 *  - `ok`     – mehr Zeit.
 */
export type ExpiryTone = 'ok' | 'soon' | 'urgent' | 'over';

export type ExpiryInfo = {
  /** Ganze Kalendertage bis zum letzten gültigen Tag (0 = heute ist der letzte Tag). */
  days: number;
  tone: ExpiryTone;
  /** Fertiger Satz für das Ticket: „Verfällt morgen", „Noch 23 Tage gültig". */
  label: string;
};

const DAY_MS = 86_400_000;

/** Mitternacht des Ortsdatums – damit „morgen" auch um 23 Uhr noch morgen ist. */
function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Ablauf eines Tickets bezogen auf `now`. `null`, wenn das Datum fehlt oder kaputt ist. */
export function expiryInfo(validUntil: string | null | undefined, now: Date): ExpiryInfo | null {
  if (!validUntil) return null;
  const end = new Date(validUntil);
  if (Number.isNaN(end.getTime())) return null;
  const days = Math.round((startOfDay(end) - startOfDay(now)) / DAY_MS);

  if (days < 0) return { days, tone: 'over', label: 'Abgelaufen' };
  if (days === 0) return { days, tone: 'urgent', label: 'Verfällt heute' };
  if (days === 1) return { days, tone: 'urgent', label: 'Verfällt morgen' };
  if (days <= 7) return { days, tone: 'urgent', label: `Verfällt in ${days} Tagen` };
  return { days, tone: days <= 30 ? 'soon' : 'ok', label: `Noch ${days} Tage gültig` };
}

/** Die offene Buchung, die als nächste abläuft – oder `null`. */
export function nextExpiring<T extends { status: string; valid_until: string; offer_title: string }>(
  bookings: readonly T[],
  now: Date,
): { booking: T; info: ExpiryInfo } | null {
  let best: { booking: T; info: ExpiryInfo } | null = null;
  for (const booking of bookings) {
    if (booking.status !== 'confirmed') continue;
    const info = expiryInfo(booking.valid_until, now);
    if (!info || info.tone === 'over') continue;
    if (!best || info.days < best.info.days) best = { booking, info };
  }
  return best;
}
