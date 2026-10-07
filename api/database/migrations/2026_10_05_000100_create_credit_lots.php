<?php

use App\Support\Club;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/*
 * Credits verfallen - jede Gutschrift fuer sich.
 *
 * - **`credit_lots`** ist ein Posten: eine Gutschrift (Kauf samt Bonus,
 *   Monats-Credits, Stempelkarte, Gutschein, Admin) mit ihrem Rest und ihrem
 *   Verfallszeitpunkt. Kauft man 1000 Credits und ein Jahr spaeter 100, sind das
 *   zwei Posten: Am Stichtag des ersten verfaellt nur, was von den 1000 uebrig ist.
 * - **`credit_lot_uses`** haelt fest, welche Abbuchung wie viel aus welchem Posten
 *   genommen hat. Ein Storno gibt die Credits genau dorthin zurueck - so verlaengert
 *   Buchen-und-Stornieren keine Gueltigkeit.
 *
 * Bestehende Konten werden aus ihrem Kontoauszug nachgebaut: jede Gutschrift ein
 * Posten, jede Abbuchung nimmt vom frueheren zuerst. Was danach nicht zum Stand
 * passt (Werte von Hand gesetzt), wird ein Posten ab heute.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('credit_lots', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('credit_transaction_id')->nullable()->constrained()->nullOnDelete();
            // Gutgeschrieben und davon noch uebrig.
            $table->integer('amount');
            $table->integer('remaining');
            $table->timestamp('expires_at');
            $table->timestamp('created_at')->nullable();
            $table->index(['user_id', 'expires_at']);
            $table->index(['expires_at', 'remaining']);
        });

        Schema::create('credit_lot_uses', function (Blueprint $table) {
            $table->id();
            $table->foreignId('credit_lot_id')->constrained()->cascadeOnDelete();
            $table->foreignId('credit_transaction_id')->constrained()->cascadeOnDelete();
            $table->integer('amount');
            $table->index('credit_transaction_id');
        });

        $this->backfill();
    }

    public function down(): void
    {
        Schema::dropIfExists('credit_lot_uses');
        Schema::dropIfExists('credit_lots');
    }

    private function backfill(): void
    {
        // Gueltigkeit nach der heutigen Stufe des Kontos (Free 365 Tage, Gold 18,
        // Platinum 30 Monate) - so, als haette es die Regel schon immer gegeben.
        DB::table('users')->select(['id', 'credits_balance', 'club_plan'])->orderBy('id')->chunk(200, function ($users) {
            foreach ($users as $user) {
                $open = [];

                foreach (DB::table('credit_transactions')->where('user_id', $user->id)->orderBy('id')->cursor() as $tx) {
                    $at = Carbon::parse($tx->created_at ?? now());

                    if ($tx->amount > 0) {
                        $id = DB::table('credit_lots')->insertGetId([
                            'user_id' => $user->id,
                            'credit_transaction_id' => $tx->id,
                            'amount' => $tx->amount,
                            'remaining' => $tx->amount,
                            'expires_at' => Club::creditExpiry($user->club_plan, $at),
                            'created_at' => $at,
                        ]);
                        $open[] = ['id' => $id, 'remaining' => $tx->amount];

                        continue;
                    }

                    $need = -$tx->amount;
                    foreach ($open as &$lot) {
                        if ($need === 0) {
                            break;
                        }
                        $take = min($need, $lot['remaining']);
                        if ($take > 0) {
                            $lot['remaining'] -= $take;
                            $need -= $take;
                            DB::table('credit_lot_uses')->insert(['credit_lot_id' => $lot['id'], 'credit_transaction_id' => $tx->id, 'amount' => $take]);
                        }
                    }
                    unset($lot);
                }

                // Stand und Posten abgleichen: zu viel in den Posten -> vom fruehesten
                // abziehen, zu wenig -> ein Posten ab heute.
                $sum = array_sum(array_column($open, 'remaining'));
                $diff = (int) $user->credits_balance - $sum;
                foreach ($open as &$lot) {
                    if ($diff >= 0) {
                        break;
                    }
                    $take = min(-$diff, $lot['remaining']);
                    $lot['remaining'] -= $take;
                    $diff += $take;
                }
                unset($lot);

                foreach ($open as $lot) {
                    DB::table('credit_lots')->where('id', $lot['id'])->update(['remaining' => $lot['remaining']]);
                }

                if ($diff > 0) {
                    DB::table('credit_lots')->insert([
                        'user_id' => $user->id,
                        'credit_transaction_id' => null,
                        'amount' => $diff,
                        'remaining' => $diff,
                        'expires_at' => Club::creditExpiry($user->club_plan, now()),
                        'created_at' => now(),
                    ]);
                }
            }
        });
    }
};
