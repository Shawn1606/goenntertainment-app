<?php

namespace App\Support;

/**
 * Punkte-Logik der Server-Seite.
 *
 * Die Gewichte stehen NUR hier. Sowohl die Berechnung in PHP (fuer
 * /api/me/progress) als auch die SQL-Sortierung des Leaderboards leiten sich
 * daraus ab - damit Anzeige und Rangfolge nicht auseinanderlaufen koennen.
 *
 * Die App zeigt Level, Titel und Abzeichen aus denselben Kennzahlen an; die
 * Regeln dafuer liegen in src/domain/gamification.ts (dort auch getestet).
 * Aendert sich ein Gewicht, muss es an beiden Stellen angepasst werden.
 */
class Gamification
{
    public const PER_HOSTED = 50;

    public const PER_JOINED = 20;

    public const PER_DISTINCT_INTEREST = 10;

    /** Kennzahlen eines Kontos, alle auf 0. */
    public static function emptyStats(): array
    {
        return ['hosted' => 0, 'joined' => 0, 'distinctInterests' => 0];
    }

    /** Robuste Zahl: alles Unsinnige wird zu 0, negative Werte werden gekappt. */
    private static function count(mixed $value): int
    {
        $n = is_numeric($value) ? (float) $value : 0.0;

        return ($n > 0 && is_finite($n)) ? (int) floor($n) : 0;
    }

    /** Gesamt-XP aus den Kennzahlen. */
    public static function xpFromStats(array $stats): int
    {
        return self::count($stats['hosted'] ?? 0) * self::PER_HOSTED
            + self::count($stats['joined'] ?? 0) * self::PER_JOINED
            + self::count($stats['distinctInterests'] ?? 0) * self::PER_DISTINCT_INTEREST;
    }

    /**
     * Dieselbe Formel als SQL-Ausdruck - fuer ORDER BY im Leaderboard.
     *
     * @param  array{hosted: string, joined: string, distinctInterests: string}  $columns Spalten-/Alias-Namen
     */
    public static function xpSqlExpression(array $columns): string
    {
        return '('.$columns['hosted'].' * '.self::PER_HOSTED
            .' + '.$columns['joined'].' * '.self::PER_JOINED
            .' + '.$columns['distinctInterests'].' * '.self::PER_DISTINCT_INTEREST.')';
    }
}
