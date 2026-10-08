<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/*
 * Meldungen behalten ihren Beweis: `snapshot` haelt fest, was gemeldet wurde, im Moment der
 * Meldung (App\Http\Controllers\SafetyController::snapshot) - der Text einer Nachricht samt
 * Verfasser:in und Gruppe, Name und Benutzername eines Kontos, Name und Beschreibung einer
 * Gruppe. Bisher stand nur `target_id` in der Meldung: Wer gemeldet wurde, konnte den Inhalt
 * gleich danach loeschen oder umbenennen, und der Admin-Bereich zeigte nichts mehr. Keine
 * E-Mail-Adressen.
 *
 * Dieselbe Spalte, an derselben Stelle (am Ende), steht in server/schema.sql (Referenz) und in
 * server/src/db.js; scripts/schema-drift prueft, dass alle drei uebereinstimmen.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasColumn('content_reports', 'snapshot')) {
            return;
        }

        Schema::table('content_reports', function (Blueprint $table) {
            $table->json('snapshot')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('content_reports', function (Blueprint $table) {
            $table->dropColumn('snapshot');
        });
    }
};
