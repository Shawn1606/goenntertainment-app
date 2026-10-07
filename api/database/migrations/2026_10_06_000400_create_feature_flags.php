<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/*
 * Schalter fuer Funktionen (App\Support\Features).
 *
 * - **`feature_flags`** gilt fuer ALLE Nutzer: Ist eine Funktion hier an (z. B.
 *   das Stadt-Bingo, das zweimal im Jahr laeuft), sehen sie alle. `value` traegt
 *   Auswahl-Werte wie das Saison-Thema („auto" = nach Datum).
 * - **`feature_previews`** gilt nur fuer EINEN Admin: So kann er eine Funktion
 *   fuer sich an- oder ausschalten (oder ein Saison-Thema ansehen), ohne dass
 *   irgendwer sonst etwas davon merkt. Keine Zeile = wie fuer alle.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('feature_flags', function (Blueprint $table) {
            $table->id();
            $table->string('key', 40)->unique();
            $table->boolean('enabled')->default(false);
            $table->string('value', 40)->nullable();
            $table->timestamps();
        });

        Schema::create('feature_previews', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('key', 40);
            $table->boolean('enabled')->nullable();
            $table->string('value', 40)->nullable();
            $table->timestamps();
            $table->unique(['user_id', 'key']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('feature_previews');
        Schema::dropIfExists('feature_flags');
    }
};
