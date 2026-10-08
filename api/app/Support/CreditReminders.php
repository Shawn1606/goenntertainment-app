<?php

namespace App\Support;

use App\Mail\CreditsExpiringSoon;
use App\Models\CreditLot;
use App\Models\Offer;
use App\Models\User;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Throwable;

/**
 * Verfall-Erinnerung: 30 und 7 Tage bevor Credits verfallen eine Mail - mit
 * bis zu drei Angeboten, die man mit den Credits noch bezahlen kann.
 *
 * Je Posten wird festgehalten, welche Erinnerung schon raus ist
 * (`reminded_30_at`, `reminded_7_at`), damit der taegliche Lauf
 * (routes/console.php, credits:remind) niemanden zweimal anschreibt. Mehrere
 * Posten eines Kontos, die im selben Fenster liegen, kommen in EINE Mail; als
 * Datum steht der frueheste Verfall darin.
 */
final class CreditReminders
{
    /** Tage vorher => Spalte */
    public const STAGES = [30 => 'reminded_30_at', 7 => 'reminded_7_at'];

    /** Schickt alle faelligen Erinnerungen. Gibt die Zahl der Mails zurueck. */
    public static function sendDue(): int
    {
        $sent = 0;

        foreach (self::STAGES as $days => $column) {
            $lots = CreditLot::where('remaining', '>', 0)
                ->where('expires_at', '>', now())
                ->where('expires_at', '<=', now()->addDays($days))
                ->whereNull($column)
                ->orderBy('expires_at')
                ->get()
                ->groupBy('user_id');

            foreach ($lots as $userId => $userLots) {
                $user = User::find($userId);
                if ($user === null || ! $user->email) {
                    continue;
                }

                $credits = (int) $userLots->sum('remaining');
                $first = $userLots->first()->expires_at;

                try {
                    Mail::to($user->email)->send(new CreditsExpiringSoon(
                        firstName: self::firstName($user),
                        credits: $credits,
                        date: $first->format('d.m.Y'),
                        days: max(1, (int) ceil(now()->diffInHours($first) / 24)),
                        offers: self::offersFor($credits),
                    ));
                    $sent++;
                } catch (Throwable $e) {
                    // Mail kaputt? Dann beim naechsten Lauf erneut - nicht markieren.
                    Log::warning('Verfall-Erinnerung nicht verschickt', ['user' => $userId, 'error' => $e->getMessage()]);

                    continue;
                }

                // Wer schon die 7-Tage-Mail bekommt, braucht die 30-Tage-Mail nicht mehr.
                $update = [$column => now()];
                if ($days === 7) {
                    $update['reminded_30_at'] = now();
                }
                CreditLot::whereKey($userLots->pluck('id'))->update($update);
            }
        }

        return $sent;
    }

    /**
     * Bis zu drei aktive Angebote, die man mit so vielen Credits bezahlen kann -
     * die teuersten zuerst (dann verfaellt am wenigsten).
     *
     * @return list<array{title: string, partner: string, credits: int}>
     */
    public static function offersFor(int $credits): array
    {
        return Offer::with('partner:id,name,is_active')
            ->where('is_active', true)
            ->whereNotNull('price_credits')
            ->where('price_credits', '<=', $credits)
            ->orderByDesc('price_credits')
            ->limit(10)
            ->get()
            ->filter(fn (Offer $o) => $o->partner?->is_active)
            ->take(3)
            ->map(fn (Offer $o) => ['title' => $o->title, 'partner' => $o->partner->name, 'credits' => (int) $o->price_credits])
            ->values()
            ->all();
    }

    private static function firstName(User $user): string
    {
        return trim(explode(' ', (string) $user->name)[0]) ?: 'du';
    }
}
