<?php

namespace App\Support;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Die Club-Stufe eines Kontos: abschliessen, kuendigen, verlaengern.
 *
 * Ein Abo laeuft einen Monat und verlaengert sich von selbst (`renewDue`, taeglich
 * per Zeitplan, routes/console.php). Mit jeder Laufzeit kommen die Monats-Credits
 * der Stufe aufs Konto. Gekuendigt wird zum Ende der Laufzeit - bis dahin bleibt
 * alles, was bezahlt ist.
 *
 * Ein Wechsel zwischen Gold und Platinum ist ein neuer Abschluss: sofort, mit
 * neuer Laufzeit und den Credits der neuen Stufe. Das haelt die Rechnung
 * durchschaubar, auch wenn es nicht auf den Tag anteilig ist.
 */
final class ClubMembership
{
    public static function subscribe(User $user, string $planKey): User
    {
        if (! Club::isPaidPlan($planKey)) {
            throw ValidationException::withMessages(['plan' => ['Diese Stufe gibt es nicht.']]);
        }

        $plan = Club::plan($planKey);
        if ($user->club_plan === $planKey && ! $user->club_cancel_at_period_end) {
            throw ValidationException::withMessages(['plan' => ["Du bist schon im {$plan['name']}."]]);
        }

        // Gekuendigt, aber noch in der Laufzeit, und dieselbe Stufe gewaehlt: nur
        // die Kuendigung zuruecknehmen. Ein zweites Mal bezahlen waere falsch.
        if ($user->club_plan === $planKey && $user->club_cancel_at_period_end) {
            $user->forceFill(['club_cancel_at_period_end' => false])->save();

            return $user;
        }

        return DB::transaction(function () use ($user, $plan) {
            $payment = Payments::charge($user, 'plan', $plan['priceCents'], "{$plan['name']} – 1 Monat");

            $user->forceFill([
                'club_plan' => $plan['key'],
                'club_since' => $user->club_plan === 'free' || $user->club_since === null ? now() : $user->club_since,
                'club_renews_at' => now()->addMonth(),
                'club_cancel_at_period_end' => false,
            ])->save();

            self::grantMonthlyCredits($user, $plan, $payment->getKey());

            return $user;
        });
    }

    public static function cancel(User $user): User
    {
        if (! Club::isPaidPlan($user->club_plan)) {
            throw ValidationException::withMessages(['plan' => ['Du bist im Free Plan – da gibt es nichts zu kündigen.']]);
        }

        $user->forceFill(['club_cancel_at_period_end' => true])->save();

        return $user;
    }

    /**
     * Faellige Abos verlaengern bzw. auslaufen lassen. Gibt die Zahl der
     * bearbeiteten Konten zurueck.
     */
    public static function renewDue(): int
    {
        $count = 0;

        User::whereIn('club_plan', array_values(array_filter(Club::planKeys(), fn ($k) => Club::isPaidPlan($k))))
            ->whereNotNull('club_renews_at')
            ->where('club_renews_at', '<=', now())
            ->chunkById(100, function ($users) use (&$count) {
                foreach ($users as $user) {
                    self::renewOne($user);
                    $count++;
                }
            });

        return $count;
    }

    private static function renewOne(User $user): void
    {
        if ($user->club_cancel_at_period_end || ! Payments::enabled()) {
            $user->forceFill([
                'club_plan' => 'free',
                'club_renews_at' => null,
                'club_cancel_at_period_end' => false,
            ])->save();

            return;
        }

        DB::transaction(function () use ($user) {
            $plan = Club::plan($user->club_plan);
            $payment = Payments::charge($user, 'plan', $plan['priceCents'], "{$plan['name']} – Verlängerung");
            $user->forceFill(['club_renews_at' => $user->club_renews_at->copy()->addMonth()])->save();
            self::grantMonthlyCredits($user, $plan, $payment->getKey());
        });
    }

    private static function grantMonthlyCredits(User $user, array $plan, int $paymentId): void
    {
        $credits = (int) ($plan['monthlyCredits'] ?? 0);
        if ($credits > 0) {
            Wallet::credit($user, $credits, 'monthly', "{$plan['name']}: {$credits} Monats-Credits", ['payment_id' => $paymentId]);
        }
    }
}
