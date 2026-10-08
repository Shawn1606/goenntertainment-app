<?php

namespace App\Support;

/**
 * Zufalls-Codes, die Menschen abtippen oder vorlesen: Buchungen, Gutscheine,
 * Einladungen.
 *
 * Das Alphabet laesst weg, was man verwechselt - 0/O, 1/I - und kennt nur
 * Grossbuchstaben. Beim Vergleich wird die Eingabe mit `normalize` genauso
 * zurechtgestutzt: klein geschrieben, mit Leerzeichen oder Bindestrichen
 * abgetippt, alles zaehlt.
 */
final class Codes
{
    public const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

    public static function random(int $length): string
    {
        $code = '';
        $max = strlen(self::ALPHABET) - 1;
        for ($i = 0; $i < $length; $i++) {
            $code .= self::ALPHABET[random_int(0, $max)];
        }

        return $code;
    }

    /** Grossbuchstaben, ohne alles ausser Buchstaben und Ziffern. */
    public static function normalize(string $input): string
    {
        $upper = strtoupper($input);

        // Wer 0 statt O oder 1 statt I tippt, meint den Buchstaben - die Ziffern
        // kommen im Alphabet gar nicht vor.
        return strtr(preg_replace('/[^A-Z0-9]/', '', $upper) ?? '', ['0' => 'O', '1' => 'I']);
    }

    /** In Vierergruppen: ABCD-EFGH-JKLM. */
    public static function format(string $code, int $group = 4): string
    {
        return implode('-', str_split($code, $group));
    }

    /**
     * Ein Code, den es in der Tabelle noch nicht gibt. Bei 32^8 Moeglichkeiten
     * trifft der zweite Versuch praktisch nie - die Schleife ist die Absicherung.
     */
    public static function unique(int $length, callable $exists): string
    {
        do {
            $code = self::random($length);
        } while ($exists($code));

        return $code;
    }
}
