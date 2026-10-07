<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/*
 * Testphase (nur Admins, App\Support\TestPhase): Challenges und eingeloeste
 * Belohnungen.
 *
 * - **`testphase_challenges`** beschreibt eine Aufgabe: was gezaehlt wird
 *   (`metric`: Besuche, verschiedene Partner, Buchungen, eingeloeste Angebote,
 *   Gruppenbuchungen ...), wie oft (`target`), in welchem Zeitraum (`period`:
 *   Kalendermonat, Kalenderwoche oder fester Bereich) und was sie bringt.
 *   Filter grenzen ein: ein Partner, eine Kategorie, ein Suchwort im Namen des
 *   Partners bzw. Angebots („Bowling", „Softdrink"), die Art des Angebots.
 * - **`testphase_claims`** haelt fest, wer welche Belohnung fuer welchen
 *   Zeitraum schon abgeholt hat - fuer Challenges, Bingo-Reihen und
 *   Serien-Meilensteine gleichermassen. Der eindeutige Schluessel verhindert
 *   doppeltes Abholen.
 *
 * Der Fortschritt wird nicht gespeichert, sondern jedes Mal aus Stempeln und
 * Buchungen gerechnet - so gibt es nichts, was auseinanderlaufen kann.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('testphase_challenges', function (Blueprint $table) {
            $table->id();
            // monthly | weekly | season | group | partner
            $table->string('type', 12);
            $table->string('title', 120);
            $table->string('description', 300)->nullable();
            // visits | distinct_partners | distinct_categories | bookings | redeemed | group_bookings
            $table->string('metric', 24);
            $table->unsignedSmallInteger('target');
            $table->unsignedInteger('reward_credits');
            // month | week | range
            $table->string('period', 8);
            $table->date('starts_at')->nullable();
            $table->date('ends_at')->nullable();
            $table->foreignId('partner_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('interest_id')->nullable()->constrained('interests')->nullOnDelete();
            $table->string('match_text', 60)->nullable();
            $table->string('offer_kind', 20)->nullable();
            // null = alle Stufen, sonst z. B. ["gold","platinum"]
            $table->json('plans')->nullable();
            $table->boolean('is_active')->default(true);
            $table->unsignedSmallInteger('sort')->default(0);
            $table->timestamps();
        });

        Schema::create('testphase_claims', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            // challenge:12 | bingo:line:3 | bingo:full | streak:4
            $table->string('key', 60);
            // 2026-10 | 2026-W41 | range-20261001 | Startwoche der Serie
            $table->string('period', 20);
            $table->unsignedInteger('credits');
            $table->timestamp('created_at')->nullable();
            $table->unique(['user_id', 'key', 'period']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('testphase_claims');
        Schema::dropIfExists('testphase_challenges');
    }
};
