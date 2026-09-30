<?php

namespace App\Support;

use DateTimeInterface;

/**
 * Zahlen und Zeiten in der Schreibweise, die die App zeigt - fuer Meldungen,
 * die der Server fertig formuliert (Buchungszeilen, Fehlertexte).
 */
final class Format
{
    /** 2999 -> „29,99 €" */
    public static function euro(int $cents): string
    {
        return number_format($cents / 100, 2, ',', '.').' €';
    }

    /** 1000 -> „1.000" */
    public static function credits(int $credits): string
    {
        return number_format($credits, 0, ',', '.');
    }

    /**
     * Zeitpunkt als ISO 8601 MIT Zeitzone.
     *
     * Die neuen Endpunkte liefern Zeiten so und nicht im alten „Y-m-d H:i:s": In
     * Entwicklung laeuft der Server in Ortszeit, im Container in UTC - ein Datum
     * ohne Zone waere je nach Umgebung eine Stunde daneben.
     */
    public static function iso(?DateTimeInterface $at): ?string
    {
        return $at?->format(DATE_ATOM);
    }
}
