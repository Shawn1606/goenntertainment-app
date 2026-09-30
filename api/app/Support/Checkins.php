<?php

namespace App\Support;

use App\Models\Checkin;
use App\Models\Partner;
use App\Models\Stamp;
use App\Models\User;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;

/**
 * Ein Besuch beim Partner - und was er bringt: einen Stempel, alle zehn Stempel
 * 100 Credits.
 *
 * ## Zwei Wege, ein Ergebnis
 *
 *  - Der Kunde haelt sein Handy an den NFC-Aufkleber an der Kasse oder scannt
 *    dessen QR-Code (`nfc`/`qr`, CheckinController).
 *  - Der Partner scannt den Pass des Kunden in der App (`pass`,
 *    PartnerStaffController).
 *
 * Beide landen hier. Welcher Weg sich im Alltag durchsetzt, ist noch offen -
 * darum gibt es beide, und keiner weiss etwas vom anderen.
 *
 * ## Die Regeln
 *
 * Hoechstens ein Stempel pro Partner und Kalendertag (shared/club.json,
 * `perPartnerPerDay`). Der Besuch selbst wird trotzdem jedes Mal festgehalten.
 * Die Datenbank sichert die Regel zusaetzlich mit einem eindeutigen Schluessel ab:
 * Zwei Scans in derselben Sekunde koennen nicht beide stempeln.
 *
 * Ist die Karte voll, gibt es die Credits SOFORT und die neue Karte beginnt -
 * „10 von 10, bitte abholen" waere ein Schritt, den man vergessen kann.
 */
final class Checkins
{
    /**
     * @return array{checkin: Checkin, stamped: bool, reward_credits: int, total_stamps: int}
     */
    public static function record(User $user, Partner $partner, string $method, ?User $staff = null): array
    {
        return DB::transaction(function () use ($user, $partner, $method, $staff) {
            $checkin = Checkin::create([
                'user_id' => $user->getKey(),
                'partner_id' => $partner->getKey(),
                'method' => $method,
                'staff_user_id' => $staff?->getKey(),
                'stamped' => false,
            ]);

            $day = now()->toDateString();
            $stamped = false;

            $already = Stamp::where('user_id', $user->getKey())
                ->where('partner_id', $partner->getKey())
                ->where('stamp_day', $day)
                ->exists();

            if (! $already) {
                try {
                    // Eigener Sicherungspunkt: Scheitert nur dieser INSERT am
                    // Schluessel, bleibt der Besuch trotzdem gespeichert.
                    DB::transaction(fn () => Stamp::create([
                        'user_id' => $user->getKey(),
                        'partner_id' => $partner->getKey(),
                        'checkin_id' => $checkin->getKey(),
                        'stamp_day' => $day,
                    ]));
                    $stamped = true;
                } catch (UniqueConstraintViolationException) {
                    $stamped = false;
                }
            }

            $total = Stamp::where('user_id', $user->getKey())->count();
            $reward = 0;

            if ($stamped) {
                $checkin->update(['stamped' => true]);

                if ($total % Club::stampFields() === 0) {
                    $reward = Club::stampRewardCredits();
                    Wallet::credit($user, $reward, 'stamp_reward', 'Stempelkarte voll – '.Format::credits($reward).' Credits geschenkt');
                }
            }

            return [
                'checkin' => $checkin,
                'stamped' => $stamped,
                'reward_credits' => $reward,
                'total_stamps' => $total,
            ];
        });
    }

    /**
     * Entfernung zwischen zwei Punkten in Metern (Haversine). Genau genug fuer
     * „steht die Person im Laden oder zu Hause".
     */
    public static function distanceMeters(float $lat1, float $lng1, float $lat2, float $lng2): float
    {
        $r = 6371000.0;
        $dLat = deg2rad($lat2 - $lat1);
        $dLng = deg2rad($lng2 - $lng1);
        $a = sin($dLat / 2) ** 2 + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLng / 2) ** 2;

        return 2 * $r * asin(min(1.0, sqrt($a)));
    }

    /** Stempelkarte eines Kontos, wie die App sie zeigt. */
    public static function card(User $user): array
    {
        $total = Stamp::where('user_id', $user->getKey())->count();
        $progress = Club::stampProgress($total);

        // Die Stempel der LAUFENDEN Karte: die juengsten `filled` Stueck.
        $current = $progress['filled'] === 0 ? collect() : Stamp::with('partner:id,name,logo_path')
            ->where('user_id', $user->getKey())
            ->orderByDesc('id')
            ->limit($progress['filled'])
            ->get()
            ->reverse()
            ->values();

        return [
            'total' => $total,
            'filled' => $progress['filled'],
            'fields' => $progress['fields'],
            'completed_cards' => $progress['completedCards'],
            'remaining' => $progress['remaining'],
            'reward_credits' => Club::stampRewardCredits(),
            'stamps' => $current->map(fn (Stamp $s) => [
                'id' => $s->id,
                'day' => $s->stamp_day?->format('Y-m-d'),
                'created_at' => Format::iso($s->created_at),
                'partner' => $s->partner ? [
                    'id' => $s->partner->id,
                    'name' => $s->partner->name,
                    'logo_url' => Media::url($s->partner->logo_path),
                ] : null,
            ])->all(),
        ];
    }
}
