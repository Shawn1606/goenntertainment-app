<?php

namespace Tests\Feature;

use App\Support\Pass;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;

class CheckinTest extends MarketplaceTestCase
{
    public function test_ein_stempel_pro_partner_und_tag(): void
    {
        $this->actingAsUser();
        $partner = $this->partner();

        $this->postJson('/api/checkins', ['token' => $partner->checkin_token, 'method' => 'nfc'])
            ->assertCreated()
            ->assertJsonPath('data.stamped', true)
            ->assertJsonPath('data.stamps.filled', 1);

        $this->postJson('/api/checkins', ['token' => $partner->checkin_token, 'method' => 'qr'])
            ->assertCreated()
            ->assertJsonPath('data.stamped', false)
            ->assertJsonPath('data.stamps.filled', 1);

        $this->travel(1)->days();
        $this->postJson('/api/checkins', ['token' => $partner->checkin_token, 'method' => 'nfc'])
            ->assertJsonPath('data.stamped', true)
            ->assertJsonPath('data.stamps.filled', 2);

        $this->assertSame(3, DB::table('checkins')->count());
    }

    public function test_zehn_stempel_bringen_hundert_credits(): void
    {
        $user = $this->actingAsUser();

        for ($i = 1; $i <= 10; $i++) {
            $response = $this->postJson('/api/checkins', ['token' => $this->partner()->checkin_token, 'method' => 'nfc']);
        }

        $response->assertJsonPath('data.reward_credits', 100)
            ->assertJsonPath('data.stamps.filled', 0)
            ->assertJsonPath('data.stamps.completed_cards', 1)
            ->assertJsonPath('data.credits', 100);
        $this->assertSame(100, $user->fresh()->credits_balance);
    }

    public function test_unbekannter_aufkleber_und_link_formate(): void
    {
        $this->actingAsUser();
        $partner = $this->partner();

        $this->postJson('/api/checkins', ['token' => 'nichtda1234567890abc', 'method' => 'nfc'])->assertStatus(422);
        $this->postJson('/api/checkins', ['token' => 'goenntertainmentapp://checkin/'.$partner->checkin_token, 'method' => 'qr'])
            ->assertCreated();
    }

    public function test_standort_muss_passen_wenn_der_partner_einen_hat(): void
    {
        config(['club.checkin_radius_m' => 400]);
        $this->actingAsUser();
        $partner = $this->partner(['lat' => 51.5413, 'lng' => 9.9158]);

        $this->postJson('/api/checkins', ['token' => $partner->checkin_token, 'method' => 'nfc'])
            ->assertStatus(422)->assertJsonValidationErrors('location');
        $this->postJson('/api/checkins', ['token' => $partner->checkin_token, 'method' => 'nfc', 'lat' => 52.52, 'lng' => 13.405])
            ->assertStatus(422)->assertJsonValidationErrors('location');
        $this->postJson('/api/checkins', ['token' => $partner->checkin_token, 'method' => 'nfc', 'lat' => 51.5415, 'lng' => 9.9160])
            ->assertCreated();
    }

    public function test_partner_scannt_den_pass(): void
    {
        $customer = $this->user(['name' => 'Lena Muster']);
        $partner = $this->partner();
        $offer = $this->offer($partner);
        $staff = $this->user();
        $partner->staff()->attach($staff->id, ['role' => 'staff', 'created_at' => now()]);

        Sanctum::actingAs($customer);
        $booking = $this->postJson('/api/bookings', ['offer_id' => $offer->id, 'people' => 2, 'pay_method' => 'money'])->json('data');
        $pass = $this->getJson('/api/pass')->assertOk()->json('data.token');

        // Wer nicht fuer den Partner freigeschaltet ist, scannt nicht.
        $this->postJson('/api/partner/checkins', ['partner_id' => $partner->id, 'pass' => $pass])->assertForbidden();

        Sanctum::actingAs($staff);
        $this->getJson('/api/partner/me')->assertJsonPath('data.0.id', $partner->id);
        $this->postJson('/api/partner/checkins', ['partner_id' => $partner->id, 'pass' => $pass.'x'])->assertStatus(422);

        $this->postJson('/api/partner/checkins', ['partner_id' => $partner->id, 'pass' => $pass])
            ->assertCreated()
            ->assertJsonPath('data.stamped', true)
            ->assertJsonPath('data.customer.first_name', 'Lena')
            ->assertJsonPath('data.open_bookings.0.id', $booking['id'])
            ->assertJsonMissingPath('data.credits');

        $this->postJson("/api/partner/bookings/{$booking['id']}/redeem")->assertOk()->assertJsonPath('data.status', 'redeemed');
        $this->getJson('/api/partner/bookings?partner_id='.$partner->id)->assertJsonPath('data.0.status', 'redeemed');
    }

    public function test_pass_laeuft_ab(): void
    {
        $user = $this->user();
        $token = Pass::issue($user)['token'];
        $this->assertSame($user->id, Pass::verify($token));

        $this->travel(3)->minutes();
        $this->assertNull(Pass::verify($token));
        $this->assertNull(Pass::verify('GP1.1.9999999999.abc'));
    }
}
