<?php

namespace App\Support;

use App\Models\CreditLot;
use App\Models\CreditTransaction;
use App\Models\User;
use Illuminate\Support\Carbon;
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
 * ## Verfall: jede Gutschrift ist ein Posten
 *
 * Jede Gutschrift legt einen Posten an (`credit_lots`). Wie lange er gilt,
 * haengt an der Club-Stufe im Moment der Gutschrift (shared/club.json,
 * plans[].creditValidity: Free 365 Tage, Gold 18 Monate, Platinum 30 Monate).
 * Wer in eine Stufe mit laengerer Gueltigkeit wechselt, bekommt sie auch fuer
 * seine offenen Posten (`extendForPlan`) - kuerzer wird eine Frist nie.
 * Abgebucht wird immer vom Posten, der am fruehesten
 * verfaellt; `credit_lot_uses` haelt fest, wie viel woher kam. Am Stichtag
 * verfaellt nur der Rest DIESES Postens - spaetere Kaeufe behalten ihre eigene
 * Frist. Ausgebucht wird der Verfall als eigene Zeile (`expired`), stuendlich
 * per Zeitplan und vor jeder Bewegung des Kontos, damit nie mit verfallenen
 * Credits bezahlt wird.
 *
 * Die Summe der Posten-Reste ist der Stand. Ausnahme: Konten, deren Stand von
 * Hand gesetzt wurde, ohne Posten - deren Credits haben keinen Stichtag.
 *
 * Wer Credits bewegt, ruft `credit`/`debit`/`refund` - nie ein direktes UPDATE.
 * Gesperrt wird immer erst das Konto, dann die Posten.
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

        return DB::transaction(function () use ($user, $amount, $kind, $description, $refs) {
            self::expireLocked($user);
            $transaction = self::book($user, $amount, $kind, $description, $refs);
            self::openLot($user, $transaction, $amount, Club::creditExpiry($user->club_plan, $transaction->created_at));

            return $transaction;
        });
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

        return DB::transaction(function () use ($user, $amount, $kind, $description, $refs) {
            self::expireLocked($user);
            $transaction = self::book($user, -$amount, $kind, $description, $refs);

            $need = $amount;
            foreach (CreditLot::where('user_id', $user->getKey())->spendable()->lockForUpdate()->get() as $lot) {
                $take = min($need, $lot->remaining);
                self::use($lot, $transaction, $take);
                $need -= $take;
                if ($need === 0) {
                    break;
                }
            }

            return $transaction;
        });
    }

    /**
     * Storno einer Abbuchung: Die Credits gehen auf die Posten zurueck, aus denen
     * sie kamen - mit deren alter Frist. Ist ein Posten inzwischen verfallen, gilt
     * sein Anteil ab jetzt noch `refundGraceDays` Tage.
     *
     * @param  array{booking_id?: int|null, payment_id?: int|null, voucher_id?: int|null}  $refs
     */
    public static function refund(User $user, CreditTransaction $debit, int $amount, string $description, array $refs = []): CreditTransaction
    {
        if ($amount <= 0) {
            throw new \InvalidArgumentException('Erstattung braucht einen positiven Betrag.');
        }

        return DB::transaction(function () use ($user, $debit, $amount, $description, $refs) {
            self::expireLocked($user);
            $transaction = self::book($user, $amount, 'refund', $description, $refs);

            $left = $amount;
            $late = 0;
            $uses = DB::table('credit_lot_uses')->where('credit_transaction_id', $debit->getKey())->orderBy('id')->get();
            foreach ($uses as $use) {
                $back = min($left, (int) $use->amount);
                if ($back <= 0) {
                    break;
                }
                $lot = CreditLot::whereKey($use->credit_lot_id)->lockForUpdate()->first();
                if ($lot !== null && $lot->expires_at->isFuture()) {
                    $lot->increment('remaining', $back);
                } else {
                    $late += $back;
                }
                $left -= $back;
            }

            if ($late > 0) {
                self::openLot($user, $transaction, $late, now()->addDays(Club::refundGraceDays()));
            }
            // Was die Abbuchung keinem Posten zuordnen konnte (Altbestand): neue Frist.
            if ($left > 0) {
                self::openLot($user, $transaction, $left, Club::creditExpiry($user->club_plan, now()));
            }

            return $transaction;
        });
    }

    /** Verfallene Posten eines Kontos ausbuchen. Gibt die verfallenen Credits zurueck. */
    public static function expire(User $user): int
    {
        return DB::transaction(fn () => self::expireLocked($user));
    }

    /**
     * Alle faelligen Posten ausbuchen (Zeitplan, routes/console.php). Gibt die Zahl
     * der bearbeiteten Konten zurueck.
     */
    public static function expireDue(): int
    {
        $count = 0;
        $userIds = CreditLot::where('remaining', '>', 0)->where('expires_at', '<=', now())->distinct()->pluck('user_id');

        foreach ($userIds as $id) {
            $user = User::find($id);
            if ($user !== null) {
                self::expire($user);
                $count++;
            }
        }

        return $count;
    }

    /**
     * Offene Posten auf die Gueltigkeit der aktuellen Stufe verlaengern (nach
     * einem Upgrade), gerechnet ab ihrer Gutschrift. Kuerzer wird nichts. Gibt
     * die Zahl der verlaengerten Posten zurueck.
     */
    public static function extendForPlan(User $user): int
    {
        return DB::transaction(function () use ($user) {
            self::expireLocked($user);
            $count = 0;
            foreach (CreditLot::where('user_id', $user->getKey())->spendable()->lockForUpdate()->get() as $lot) {
                $longer = Club::creditExpiry($user->club_plan, $lot->created_at);
                if ($longer->greaterThan($lot->expires_at)) {
                    $lot->update(['expires_at' => $longer]);
                    $count++;
                }
            }

            return $count;
        });
    }

    /**
     * Was noch gilt, der frueheste Verfall zuerst - fuer die Anzeige. `amount` ist
     * die urspruengliche Gutschrift, `kind` ihre Art (purchase, monthly, ...).
     *
     * @return list<array{credits: int, amount: int, kind: string|null, expires_at: string|null, created_at: string|null}>
     */
    public static function spendableLots(User $user, int $limit = 50): array
    {
        return CreditLot::with('transaction:id,kind')
            ->where('user_id', $user->getKey())
            ->spendable()
            ->limit($limit)
            ->get()
            ->map(fn (CreditLot $lot) => [
                'credits' => $lot->remaining,
                'amount' => $lot->amount,
                'kind' => $lot->transaction?->kind,
                'expires_at' => Format::iso($lot->expires_at),
                'created_at' => Format::iso($lot->created_at),
            ])
            ->all();
    }

    /** Im laufenden DB-Vorgang: Konto sperren, dann faellige Posten ausbuchen. */
    private static function expireLocked(User $user): int
    {
        $balance = (int) User::whereKey($user->getKey())->lockForUpdate()->value('credits_balance');

        $due = CreditLot::where('user_id', $user->getKey())
            ->where('remaining', '>', 0)
            ->where('expires_at', '<=', now())
            ->orderBy('expires_at')
            ->orderBy('id')
            ->lockForUpdate()
            ->get();

        $expired = 0;
        foreach ($due as $lot) {
            // Nie unter 0 - falls der Stand von Hand kleiner gesetzt wurde als die Posten.
            $take = min($lot->remaining, $balance - $expired);
            if ($take > 0) {
                $transaction = self::book(
                    $user,
                    -$take,
                    'expired',
                    'Verfallen: '.Format::credits($take).' Credits vom '.$lot->created_at->format('d.m.Y'),
                    [],
                );
                DB::table('credit_lot_uses')->insert([
                    'credit_lot_id' => $lot->getKey(),
                    'credit_transaction_id' => $transaction->getKey(),
                    'amount' => $take,
                ]);
                $expired += $take;
            }
            $lot->update(['remaining' => 0]);
        }

        return $expired;
    }

    private static function openLot(User $user, CreditTransaction $transaction, int $amount, Carbon $expiresAt): void
    {
        CreditLot::create([
            'user_id' => $user->getKey(),
            'credit_transaction_id' => $transaction->getKey(),
            'amount' => $amount,
            'remaining' => $amount,
            'expires_at' => $expiresAt,
            'created_at' => now(),
        ]);
    }

    private static function use(CreditLot $lot, CreditTransaction $transaction, int $amount): void
    {
        $lot->decrement('remaining', $amount);
        DB::table('credit_lot_uses')->insert([
            'credit_lot_id' => $lot->getKey(),
            'credit_transaction_id' => $transaction->getKey(),
            'amount' => $amount,
        ]);
    }

    /** Stand fortschreiben und die Zeile schreiben - nur innerhalb einer Transaktion. */
    private static function book(User $user, int $amount, string $kind, string $description, array $refs): CreditTransaction
    {
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
    }
}
