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

        $batch = $this->postJson('/api/admin/voucher-batches', ['label' => 'REWE Herbst', 'retailer' => 'REWE', 'credits' => 200, 'quantity' => 25])
            ->assertCreated()
            ->assertJsonPath('data.created_count', 25)
            ->json('data.id');

        // The id of the batch just made: InnoDB does not roll its counter back with the test.
        $csv = $this->get("/api/admin/voucher-batches/{$batch}/codes.csv")->assertOk()->streamedContent();
        $this->assertSame(26, count(array_filter(explode("\n", $csv))));

        $someone = $this->user();
        $this->postJson("/api/admin/users/{$someone->id}/credits", ['amount' => 150, 'note' => 'Gewinnspiel'])
            ->assertOk()->assertJsonPath('data.credits_balance', 150);
        // Credits darf ein Admin auch beim eigenen Konto korrigieren – sperren nicht.
        $this->postJson("/api/admin/users/{$admin->id}/credits", ['amount' => 150, 'note' => 'Selbst'])
            ->assertOk()->assertJsonPath('data.credits_balance', 150)->assertJsonPath('data.is_self', true);
        $this->postJson("/api/admin/users/{$admin->id}/ban", ['reason' => 'Versehen'])->assertStatus(400);

        $this->postJson("/api/admin/users/{$someone->id}/ban", ['reason' => 'Spam im Chat'])->assertOk();
        $this->assertTrue(User::find($someone->id)->isBanned());
        $this->getJson('/api/admin/evidence')->assertJsonPath('data.0.reason', 'Spam im Chat');
    }

    public function test_credits_abziehen_nur_bis_null(): void
    {
        $admin = $this->actingAsUser();
        $admin->forceFill(['is_admin' => true])->save();
        $someone = $this->user(['credits_balance' => 40]);

        $this->postJson("/api/admin/users/{$someone->id}/credits", ['amount' => -50, 'note' => 'Korrektur'])
            ->assertStatus(422)
            ->assertJsonPath('errors.amount.0', 'Auf dem Konto sind nur 40 Credits – mehr lässt sich nicht abziehen.');
        $this->postJson("/api/admin/users/{$someone->id}/credits", ['amount' => -40, 'note' => 'Korrektur'])
            ->assertOk()
            ->assertJsonPath('data.credits_balance', 0)
            ->assertJsonPath('data.transactions.0.amount', -40);
    }

    public function test_stempel_ansehen_und_korrigieren(): void
    {
        $admin = $this->actingAsUser();
        $admin->forceFill(['is_admin' => true])->save();

        // Neun Stempel gutschreiben, dann einer mehr: Karte voll, 100 Credits.
        $this->postJson("/api/admin/users/{$admin->id}/stamps", ['amount' => 9])
            ->assertOk()
            ->assertJsonPath('data.stamps_total', 9)
            ->assertJsonPath('data.stamps.filled', 9)
            ->assertJsonPath('reward_credits', 0);
        $this->postJson("/api/admin/users/{$admin->id}/stamps", ['amount' => 1])
            ->assertOk()
            ->assertJsonPath('data.stamps_total', 10)
            ->assertJsonPath('data.stamps.filled', 0)
            ->assertJsonPath('data.stamps.completed_cards', 1)
            ->assertJsonPath('data.credits_balance', 100)
            ->assertJsonPath('reward_credits', 100);

        // Abziehen nimmt die jüngsten Stempel weg, aber nicht mehr, als da sind.
        $this->postJson("/api/admin/users/{$admin->id}/stamps", ['amount' => -11])->assertStatus(422);
        $this->postJson("/api/admin/users/{$admin->id}/stamps", ['amount' => -3])
            ->assertOk()
            ->assertJsonPath('data.stamps_total', 7)
            ->assertJsonPath('data.credits_balance', 100);

        $this->getJson("/api/admin/users/{$admin->id}")->assertOk()->assertJsonPath('data.stamps.filled', 7);
        $this->getJson('/api/admin/users')->assertOk()->assertJsonPath('data.0.stamps_total', 7);
    }

    public function test_profilbild_hochladen_und_entfernen(): void
    {
        Storage::fake('public');
        $user = $this->actingAsUser();

        $path = $this->post('/api/user/avatar', ['image' => UploadedFile::fake()->image('ich.jpg', 400, 400)], ['Accept' => 'application/json'])
            ->assertOk()
            ->json('user.avatar');
        $this->assertNotNull($path);
        $stored = $user->fresh()->avatar;
        Storage::disk('public')->assertExists($stored);

        $this->post('/api/user/avatar', ['image' => UploadedFile::fake()->create('virus.exe', 10)], ['Accept' => 'application/json'])
            ->assertStatus(422);

        $this->deleteJson('/api/user/avatar')->assertOk()->assertJsonPath('user.avatar', null);
        Storage::disk('public')->assertMissing($stored);
    }
}
