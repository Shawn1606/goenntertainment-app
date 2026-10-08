<?php

use App\Support\Club;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/*
 * Credits gelten je Club-Stufe verschieden lang: Free 365 Tage, Gold 18 Monate,
 * Platinum 30 Monate (shared/club.json, plans[].creditValidity).
 *
 * Konten, die heute schon Gold oder Platinum sind, bekommen die laengere Frist
 * auch fuer ihre offenen Posten - gerechnet ab der Gutschrift, nie kuerzer als
 * bisher. Danach erledigt das App\Support\Wallet::extendForPlan beim Upgrade.
 */
return new class extends Migration
{
    public function up(): void
    {
        $paid = array_values(array_filter(Club::planKeys(), fn ($k) => Club::isPaidPlan($k)));

        DB::table('users')->whereIn('club_plan', $paid)->select(['id', 'club_plan'])->orderBy('id')->chunk(200, function ($users) {
            foreach ($users as $user) {
                $lots = DB::table('credit_lots')
                    ->where('user_id', $user->id)
                    ->where('remaining', '>', 0)
                    ->where('expires_at', '>', now())
                    ->get(['id', 'created_at', 'expires_at']);

                foreach ($lots as $lot) {
                    $longer = Club::creditExpiry($user->club_plan, Carbon::parse($lot->created_at ?? now()));
                    if ($longer->greaterThan(Carbon::parse($lot->expires_at))) {
                        DB::table('credit_lots')->where('id', $lot->id)->update(['expires_at' => $longer]);
                    }
                }
            }
        });
    }

    public function down(): void
    {
        // Laengere Fristen werden nicht zurueckgenommen.
    }
};
