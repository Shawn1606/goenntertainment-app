/** Wie der Zustand einer Buchung heißt – überall gleich (Ticket, Liste, Partner-Modus). */
export const BOOKING_STATUS_LABEL = {
  confirmed: 'Gültig',
  redeemed: 'Eingelöst',
  cancelled: 'Storniert',
  expired: 'Abgelaufen',
} as const;

export type BookingStatusKey = keyof typeof BOOKING_STATUS_LABEL;
