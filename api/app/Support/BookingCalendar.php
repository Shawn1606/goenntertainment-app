<?php

namespace App\Support;

use App\Models\Booking;
use Carbon\CarbonInterface;

/**
 * Kalender-Export einer Buchung (.ics).
 *
 * Der Kalender des Handys oeffnet den Link selbst - ohne den Token der App.
 * Deshalb steht im Link eine Signatur (`sig`), die nur die API kennt und die
 * App ueber die Buchung bekommt. Wer eine andere ID raet, hat keine passende
 * Signatur. Der Einloese-Code steht bewusst NICHT im Kalender: Kalender werden
 * geteilt und synchronisiert, der Code gehoert in die App.
 *
 * Mit Wunschtermin ist der Termin ein ganztaegiger Eintrag an diesem Tag, sonst
 * ein Eintrag am letzten Einloesetag („bis dahin einloesen").
 */
final class BookingCalendar
{
    /** Pfad unter /api, z. B. /bookings/12/calendar.ics?sig=… */
    public static function path(Booking $booking): string
    {
        return '/bookings/'.$booking->getKey().'/calendar.ics?sig='.self::sign($booking->getKey());
    }

    public static function verify(int $bookingId, string $signature): bool
    {
        return hash_equals(self::sign($bookingId), $signature);
    }

    public static function ics(Booking $booking): string
    {
        $partner = $booking->partner;
        $day = $booking->preferred_date ?? $booking->valid_until;
        $summary = $booking->preferred_date
            ? "{$booking->offer_title} bei {$booking->partner_name}"
            : "Letzter Tag: {$booking->offer_title} bei {$booking->partner_name} einlösen";
        $location = trim(implode(', ', array_filter([$partner?->address, $partner?->city])));
        $description = implode("\n", array_filter([
            "Gebucht über GÖ4Fun · {$booking->people} ".($booking->people === 1 ? 'Person' : 'Personen'),
            $booking->preferred_date ? 'Einlösbar bis '.$booking->valid_until?->format('d.m.Y') : null,
            'Den Einlöse-Code findest du in der App unter Tickets.',
        ]));

        $lines = [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//GOE4Fun//Buchung//DE',
            'CALSCALE:GREGORIAN',
            'METHOD:PUBLISH',
            'BEGIN:VEVENT',
            'UID:booking-'.$booking->getKey().'@goe4fun',
            'DTSTAMP:'.now()->utc()->format('Ymd\THis\Z'),
            'DTSTART;VALUE=DATE:'.self::day($day),
            'DTEND;VALUE=DATE:'.self::day($day->copy()->addDay()),
            'SUMMARY:'.self::escape($summary),
            'DESCRIPTION:'.self::escape($description),
        ];
        if ($location !== '') {
            $lines[] = 'LOCATION:'.self::escape($location);
        }
        if ($partner?->lat !== null && $partner?->lng !== null) {
            $lines[] = 'GEO:'.$partner->lat.';'.$partner->lng;
        }
        array_push(
            $lines,
            'BEGIN:VALARM',
            'ACTION:DISPLAY',
            'DESCRIPTION:'.self::escape($summary),
            'TRIGGER:-P1D',
            'END:VALARM',
            'END:VEVENT',
            'END:VCALENDAR',
        );

        return implode("\r\n", array_map([self::class, 'fold'], $lines))."\r\n";
    }

    private static function sign(int $bookingId): string
    {
        return substr(hash_hmac('sha256', 'ics|'.$bookingId, (string) config('app.key')), 0, 24);
    }

    private static function day(CarbonInterface $at): string
    {
        return $at->format('Ymd');
    }

    /** RFC 5545: Backslash, Semikolon, Komma und Zeilenumbrueche maskieren. */
    private static function escape(string $text): string
    {
        return str_replace(['\\', ';', ',', "\r\n", "\n"], ['\\\\', '\\;', '\\,', '\\n', '\\n'], $text);
    }

    /** Zeilen ueber 75 Bytes umbrechen (Fortsetzung beginnt mit Leerzeichen). */
    private static function fold(string $line): string
    {
        if (strlen($line) <= 75) {
            return $line;
        }
        $out = '';
        $current = '';
        foreach (mb_str_split($line) as $char) {
            if (strlen($current.$char) > 74) {
                $out .= $current."\r\n ";
                $current = '';
            }
            $current .= $char;
        }

        return $out.$current;
    }
}
