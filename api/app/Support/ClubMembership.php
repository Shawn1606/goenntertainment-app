<?php

namespace App\Support;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Die Club-Stufe eines Kontos: abschliessen, kuendigen, verlaengern.
 *
 * Ein Abo laeuft einen Monat oder ein Jahr (`club_interval`) und verlaengert
 * sich von selbst (`renewDue`, stuendlich per Zeitplan, routes/console.php).
 * Gekuendigt wird zum Ende der Laufzeit - bis dahin bleibt alles, was bezahlt
 * ist.
 *
 * ## Monats-Credits
 *
 * Beim Monatsabo kommen sie mit jeder Verlaengerung. Beim Jahresabo wird nur
 * einmal im Jahr bezahlt, die Credits kommen trotzdem jeden Monat:
 * `club_credits_next_at` sagt wann, `grantDueCredits` (gleicher Zeitplan)
 * schreibt sie gut.
 *
 * ## Jahresabo
 *
 * Kostet zehn Monatspreise (shared/club.json, yearlyPriceCents). Nach dem ersten
 * Jahr laeuft es als Monatsabo weiter und ist monatlich kuendbar - eine stille
 * Verlaengerung um ein ganzes Jahr waere gegenueber Verbraucher:innen nicht
 * zulaessig. Waehrend eines laufenden Jahresabos gibt es keinen Stufenwechsel
 * (ohne Anrechnung waere er unfair); kuendigen geht zum Ende des Jahres.
 *
 * Ein Wechsel zwischen Gold und Platinum im Monatsabo ist ein neuer Abschluss:
 * sofort, mit neuer Laufzeit und den Credits der neuen Stufe.
 */
final class ClubMembership
{
    public const INTERVALS = ['month', 'year'];

    public static function subscribe(User $user, string $planKey, string $interval = 'month'): User
    {
        if (! Club::isPaidPlan($planKey)) {
            throw ValidationException::withMessages(['plan' => ['Diese Stufe gibt es nicht.']]);
        }
        if (! in_array($interval, self::INTERVALS, true)) {
            throw ValidationException::withMessages(['interval' => ['Monatlich oder jährlich?']]);
        }

        $plan = Club::plan($planKey);
        $current = $user->club_interval ?? 'month';
        $active = Club::isPaidPlan($user->club_plan);

        if ($active && $current === 'year' && ! ($user->club_plan === $planKey && $user->club_cancel_at_period_end)) {
            throw ValidationException::withMessages(['plan' => [
                'Dein Jahresabo läuft bis '.$user->club_renews_at?->format('d.m.Y').'. Ein Wechsel geht danach.',
            ]]);
        }

        if ($user->club_plan === $planKey && ! $user->club_cancel_at_period_end && $current === $interval) {
            throw ValidationException::withMessages(['plan' => ["Du bist schon im {$plan['name']}."]]);
        }

        // Gekuendigt, aber noch in der Laufzeit, dieselbe Stufe und Laufzeit: nur
        // die Kuendigung zuruecknehmen. Ein zweites Mal bezahlen waere falsch.
        if ($user->club_plan === $planKey && $user->club_cancel_at_period_end && $current === $interval) {
            $user->forceFill(['club_cancel_at_period_end' => false])->save();

            return $user;
        }

        return DB::transaction(function () use ($user, $plan, $interval) {
            $label = $interval === 'year' ? '1 Jahr' : '1 Monat';
            $payment = Payments::charge($user, 'plan', Club::periodPriceCents($plan['key'], $interval), "{$plan['name']} – {$label}");

            $user->forceFill([
                'club_plan' => $plan['key'],
                'club_interval' => $interval,
                'club_since' => ! Club::isPaidPlan($user->club_plan) || $user->club_since === null ? now() : $user->club_since,
                'club_renews_at' => $interval === 'year' ? now()->addYear() : now()->addMonth(),
                'club_cancel_at_period_end' => false,
                'club_credits_next_at' => $interval === 'year' ? now()->addMonth() : null,
            ])->save();

            // Laengere Gueltigkeit der neuen Stufe gilt auch fuer offene Credits.
            Wallet::extendForPlan($user);
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
     * Faellige Abos verlaengern bzw. auslaufen lassen und die Monats-Credits der
     * Jahresabos gutschreiben. Gibt die Zahl der bearbeiteten Konten zurueck.
     */
    public static function renewDue(): int
    {
        $count = self::grantDueCredits();

        User::whereIn('club_plan', self::paidPlans())
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

    /**
     * Jahresabos: Monats-Credits fuer jeden faelligen Monat innerhalb der
     * bezahlten Laufzeit. Gibt die Zahl der Konten mit Gutschrift zurueck.
     */
    public static function grantDueCredits(): int
    {
        $count = 0;

        User::whereIn('club_plan', self::paidPlans())
            ->where('club_interval', 'year')
            ->whereNotNull('club_credits_next_at')
            ->where('club_credits_next_at', '<=', now())
            ->chunkById(100, function ($users) use (&$count) {
                foreach ($users as $user) {
                    DB::transaction(function () use ($user) {
                        $plan = Club::plan($user->club_plan);
                        $next = $user->club_credits_next_at->copy();
                        // Nur innerhalb der bezahlten Laufzeit; der Monat, mit dem
                        // die Verlaengerung beginnt, bringt seine Credits selbst.
                        while ($next->lessThanOrEqualTo(now()) && $next->lessThan($user->club_renews_at)) {
                            self::grantMonthlyCredits($user, $plan, null);
                            $next->addMonth();
                        }
                        $user->forceFill(['club_credits_next_at' => $next->lessThan($user->club_renews_at) ? $next : null])->save();
                    });
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
                'club_interval' => 'month',
                'club_renews_at' => null,
                'club_cancel_at_period_end' => false,
                'club_credits_next_at' => null,
            ])->save();

            return;
        }

        // Auch ein Jahresabo laeuft danach monatlich weiter (siehe oben).
        DB::transaction(function () use ($user) {
            $plan = Club::plan($user->club_plan);
            $payment = Payments::charge($user, 'plan', $plan['priceCents'], "{$plan['name']} – Verlängerung");
            $user->forceFill([
                'club_interval' => 'month',
                'club_renews_at' => $user->club_renews_at->copy()->addMonth(),
                'club_credits_next_at' => null,
            ])->save();
            self::grantMonthlyCredits($user, $plan, $payment->getKey());
        });
    }

    /** @return list<string> */
    private static function paidPlans(): array
    {
        return array_values(array_filter(Club::planKeys(), fn ($k) => Club::isPaidPlan($k)));
    }

    private static function grantMonthlyCredits(User $user, array $plan, ?int $paymentId): void
    {
        $credits = (int) ($plan['monthlyCredits'] ?? 0);
        if ($credits > 0) {
            Wallet::credit($user, $credits, 'monthly', "{$plan['name']}: {$credits} Monats-Credits", ['payment_id' => $paymentId]);
        }
    }
}
