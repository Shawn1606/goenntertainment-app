<?php

namespace Tests\Feature;

use App\Models\Offer;
use App\Models\Partner;
use App\Models\User;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\AppFeatureTestCase;

/**
 * Gemeinsamer Aufbau fuer die Marktplatz-Tests: Zahlungen im Testmodus, Standort-Pruefung beim
 * Check-in aus.
 *
 * The database is the one of every database feature test (Tests\AppFeatureTestCase): MySQL 8.4
 * loaded from server/schema.sql, which holds the marketplace tables too, each test inside a
 * transaction that is rolled back. Not RefreshDatabase: that would drop and rebuild the shared
 * test database from the migrations in the middle of the suite (scripts/schema-drift checks that
 * the migrations and schema.sql agree).
 */
abstract class MarketplaceTestCase extends AppFeatureTestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        config(['club.payments' => 'test', 'club.checkin_radius_m' => 0]);
    }

    protected function user(array $attributes = []): User
    {
        return User::factory()->create($attributes);
    }

    protected function actingAsUser(array $attributes = []): User
    {
        $user = $this->user($attributes);
        Sanctum::actingAs($user);

        return $user;
    }

    protected function partner(array $attributes = []): Partner
    {
        $partner = new Partner(array_merge([
            'name' => 'Testpartner '.Str::random(4),
            'city' => 'Göttingen',
            'is_active' => true,
        ], $attributes));
        $partner->slug = Str::slug($partner->name).'-'.Str::lower(Str::random(4));
        $partner->checkin_token = Str::random(32);
        $partner->save();

        return $partner;
    }

    protected function offer(Partner $partner, array $attributes = []): Offer
    {
        return Offer::create(array_merge([
            'partner_id' => $partner->id,
            'kind' => 'activity',
            'title' => 'Testangebot',
            'price_cents' => 2999,
            'price_credits' => 450,
            'min_people' => 1,
            'valid_days' => 30,
            'is_active' => true,
        ], $attributes));
    }
}
