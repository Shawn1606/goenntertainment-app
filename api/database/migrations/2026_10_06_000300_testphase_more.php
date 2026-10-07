<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/*
 * Weitere Ideen in der Testphase (nur Admins, App\Support\TestPhase):
 *
 * - Geheime Challenges (11) und Challenges mit Wahl (13): zwei Schalter an der
 *   Challenge, die Wahl je Konto und Zeitraum in `testphase_choices`.
 * - Rueckmeldungen an Partner (30): eine private Rueckmeldung je eingeloester
 *   Buchung, bringt Credits.
 * - Reservierte Kontingente (36): Tageskontingent je Angebot, davon Plaetze nur
 *   fuer Platinum. NULL = unbegrenzt wie bisher.
 * - Partner-Wunschliste (45): Vorschlaege mit Stimmen (Platinum zaehlt doppelt).
 * - Kosten teilen (62): Anteile einer Gruppenbuchung, die Mitglieder in
 *   Credits zurueckzahlen.
 * - Abstimmung ueber Angebote (64): Umfrage in einer Gruppe mit 2-3 Angeboten.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('testphase_challenges', function (Blueprint $table) {
            $table->boolean('is_secret')->default(false);
            $table->boolean('is_choice')->default(false);
        });

        Schema::create('testphase_choices', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('challenge_id')->constrained('testphase_challenges')->cascadeOnDelete();
            $table->string('period', 20);
            $table->timestamp('created_at')->nullable();
            $table->unique(['user_id', 'challenge_id', 'period']);
        });

        Schema::create('booking_feedback', function (Blueprint $table) {
            $table->id();
            $table->foreignId('booking_id')->unique()->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('partner_id')->nullable()->constrained()->nullOnDelete();
            $table->unsignedTinyInteger('rating');
            $table->string('comment', 500)->nullable();
            $table->timestamp('created_at')->nullable();
        });

        Schema::table('offers', function (Blueprint $table) {
            $table->unsignedSmallInteger('daily_capacity')->nullable();
            $table->unsignedSmallInteger('platinum_reserved')->default(0);
        });

        Schema::create('partner_wishes', function (Blueprint $table) {
            $table->id();
            $table->string('name', 120);
            $table->string('note', 300)->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('created_at')->nullable();
        });

        Schema::create('partner_wish_votes', function (Blueprint $table) {
            $table->foreignId('wish_id')->constrained('partner_wishes')->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->unsignedTinyInteger('weight');
            $table->timestamp('created_at')->nullable();
            $table->primary(['wish_id', 'user_id']);
        });

        Schema::create('booking_shares', function (Blueprint $table) {
            $table->id();
            $table->foreignId('booking_id')->constrained()->cascadeOnDelete();
            $table->foreignId('debtor_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('creditor_id')->constrained('users')->cascadeOnDelete();
            $table->unsignedInteger('credits');
            // pending | paid | declined
            $table->string('status', 10)->default('pending');
            $table->timestamp('created_at')->nullable();
            $table->timestamp('settled_at')->nullable();
            $table->unique(['booking_id', 'debtor_id']);
        });

        Schema::create('group_polls', function (Blueprint $table) {
            $table->id();
            $table->foreignId('group_id')->constrained('friend_groups')->cascadeOnDelete();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->string('title', 120);
            $table->timestamp('closed_at')->nullable();
            $table->timestamp('created_at')->nullable();
        });

        Schema::create('group_poll_options', function (Blueprint $table) {
            $table->id();
            $table->foreignId('poll_id')->constrained('group_polls')->cascadeOnDelete();
            $table->foreignId('offer_id')->nullable()->constrained()->nullOnDelete();
            $table->string('offer_title', 120);
            $table->date('day')->nullable();
        });

        Schema::create('group_poll_votes', function (Blueprint $table) {
            $table->foreignId('poll_id')->constrained('group_polls')->cascadeOnDelete();
            $table->foreignId('option_id')->constrained('group_poll_options')->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->timestamp('created_at')->nullable();
            $table->primary(['poll_id', 'user_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('group_poll_votes');
        Schema::dropIfExists('group_poll_options');
        Schema::dropIfExists('group_polls');
        Schema::dropIfExists('booking_shares');
        Schema::dropIfExists('partner_wish_votes');
        Schema::dropIfExists('partner_wishes');
        Schema::table('offers', function (Blueprint $table) {
            $table->dropColumn(['daily_capacity', 'platinum_reserved']);
        });
        Schema::dropIfExists('booking_feedback');
        Schema::dropIfExists('testphase_choices');
        Schema::table('testphase_challenges', function (Blueprint $table) {
            $table->dropColumn(['is_secret', 'is_choice']);
        });
    }
};
