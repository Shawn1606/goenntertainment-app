<?php

namespace App\Support;

use App\Models\User;
use App\Support\TestPhase\TestPhase;
use Carbon\CarbonInterface;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Abzeichen: kleine Meilensteine, die man mit Datum im Konto sammelt.
 *
 * Nichts davon wird gespeichert - jedes Abzeichen wird aus dem gerechnet, was es
 * ohnehin gibt (Stempel, Buchungen, Kontobewegungen, Club). Das Datum ist der
 * Moment, in dem die Bedingung erfuellt wurde, z. B. der zehnte Stempel. So
 * bekommen auch alte Konten ihre Abzeichen rueckwirkend, und nichts laeuft
 * auseinander.
 *
 * Besuche = Stempel mit Partner (von Hand gutgeschriebene zaehlen fuer die
 * Stempelkarte, aber nicht als Besuch).
 */
final class Badges
{
    /**
     * @return list<array{key: string, title: string, description: string, icon: string, earned: bool, earned_at: string|null, progress: array{current: int, target: int}|null}>
     */
    public static function forUser(User $user): array
    {
        $uid = $user->getKey();

        $visits = DB::table('stamps')->where('user_id', $uid)->whereNotNull('partner_id')->orderBy('created_at')->orderBy('id')->pluck('created_at')->all();
        $allStamps = DB::table('stamps')->where('user_id', $uid)->orderBy('id')->pluck('created_at')->all();
        $firstPerPartner = DB::table('stamps')->where('user_id', $uid)->whereNotNull('partner_id')
            ->groupBy('partner_id')->selectRaw('MIN(created_at) as at')->pluck('at')->sort()->values()->all();
        $firstPerCategory = DB::table('stamps')->join('partners', 'partners.id', '=', 'stamps.partner_id')
            ->where('stamps.user_id', $uid)->whereNotNull('partners.interest_id')
            ->groupBy('partners.interest_id')->selectRaw('MIN(stamps.created_at) as at')->pluck('at')->sort()->values()->all();
        $bookings = DB::table('bookings')->where('user_id', $uid)->where('status', '!=', 'cancelled');

        $nth = fn (array $dates, int $n) => isset($dates[$n - 1]) ? $dates[$n - 1] : null;

        $badges = [
            self::badge('first_visit', 'Erster Stempel', 'Zum ersten Mal bei einem Partner eingecheckt.', 'stamp', $nth($visits, 1), count($visits), 1),
            self::badge('first_booking', 'Erste Buchung', 'Das erste Angebot gebucht.', 'ticket', (clone $bookings)->min('created_at'), null, null),
            self::badge('full_card', 'Karte voll', 'Die erste Stempelkarte gefüllt.', 'gift', $nth($allStamps, Club::stampFields()), count($allStamps), Club::stampFields()),
            self::badge('golden_card', 'Goldene Karte', 'Fünf Stempelkarten gefüllt – die fünfte ist golden.', 'crown', $nth($allStamps, Club::stampFields() * 5), count($allStamps), Club::stampFields() * 5),
            self::badge('partners_5', 'Entdecker:in', 'Fünf verschiedene Partner besucht.', 'map-pin', $nth($firstPerPartner, 5), count($firstPerPartner), 5),
            self::badge('partners_10', 'Stadtkenner:in', 'Zehn verschiedene Partner besucht.', 'building', $nth($firstPerPartner, 10), count($firstPerPartner), 10),
            self::badge('categories_3', 'Vielseitig', 'Partner aus drei verschiedenen Kategorien besucht.', 'sparkles', $nth($firstPerCategory, 3), count($firstPerCategory), 3),
            self::badge('visits_25', 'Stammgast', '25 Besuche bei Partnern.', 'star', $nth($visits, 25), count($visits), 25),
            self::badge('visits_100', 'Legende', '100 Besuche bei Partnern.', 'trophy', $nth($visits, 100), count($visits), 100),
            self::badge('group_booking', 'Gemeinsam unterwegs', 'Zum ersten Mal mit einer Gruppe gebucht.', 'users', (clone $bookings)->whereNotNull('group_id')->min('created_at'), null, null),
            self::badge('voucher', 'Gutschein eingelöst', 'Eine GÖ4Fun-Gutscheinkarte eingelöst.', 'ticket', DB::table('credit_transactions')->where('user_id', $uid)->where('kind', 'voucher')->min('created_at'), null, null),
            self::badge('club', 'Club-Mitglied', 'Gold oder Platinum abgeschlossen.', 'crown', $user->club_since, null, null),
            self::badge('one_year', 'Ein Jahr dabei', 'Seit einem Jahr bei GÖ4Fun.', 'calendar', $user->created_at && $user->created_at->copy()->addYear()->isPast() ? $user->created_at->copy()->addYear() : null, null, null),
        ];

        // Testphase: Abzeichen fuer die erste abgeholte Challenge-Belohnung.
        if (TestPhase::enabledFor($user)) {
            $badges[] = self::badge('challenge', 'Challenge-Champion', 'Die erste Belohnung aus Challenge, Bingo oder Serie abgeholt (Testphase).', 'flame', DB::table('testphase_claims')->where('user_id', $uid)->min('created_at'), null, null);
        }

        // Verdiente zuerst (neueste oben), dann die offenen in fester Reihenfolge.
        $earned = array_values(array_filter($badges, fn ($b) => $b['earned']));
        usort($earned, fn ($a, $b) => strcmp((string) $b['earned_at'], (string) $a['earned_at']));

        return array_merge($earned, array_values(array_filter($badges, fn ($b) => ! $b['earned'])));
    }

    /**
     * @return array{key: string, title: string, description: string, icon: string, earned: bool, earned_at: string|null, progress: array{current: int, target: int}|null}
     */
    private static function badge(string $key, string $title, string $description, string $icon, mixed $at, ?int $current, ?int $target): array
    {
        $earnedAt = $at === null ? null : ($at instanceof CarbonInterface ? $at : Carbon::parse($at));

        return [
            'key' => $key,
            'title' => $title,
            'description' => $description,
            'icon' => $icon,
            'earned' => $earnedAt !== null,
            'earned_at' => Format::iso($earnedAt),
            'progress' => $target === null ? null : ['current' => min($current ?? 0, $target), 'target' => $target],
        ];
    }
}
