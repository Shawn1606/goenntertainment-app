/**
 * Wann ist das Event? – als ein Stück Text, wie es auf einer Feed-Karte steht.
 *
 *   heute       → „Heute, 18:00"
 *   morgen      → „Morgen, 18:00"
 *   diese Woche → „Sa., 18:00"
 *   später      → „Sa., 12.10., 18:00"
 *   Dauerangebot→ „Jederzeit"
 *
 * ## Warum relativ
 *
 * „12.10.2026, 18:00" zwingt zum Rechnen: Welcher Tag ist das, ist das diese
 * Woche? Instagram und TikTok schreiben deshalb „vor 2 Std." statt eines Datums.
 * Für die Zukunft ist „Heute" und „Morgen" die Antwort auf die Frage, mit der man
 * durch einen Feed scrollt: Kann ich da hin?
 *
 * Von Hand formatiert statt `Intl` – auf Hermes fehlen je nach Build die
 * Sprachdaten (siehe date-format.ts).
 */

const WEEKDAYS = ['So.', 'Mo.', 'Di.', 'Mi.', 'Do.', 'Fr.', 'Sa.'];
const DAY_MS = 24 * 60 * 60 * 1000;

const pad = (n: number) => String(n).padStart(2, '0');

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function formatEventWhen(
  startsAt: string | null | undefined,
  now: Date,
  options: { permanent?: boolean } = {},
): string {
  if (options.permanent) return 'Jederzeit';
  if (!startsAt) return '';
  const date = new Date(startsAt);
  if (Number.isNaN(date.getTime())) return '';

  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  // Über den Tagesbeginn gerechnet, damit 23:59 heute und 00:01 morgen nicht
  // als „selber Tag" durchgehen, nur weil sie zwei Minuten auseinander liegen.
  const days = Math.round((startOfDay(date) - startOfDay(now)) / DAY_MS);

  if (days === 0) return `Heute, ${clock}`;
  if (days === 1) return `Morgen, ${clock}`;
  if (days === -1) return `Gestern, ${clock}`;
  if (days > 1 && days < 7) return `${WEEKDAYS[date.getDay()]}, ${clock}`;

  const day = `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.`;
  const year = date.getFullYear() !== now.getFullYear() ? String(date.getFullYear()) : '';
  return `${WEEKDAYS[date.getDay()]}, ${day}${year}, ${clock}`;
}
