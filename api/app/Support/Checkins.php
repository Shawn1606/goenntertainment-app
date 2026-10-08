<?php

namespace App\Support;

use App\Models\Checkin;
use App\Models\Partner;
use App\Models\Stamp;
use App\Models\User;
use App\Support\TestPhase\TestPhase;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;

/**
 * Ein Besuch beim Partner - und was er bringt: einen Stempel, alle zehn Stempel
 * Credits je nach Club-Stufe (Free 100, Gold 125, Platinum 150; jede fuenfte
 * volle Karte ist golden und bringt das 1,5-Fache - shared/club.json).
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
 * `perPartnerPerDay`) - der Tag in Ortszeit (App\Support\BusinessDay). Der
 * Besuch selbst wird trotzdem jedes Mal festgehalten.
 * Die Datenbank sichert die Regel zusaetzlich mit einem eindeutigen Schluessel ab:
 * Zwei Scans in derselben Sekunde koennen nicht beide stempeln.
 *
 * Ist die Karte voll, gibt es die Credits SOFORT und die neue Karte beginnt -
 * „10 von 10, bitte abholen" waere ein Schritt, den man vergessen kann.
 */
final class Checkins
{
    /**
     * @return array{checkin: Checkin, stamped: bool, bonus_stamp: bool, reward_credits: int, total_stamps: int}
     */
    public static function record(User $user, Partner $partner, string $method, ?User $staff = null): array
    {
        return DB::transaction(function () use ($user, $partner, $method, $staff) {
            // Konto sperren: Zwei Scans gleichzeitig zaehlen sonst von derselben
            // Stempelzahl aus und zahlten eine volle Karte doppelt.
            User::whereKey($user->getKey())->lockForUpdate()->value('id');
            $before = Stamp::where('user_id', $user->getKey())->count();

            $checkin = Checkin::create([
                'user_id' => $user->getKey(),
                'partner_id' => $partner->getKey(),
                'method' => $method,
                'staff_user_id' => $staff?->getKey(),
                'stamped' => false,
            ]);

            // Der Kalendertag in Ortszeit: Um 00:30 Uhr ist schon der neue Tag, auch
            // wenn der Server in UTC rechnet (BusinessDay).
            $day = BusinessDay::today();
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

            // Testphase (nur Admins): Erster Besuch bei einem Partner = doppelter
            // Stempel. Der zweite hat keinen Partner, damit der Schluessel
            // Konto/Partner/Tag nicht greift - wie ein Stempel von Hand.
            $bonusStamp = false;
            if ($stamped && TestPhase::enabledFor($user)
                && Stamp::where('user_id', $user->getKey())->where('partner_id', $partner->getKey())->count() === 1) {
                Stamp::create(['user_id' => $user->getKey(), 'partner_id' => null, 'checkin_id' => $checkin->getKey(), 'stamp_day' => $day]);
                $bonusStamp = true;
            }

            $total = Stamp::where('user_id', $user->getKey())->count();
            $reward = 0;

            if ($stamped) {
                $checkin->update(['stamped' => true]);
                $reward = self::payFullCards($user, $before, $total);
            }

            return [
                'checkin' => $checkin,
                'stamped' => $stamped,
                'bonus_stamp' => $bonusStamp,
                'reward_credits' => $reward,
                'total_stamps' => $total,
            ];
        });
    }

    /**
     * Stempel von Hand gutschreiben oder abziehen (Admin: Kulanz, Korrektur).
     *
     * Gutgeschriebene Stempel haben keinen Partner (`partner_id` NULL) - der
     * eindeutige Schluessel Konto/Partner/Tag greift dann nicht, mehrere am
     * selben Tag sind also moeglich. Macht ein Plus eine Karte voll, gibt es die
     * Credits wie beim echten Besuch. Ein Minus nimmt die juengsten Stempel weg,
     * aber keine schon ausgezahlten Credits zurueck - dafuer gibt es die
     * Credit-Korrektur.
     *
     * @return array{changed: int, reward_credits: int}
     */
    public static function adjust(User $user, int $delta): array
    {
        return DB::transaction(function () use ($user, $delta) {
            // Sperrt die Zeile des Kontos: Zwei Korrekturen gleichzeitig zaehlen
            // sonst beide von derselben Ausgangszahl.
            User::whereKey($user->getKey())->lockForUpdate()->value('id');
            $before = Stamp::where('user_id', $user->getKey())->count();

            if ($delta < 0) {
                $ids = Stamp::where('user_id', $user->getKey())->orderByDesc('id')->limit(-$delta)->pluck('id');
                Stamp::whereKey($ids)->delete();

                return ['changed' => -$ids->count(), 'reward_credits' => 0];
            }

            $day = BusinessDay::today();
            for ($i = 0; $i < $delta; $i++) {
                Stamp::create(['user_id' => $user->getKey(), 'partner_id' => null, 'checkin_id' => null, 'stamp_day' => $day]);
            }

            $reward = self::payFullCards($user, $before, $before + $delta);

            return ['changed' => $delta, 'reward_credits' => $reward];
        });
    }

    /**
     * Jede Karte, die zwischen `$before` und `$after` Stempeln voll wurde, auszahlen
     * - mit dem Wert der aktuellen Stufe, goldene Karten mal 1,5. Gibt die
     * ausgezahlten Credits zurueck.
     */
    private static function payFullCards(User $user, int $before, int $after): int
    {
        $fields = Club::stampFields();
        $paid = 0;

        for ($card = intdiv($before, $fields) + 1; $card <= intdiv($after, $fields); $card++) {
            $credits = Club::stampReward($user->club_plan, $card);
            $what = Club::isGoldenCard($card) ? 'Goldene Stempelkarte voll' : 'Stempelkarte voll';
            Wallet::credit($user, $credits, 'stamp_reward', $what.' – '.Format::credits($credits).' Credits geschenkt');
            $paid += $credits;
        }

        return $paid;
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

    /** Wie viele Karten nach der laufenden noch bis zur goldenen (0 = die laufende ist golden). */
    private static function cardsUntilGolden(int $card): int
    {
        $every = max(1, (int) Club::rules()['stampCard']['goldenEvery']);

        return ($every - $card % $every) % $every;
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
            // Was die LAUFENDE Karte bringt, wenn sie voll ist - je Stufe, golden x1,5.
            'reward_credits' => Club::stampReward($user->club_plan, $progress['completedCards'] + 1),
            'golden' => Club::isGoldenCard($progress['completedCards'] + 1),
            'golden_every' => (int) Club::rules()['stampCard']['goldenEvery'],
            'cards_until_golden' => self::cardsUntilGolden($progress['completedCards'] + 1),
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
