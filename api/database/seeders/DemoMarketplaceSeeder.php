<?php

namespace Database\Seeders;

use App\Models\Interest;
use App\Models\Offer;
use App\Models\Partner;
use Illuminate\Database\Seeder;
use Illuminate\Support\Str;
use RuntimeException;

/**
 * Demo-Partner und -Angebote zum Ausprobieren der App - NUR lokal.
 *
 * Alle Namen beginnen mit „Demo:", damit niemand sie fuer echte Partner haelt,
 * und `demo-` im Slug macht sie wieder auffindbar:
 *
 *   php artisan db:seed --class=DemoMarketplaceSeeder
 *   php artisan tinker --execute "App\Models\Partner::where('slug','like','demo-%')->delete();"
 *
 * In Produktion verweigert der Seeder den Dienst.
 */
class DemoMarketplaceSeeder extends Seeder
{
    public function run(): void
    {
        if (app()->environment('production')) {
            throw new RuntimeException('Demo-Daten gehoeren nicht in die Produktion.');
        }

        $interest = fn (string $needle) => Interest::where('name', 'like', "%{$needle}%")->value('id');

        $partners = [
            [
                'name' => 'Demo: Kletterwald Nord',
                'tagline' => 'Hochseilgarten mit 8 Parcours',
                'city' => 'Göttingen', 'address' => 'Waldweg 1', 'lat' => 51.5602, 'lng' => 9.9351,
                'interest' => 'Sport', 'featured' => true,
                'offers' => [
                    ['title' => 'Kletter-Session (3 Std.)', 'price_cents' => 2400, 'price_credits' => 360, 'min_age' => 8, 'min_people' => 1, 'max_people' => 20, 'duration_minutes' => 180, 'indoor' => false, 'is_featured' => true],
                    ['title' => 'Kindergeburtstag', 'subtitle' => 'Inkl. Betreuung', 'price_cents' => 1800, 'min_age' => 6, 'max_age' => 14, 'min_people' => 6, 'max_people' => 15, 'duration_minutes' => 150, 'indoor' => false],
                ],
            ],
            [
                'name' => 'Demo: Escape Rooms Altstadt',
                'tagline' => 'Drei Räume, 60 Minuten, ein Ausweg',
                'city' => 'Göttingen', 'address' => 'Marktgasse 5', 'lat' => 51.5328, 'lng' => 9.9355,
                'interest' => 'Spiel', 'featured' => false,
                'offers' => [
                    ['title' => 'Escape Room „Labor"', 'price_cents' => 2900, 'price_credits' => 430, 'min_age' => 12, 'min_people' => 2, 'max_people' => 6, 'duration_minutes' => 60, 'indoor' => true, 'is_featured' => true],
                ],
            ],
            [
                'name' => 'Demo: Bowling-Center Süd',
                'tagline' => '16 Bahnen, Snacks, Musik',
                'city' => 'Göttingen', 'address' => 'Am Kreuze 12', 'lat' => 51.5190, 'lng' => 9.9230,
                'interest' => 'Party', 'featured' => false,
                'offers' => [
                    ['title' => 'Bahn für 1 Stunde', 'subtitle' => 'Preis pro Person', 'price_cents' => 900, 'price_credits' => 130, 'min_people' => 1, 'max_people' => 8, 'duration_minutes' => 60, 'indoor' => true],
                    ['kind' => 'perk', 'title' => 'Softdrink gratis', 'price_credits' => 60, 'min_people' => 1],
                ],
            ],
            [
                'name' => 'Demo: Café am Wall',
                'tagline' => 'Kaffee, Kuchen, Brettspiele',
                'city' => 'Göttingen', 'address' => 'Am Wall 3', 'lat' => 51.5361, 'lng' => 9.9283,
                'interest' => 'Essen', 'featured' => false,
                'offers' => [
                    ['kind' => 'perk', 'title' => 'Heißgetränk nach Wahl', 'price_credits' => 50, 'min_people' => 1],
                    ['title' => 'Spieleabend-Tisch (2 Std.)', 'price_cents' => 500, 'min_people' => 2, 'max_people' => 8, 'duration_minutes' => 120, 'indoor' => true],
                ],
            ],
        ];

        foreach ($partners as $data) {
            $slug = 'demo-'.Str::slug(Str::after($data['name'], 'Demo: '));
            $partner = Partner::where('slug', $slug)->first() ?? new Partner;
            $partner->fill([
                'name' => $data['name'],
                'tagline' => $data['tagline'],
                'description' => 'Demo-Eintrag zum Ausprobieren der App. Kein echter Partner.',
                'city' => $data['city'],
                'address' => $data['address'],
                'lat' => $data['lat'],
                'lng' => $data['lng'],
                'interest_id' => $interest($data['interest']),
                'is_active' => true,
                'is_featured' => $data['featured'],
            ]);
            $partner->slug = $slug;
            $partner->checkin_token ??= Str::random(32);
            $partner->save();

            foreach ($data['offers'] as $offer) {
                Offer::updateOrCreate(
                    ['partner_id' => $partner->id, 'title' => $offer['title']],
                    $offer + ['kind' => 'activity', 'interest_id' => $partner->interest_id, 'is_active' => true, 'valid_days' => 60],
                );
            }
        }

        $this->command?->info('Demo-Partner angelegt: '.count($partners));
    }
}
