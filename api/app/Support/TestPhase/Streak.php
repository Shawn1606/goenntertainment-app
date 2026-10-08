<?php

namespace App\Support\TestPhase;

use App\Models\User;
use App\Support\BusinessDay;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\DB;

/**
 * Check-in-Serie: Wochen in Folge mit mindestens einem Besuch (Kalenderwoche,
 * Montag bis Sonntag).
 *
 * Die laufende Woche zaehlt mit, sobald sie einen Besuch hat. Hat sie noch
 * keinen, laeuft die Serie trotzdem weiter - sie ist nur „in Gefahr", bis
 * diese Woche jemand eincheckt.
 *
 * Platinum hat einen Joker: Eine Woche ohne Besuch darf in der Serie fehlen.
 * Meilensteine (MILESTONES) bringen Credits; abgeholt wird je Serie einmal
 * (Zeitraum = erste Woche der Serie), eine neue Serie kann sie neu verdienen.
 */
final class Streak
{
    /** Wochen => Credits */
    public const MILESTONES = [4 => 50, 8 => 100, 12 => 200];

    private const LOOKBACK_WEEKS = 60;

    /**
     * @return array{weeks: int, active_this_week: bool, at_risk: bool, joker: bool, joker_used: bool, start_week: string|null}
     */
    public static function state(User $user, CarbonInterface $now): array
    {
        // Kalenderwochen in Ortszeit: Sonntag 23:30 Uhr in Goettingen gehoert noch zur alten Woche.
        $now = BusinessDay::local($now);
        $since = $now->copy()->startOfWeek()->subWeeks(self::LOOKBACK_WEEKS);
        $active = DB::table('stamps')
            ->where('user_id', $user->getKey())
            ->whereNotNull('partner_id')
            ->where('created_at', '>=', BusinessDay::stored($since))
            ->pluck('created_at')
            ->map(fn ($at) => self::weekKey(BusinessDay::local($at)))
            ->flip()
            ->all();

        $thisWeek = self::weekKey($now);
        $activeNow = isset($active[$thisWeek]);
        $joker = $user->club_plan === 'platinum';
        $jokerLeft = $joker ? 1 : 0;

        $cursor = $activeNow ? $now->copy() : $now->copy()->subWeek();
        $weeks = 0;
        $start = null;

        for ($i = 0; $i < self::LOOKBACK_WEEKS; $i++) {
            $key = self::weekKey($cursor);
            if (isset($active[$key])) {
                $weeks++;
                $start = $key;
                $cursor = $cursor->subWeek();

                continue;
            }
            // Platinum: eine Luecke ueberspringen, wenn davor wieder Besuche waren.
            if ($jokerLeft > 0 && isset($active[self::weekKey($cursor->copy()->subWeek())])) {
                $jokerLeft--;
                $cursor = $cursor->subWeek();

                continue;
            }
            break;
        }

        return [
            'weeks' => $weeks,
            'active_this_week' => $activeNow,
            'at_risk' => $weeks > 0 && ! $activeNow,
            'joker' => $joker,
            'joker_used' => $joker && $jokerLeft === 0 && $weeks > 0,
            'start_week' => $start,
        ];
    }

    /** „2026-W41" - ISO-Jahr und -Woche. */
    public static function weekKey(CarbonInterface $at): string
    {
        return sprintf('%d-W%02d', $at->isoWeekYear(), $at->isoWeek());
    }
}
