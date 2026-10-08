<?php

namespace App\Support;

use Carbon\CarbonInterface;
use Illuminate\Support\Carbon;

/**
 * Geschaeftstage: Ein „Tag" der App ist immer der Tag in Goettingen - egal, in welcher Zeitzone
 * der Server rechnet.
 *
 * ## Warum es diese Klasse gibt
 *
 * Die API rechnet und speichert in `app.timezone`: am Entwicklungs-PC Europe/Berlin, im Container
 * UTC (deploy/docker-compose.yml). Was die App einen Tag nennt - „gueltig bis Ende des Tages",
 * „ein Stempel pro Partner und Tag", „heute oder spaeter", „vor 12 Uhr", „am Wochenende", „diesen
 * Monat" - meint aber den deutschen Kalendertag. Mitternacht UTC ist dort 01:00 bzw. 02:00 Uhr:
 * Mit `now()->endOfDay()` endete eine Buchung im Container um 01:59 Uhr des naechsten Tages,
 * zwischen Mitternacht und zwei Uhr zaehlte ein Stempel noch fuer gestern, und ein Check-in um
 * 12:30 Uhr galt als „vor 12 Uhr".
 *
 * ## Die Regel
 *
 * Tage, Uhrzeiten, Wochentage und Monate werden HIER in Ortszeit bestimmt (`now`, `today`,
 * `local`). Ein Zeitpunkt, der in die Datenbank geht oder mit ihr verglichen wird, geht vorher
 * durch `stored`: Eloquent und der Query Builder schreiben ein Datum in SEINER Zone, ohne
 * umzurechnen - ein Berliner Carbon landete im Container zwei Stunden daneben.
 */
final class BusinessDay
{
    /** Die Zeitzone der Geschaeftstage. Die einzige Stelle, an der sie steht. */
    public const TIMEZONE = 'Europe/Berlin';

    /** Jetzt in Ortszeit - fuer Tag, Uhrzeit, Wochentag, Monat. In Abfragen nur ueber `stored`. */
    public static function now(): Carbon
    {
        return Carbon::now(self::TIMEZONE);
    }

    /** Das heutige Datum in Ortszeit, z. B. „2026-10-08". */
    public static function today(): string
    {
        return self::now()->toDateString();
    }

    /** Beginn des heutigen Tages (Ortszeit) als Zeitpunkt in `app.timezone`. */
    public static function startOfToday(): Carbon
    {
        return self::stored(self::now()->startOfDay());
    }

    /** Ende des Tages in `$days` Tagen (Ortszeit) als Zeitpunkt in `app.timezone`. */
    public static function endOfDayIn(int $days): Carbon
    {
        return self::stored(self::now()->addDays($days)->endOfDay());
    }

    /** Beginn eines Kalendertags (Datum ohne Zeit, z. B. aus einer `date`-Spalte) in Ortszeit. */
    public static function startOf(CarbonInterface|string $day): Carbon
    {
        $date = $day instanceof CarbonInterface ? $day->toDateString() : $day;

        return Carbon::parse($date, self::TIMEZONE)->startOfDay();
    }

    /** Ein Zeitpunkt in Ortszeit - z. B. ein `created_at` aus der Datenbank (steht in `app.timezone`). */
    public static function local(CarbonInterface|string $at): Carbon
    {
        $instant = $at instanceof CarbonInterface ? Carbon::instance($at) : Carbon::parse($at, config('app.timezone'));

        return $instant->setTimezone(self::TIMEZONE);
    }

    /** Ein Zeitpunkt in `app.timezone` - so, wie er in die Datenbank und in Abfragen gehoert. */
    public static function stored(CarbonInterface $at): Carbon
    {
        return Carbon::instance($at)->setTimezone(config('app.timezone'));
    }
}
