<?php

namespace Tests\Feature;

use App\Models\Partner;
use App\Models\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;

class AdminTest extends MarketplaceTestCase
{
    public function test_nur_admins(): void
    {
        $this->actingAsUser();
        $this->getJson('/api/admin/stats')->assertForbidden();
        $this->postJson('/api/admin/partners', ['name' => 'X'])->assertForbidden();
    }

    public function test_partner_und_angebot_anlegen(): void
    {
        Storage::fake('public');
        $admin = $this->actingAsUser();
        $admin->forceFill(['is_admin' => true])->save();

        $partner = $this->postJson('/api/admin/partners', [
            'name' => 'Kletterhalle Nord',
            'city' => 'Göttingen',
            'lat' => 51.55,
            'lng' => 9.93,
            'instagram' => '@kletternord',
        ])->assertCreated()
            ->assertJsonPath('data.slug', 'kletterhalle-nord')
            ->assertJsonPath('data.instagram', 'kletternord')
            ->json('data');

        $this->assertStringContainsString('/c/'.$partner['checkin_token'], $partner['checkin_url']);

        $this->postJson("/api/admin/partners/{$partner['id']}/image", ['kind' => 'logo', 'image' => UploadedFile::fake()->image('logo.png')])
            ->assertOk();
        Storage::disk('public')->assertExists(Partner::find($partner['id'])->logo_path);

        // Ohne Preis kein Angebot.
        $this->postJson('/api/admin/offers', ['partner_id' => $partner['id'], 'kind' => 'perk', 'title' => 'Freigetränk'])
            ->assertStatus(422)->assertJsonValidationErrors('price_cents');

        $this->postJson('/api/admin/offers', ['partner_id' => $partner['id'], 'kind' => 'perk', 'title' => 'Freigetränk', 'price_credits' => 80])
            ->assertCreated()
            ->assertJsonPath('data.price_credits', 80);

        $this->postJson('/api/admin/offers', ['partner_id' => $partner['id'], 'kind' => 'activity', 'title' => 'Bouldern', 'price_cents' => 1500, 'min_people' => 4, 'max_people' => 2])
            ->assertStatus(422)->assertJsonValidationErrors('max_people');

        $customer = $this->user(['email' => 'staff@example.com']);
        $this->postJson("/api/admin/partners/{$partner['id']}/staff", ['email' => 'staff@example.com'])
            ->assertOk()
            ->assertJsonPath('data.staff.0.id', $customer->id);

        $this->getJson('/api/admin/stats')->assertOk()->assertJsonPath('totals.partners', 1)->assertJsonPath('totals.offers', 1);
    }

    public function test_gutschein_auflage_und_credits_gutschreiben(): void
    {
        $admin = $this->actingAsUser();
        $admin->forceFill(['is_admin' => true])->save();

        $this->postJson('/api/admin/voucher-batches', ['label' => 'REWE Herbst', 'retailer' => 'REWE', 'credits' => 200, 'quantity' => 25])
            ->assertCreated()
            ->assertJsonPath('data.created_count', 25);

        $csv = $this->get('/api/admin/voucher-batches/1/codes.csv')->assertOk()->streamedContent();
        $this->assertSame(26, count(array_filter(explode("\n", $csv))));

        $someone = $this->user();
        $this->postJson("/api/admin/users/{$someone->id}/credits", ['amount' => 150, 'note' => 'Gewinnspiel'])
            ->assertOk()->assertJsonPath('data.credits_balance', 150);
        $this->postJson("/api/admin/users/{$admin->id}/credits", ['amount' => 150, 'note' => 'Selbst'])->assertStatus(400);

        $this->postJson("/api/admin/users/{$someone->id}/ban", ['reason' => 'Spam im Chat'])->assertOk();
        $this->assertTrue(User::find($someone->id)->isBanned());
        $this->getJson('/api/admin/evidence')->assertJsonPath('data.0.reason', 'Spam im Chat');
    }
}
