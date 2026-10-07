<?php

namespace App\Support\TestPhase;

use App\Models\User;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\DB;

/**
 * Treuestufen nach Aktivitaet (Testphase): Bronze, Silber, Gold - nach Besuchen
 * in den letzten 365 Tagen, unabhaengig vom Abo. Wer viel unterwegs ist, wird
 * auch ohne Gold oder Platinum belohnt: Jede Stufe bringt einmal pro
 * Kalenderjahr einen Bonus zum Abholen.
 */
final class Loyalty
{
    /** key => [Name, Besuche, Bonus-Credits] */
    public const LEVELS = [
        'bronze' => ['Bronze', 10, 50],
        'silver' => ['Silber', 25, 100],
        'gold' => ['Gold', 50, 200],
    ];

    /**
     * @return array{visits: int, level: string|null, level_name: string|null, next: array{key: string, name: string, visits: int}|null}
     */
    public static function state(User $user, CarbonInterface $now): array
    {
        $visits = DB::table('stamps')
            ->where('user_id', $user->getKey())
            ->whereNotNull('partner_id')
            ->where('created_at', '>', $now->copy()->subDays(365))
            ->count();

        $level = null;
        $next = null;
        foreach (self::LEVELS as $key => [$name, $needed]) {
            if ($visits >= $needed) {
                $level = $key;
            } elseif ($next === null) {
                $next = ['key' => $key, 'name' => $name, 'visits' => $needed];
            }
        }

        return [
            'visits' => $visits,
            'level' => $level,
            'level_name' => $level ? self::LEVELS[$level][0] : null,
            'next' => $next,
        ];
    }
}
