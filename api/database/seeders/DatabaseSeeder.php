<?php

namespace Database\Seeders;

use App\Models\User;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;
use RuntimeException;

/**
 * Ein Testkonto zum Ausprobieren - NUR lokal. Die Adresse liegt in `example.invalid`, die es
 * nie geben wird, und das Passwort ist das bekannte Fabrik-Passwort: Genau deshalb verweigert
 * der Seeder in Produktion den Dienst (wie DemoMarketplaceSeeder).
 */
class DatabaseSeeder extends Seeder
{
    use WithoutModelEvents;

    /**
     * Seed the application's database.
     */
    public function run(): void
    {
        if (app()->environment('production')) {
            throw new RuntimeException('Testkonten gehoeren nicht in die Produktion.');
        }

        User::factory()->create([
            'name' => 'Test User',
            'email' => 'test-user@example.invalid',
        ]);
    }
}
