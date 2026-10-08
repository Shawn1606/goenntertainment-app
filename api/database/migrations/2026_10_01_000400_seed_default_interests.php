<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Die Kategorien (Essen & Trinken, Party & Club …) – bisher legte sie nur das
 * Node-Seed-Skript an (server/src/seed.js). Seit Laravel das Schema allein
 * verwaltet, hätte ein frischer Server gar keine: Partner und Angebote ließen
 * sich keiner Kategorie zuordnen, und die Chips auf der Startseite fehlten.
 *
 * insertOrIgnore per Slug: Vorhandene Zeilen (und ihre IDs, auf die Nutzer-
 * Auswahlen und Partner zeigen) bleiben unangetastet. Reihenfolge wie im
 * Seed-Skript, damit ein frischer Server dieselben IDs vergibt.
 */
return new class extends Migration
{
    private const INTERESTS = [
        ['Sport & Radfahren', 'sport-radfahren', 'bike'],
        ['Soziales & Community', 'soziales-community', 'people'],
        ['Basketball', 'basketball', 'basketball'],
        ['Fotografie', 'fotografie', 'camera'],
        ['Musik', 'musik', 'music'],
        ['Gaming', 'gaming', 'gaming'],
        ['Reisen', 'reisen', 'travel'],
        ['Kochen', 'kochen', 'cooking'],
        ['Kunst & Design', 'kunst-design', 'art'],
        ['Fitness', 'fitness', 'fitness'],
        ['Konzerte', 'konzerte', 'konzert'],
        ['Party & Club', 'party-club', 'party'],
        ['Tanzen', 'tanzen', 'tanz'],
        ['Theater & Bühne', 'theater-buhne', 'theater'],
        ['Comedy & Kabarett', 'comedy-kabarett', 'comedy'],
        ['Lesung & Literatur', 'lesung-literatur', 'lesung'],
        ['Film & Kino', 'film-kino', 'film'],
        ['Ausstellung & Museum', 'ausstellung-museum', 'ausstellung'],
        ['Markt & Flohmarkt', 'markt-flohmarkt', 'markt'],
        ['Festival', 'festival', 'festival'],
        ['Workshop & Kurs', 'workshop-kurs', 'workshop'],
        ['Vortrag & Bildung', 'vortrag-bildung', 'vortrag'],
        ['Essen & Trinken', 'essen-trinken', 'essen'],
        ['Natur & Wandern', 'natur-wandern', 'natur'],
        ['Spieleabend', 'spieleabend', 'spiel'],
        ['Queer', 'queer', 'queer'],
        ['Familie & Kinder', 'familie-kinder', 'familie'],
        ['Studium & Campus', 'studium-campus', 'studium'],
    ];

    public function up(): void
    {
        $now = now();
        foreach (self::INTERESTS as [$name, $slug, $icon]) {
            DB::table('interests')->insertOrIgnore([
                'name' => $name,
                'slug' => $slug,
                'icon' => $icon,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }
    }

    public function down(): void
    {
        // Absichtlich leer: Die Kategorien können schon benutzt werden.
    }
};
