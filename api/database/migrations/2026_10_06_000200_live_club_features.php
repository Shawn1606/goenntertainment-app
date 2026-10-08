<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/*
 * Live-Funktionen aus der Ideen-Liste (06.10.2026):
 *
 * - **Barrierefreie Filter (86):** Angaben am Partner - rollstuhlgerecht,
 *   kinderfreundlich, ruhige Zeiten. NULL = unbekannt (nicht „nein").
 * - **Jahresabo (87):** `club_interval` month | year. Bei einem Jahresabo kommen
 *   die Monats-Credits trotzdem jeden Monat; `club_credits_next_at` sagt, wann
 *   die naechsten faellig sind (App\Support\ClubMembership::grantDueCredits).
 * - **Verfall-Erinnerung (17):** Je Posten, ob die Mail 30 bzw. 7 Tage vorher
 *   schon raus ist - damit niemand zweimal dieselbe Erinnerung bekommt.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('partners', function (Blueprint $table) {
            $table->boolean('wheelchair_accessible')->nullable();
            $table->boolean('kid_friendly')->nullable();
            $table->string('quiet_times', 160)->nullable();
        });

        Schema::table('users', function (Blueprint $table) {
            $table->string('club_interval', 5)->default('month');
            $table->dateTime('club_credits_next_at')->nullable();
        });

        Schema::table('credit_lots', function (Blueprint $table) {
            $table->timestamp('reminded_30_at')->nullable();
            $table->timestamp('reminded_7_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('credit_lots', function (Blueprint $table) {
            $table->dropColumn(['reminded_30_at', 'reminded_7_at']);
        });
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['club_interval', 'club_credits_next_at']);
        });
        Schema::table('partners', function (Blueprint $table) {
            $table->dropColumn(['wheelchair_accessible', 'kid_friendly', 'quiet_times']);
        });
    }
};
