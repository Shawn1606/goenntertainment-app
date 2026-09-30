<?php

namespace App\Support;

use App\Models\CreditTransaction;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Das Credit-Konto: jede Gut- und Lastschrift geht HIER durch.
 *
 * ## Warum Stand UND Buchungszeilen
 *
 * `users.credits_balance` ist der Stand, den die App in der Kopfzeile zeigt -
 * eine Abfrage, keine Summe ueber alle Zeilen. `credit_transactions` ist die
 * Geschichte dahinter, jede Zeile mit dem Stand danach. Beides wird in DERSELBEN
 * Transaktion geschrieben, und der Kontostand wird dafuer gesperrt
 * (`lockForUpdate`): Zwei gleichzeitige Buchungen koennen so nicht beide denselben
 * alten Stand lesen und einen Credit doppelt ausgeben.
 *
 * Wer Credits bewegt, ruft `credit`/`debit` - nie ein direktes UPDATE.
 */
final class Wallet
{
    /**
     * @param  array{booking_id?: int|null, payment_id?: int|null, voucher_id?: int|null}  $refs
     */
    public static function credit(User $user, int $amount, string $kind, string $description, array $refs = []): CreditTransaction
    {
        if ($amount <= 0) {
            throw new \InvalidArgumentException('Gutschrift braucht einen positiven Betrag.');
        }

        return self::move($user, $amount, $kind, $description, $refs);
    }

    /**
     * Abbuchen - oder 422 mit einer Meldung, die die App woertlich zeigen kann.
     *
     * @param  array{booking_id?: int|null, payment_id?: int|null, voucher_id?: int|null}  $refs
     */
    public static function debit(User $user, int $amount, string $kind, string $description, array $refs = []): CreditTransaction
    {
        if ($amount <= 0) {
            throw new \InvalidArgumentException('Abbuchung braucht einen positiven Betrag.');
        }

        return self::move($user, -$amount, $kind, $description, $refs);
    }

    private static function move(User $user, int $amount, string $kind, string $description, array $refs): CreditTransaction
    {
        return DB::transaction(function () use ($user, $amount, $kind, $description, $refs) {
            $balance = (int) User::whereKey($user->getKey())->lockForUpdate()->value('credits_balance');
            $after = $balance + $amount;

            if ($after < 0) {
                throw ValidationException::withMessages([
                    'credits' => ['Dafür reichen deine Credits nicht – dir fehlen '.Format::credits(-$after).' Credits.'],
                ]);
            }

            User::whereKey($user->getKey())->update(['credits_balance' => $after]);
            $user->credits_balance = $after;

            return CreditTransaction::create([
                'user_id' => $user->getKey(),
                'amount' => $amount,
                'balance_after' => $after,
                'kind' => $kind,
                'description' => mb_substr($description, 0, 200),
                'booking_id' => $refs['booking_id'] ?? null,
                'payment_id' => $refs['payment_id'] ?? null,
                'voucher_id' => $refs['voucher_id'] ?? null,
            ]);
        });
    }
}
