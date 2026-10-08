<?php

namespace App\Support\TestPhase;

use App\Models\User;
use Carbon\CarbonInterface;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Fortschritt zaehlen - aus dem, was ohnehin gespeichert ist: Stempel (ein
 * Besuch = hoechstens ein Stempel pro Partner und Tag) und Buchungen.
 *
 * Gezaehlt wird immer in einem Zeitfenster [von, bis]. Filter grenzen ein:
 *
 *   partner_id   nur dieser Partner
 *   interest_id  nur Partner/Angebote dieser Kategorie
 *   match_text   Suchwort im Partnernamen (Besuche) bzw. im Angebots- oder
 *                Partnernamen (Buchungen) - „Bowling", „Softdrink"
 *   offer_kind   nur Angebote dieser Art (activity | perk)
 *
 * Stempel ohne Partner (von Hand gutgeschrieben, Erstbesuch-Bonus) zaehlen
 * nicht als Besuch - sie sind kein Besuch.
 */
final class Progress
{
    public const METRICS = ['visits', 'distinct_partners', 'distinct_categories', 'bookings', 'redeemed', 'group_bookings'];

    /**
     * @param  array{partner_id?: int|null, interest_id?: int|null, match_text?: string|null, offer_kind?: string|null}  $filter
     */
    public static function count(User $user, string $metric, CarbonInterface $from, CarbonInterface $to, array $filter = []): int
    {
        return match ($metric) {
            'visits' => self::visits($user, $from, $to, $filter)->count(),
            'distinct_partners' => self::visits($user, $from, $to, $filter)->distinct()->count('stamps.partner_id'),
            'distinct_categories' => self::visits($user, $from, $to, $filter)
                ->whereNotNull('partners.interest_id')
                ->distinct()
                ->count('partners.interest_id'),
            'bookings' => self::bookings($filter)
                ->where('bookings.user_id', $user->getKey())
                ->where('bookings.status', '!=', 'cancelled')
                ->whereBetween('bookings.created_at', [$from, $to])
                ->count(),
            'redeemed' => self::bookings($filter)
                ->where('bookings.user_id', $user->getKey())
                ->where('bookings.status', 'redeemed')
                ->whereBetween('bookings.redeemed_at', [$from, $to])
                ->count(),
            // Jede Buchung einer Gruppe, in der man Mitglied ist - egal, wer gebucht hat.
            'group_bookings' => self::bookings($filter)
                ->whereIn('bookings.group_id', self::groupIds($user))
                ->where('bookings.status', '!=', 'cancelled')
                ->whereBetween('bookings.created_at', [$from, $to])
                ->count(),
            default => 0,
        };
    }

    /** @return list<int> */
    public static function groupIds(User $user): array
    {
        return DB::table('group_members')->where('user_id', $user->getKey())->pluck('group_id')->map(fn ($id) => (int) $id)->all();
    }

    /** Besuche (Stempel mit Partner) im Fenster. */
    public static function visits(User $user, CarbonInterface $from, CarbonInterface $to, array $filter = []): Builder
    {
        $query = DB::table('stamps')
            ->join('partners', 'partners.id', '=', 'stamps.partner_id')
            ->where('stamps.user_id', $user->getKey())
            ->whereBetween('stamps.created_at', [$from, $to]);

        if (! empty($filter['partner_id'])) {
            $query->where('stamps.partner_id', $filter['partner_id']);
        }
        if (! empty($filter['interest_id'])) {
            $query->where('partners.interest_id', $filter['interest_id']);
        }
        if (! empty($filter['match_text'])) {
            $like = '%'.self::escapeLike($filter['match_text']).'%';
            $query->where(fn (Builder $q) => $q->where('partners.name', 'like', $like)->orWhere('partners.tagline', 'like', $like));
        }

        return $query;
    }

    private static function bookings(array $filter): Builder
    {
        $query = DB::table('bookings')
            ->leftJoin('offers', 'offers.id', '=', 'bookings.offer_id')
            ->leftJoin('partners', 'partners.id', '=', 'bookings.partner_id');

        if (! empty($filter['partner_id'])) {
            $query->where('bookings.partner_id', $filter['partner_id']);
        }
        if (! empty($filter['interest_id'])) {
            $id = $filter['interest_id'];
            $query->where(fn (Builder $q) => $q->where('offers.interest_id', $id)->orWhere('partners.interest_id', $id));
        }
        if (! empty($filter['match_text'])) {
            $like = '%'.self::escapeLike($filter['match_text']).'%';
            $query->where(fn (Builder $q) => $q->where('bookings.offer_title', 'like', $like)->orWhere('bookings.partner_name', 'like', $like));
        }
        if (! empty($filter['offer_kind'])) {
            $query->where('offers.kind', $filter['offer_kind']);
        }

        return $query;
    }

    private static function escapeLike(string $text): string
    {
        return str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], trim($text));
    }
}
