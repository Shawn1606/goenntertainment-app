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

    /**
     * Der Partner sieht nach dem Scan nur, was er fuer sich braucht: den Vornamen, ob gestempelt
     * wurde, den Stand der laufenden Karte und die Stempel und offenen Buchungen BEI IHM - nicht,
     * wann und bei welchen anderen Partnern die Person war, ihren Credit-Stand, ihre Club-Stufe
     * oder ihre Gruppen.
     */
    public function test_partner_sieht_nach_dem_scan_nur_seinen_teil(): void
    {
        $customer = $this->user(['name' => 'Lena Muster', 'club_plan' => 'gold']);
        $partner = $this->partner(['name' => 'Kletterhalle']);
        $elsewhere = $this->partner(['name' => 'Ganz woanders']);
        $offer = $this->offer($partner);
        $staff = $this->user();
        $partner->staff()->attach($staff->id, ['role' => 'staff', 'created_at' => now()]);

        Sanctum::actingAs($customer);
        $this->postJson('/api/checkins', ['token' => $elsewhere->checkin_token, 'method' => 'nfc'])->assertCreated();
        $group = $this->postJson('/api/groups', ['name' => 'Geheime Runde'])->assertCreated()->json('data');
        $this->postJson('/api/bookings', ['offer_id' => $offer->id, 'people' => 2, 'pay_method' => 'money', 'group_id' => $group['id']])->assertCreated();
        $pass = $this->getJson('/api/pass')->json('data.token');

        Sanctum::actingAs($staff);
        $data = $this->postJson('/api/partner/checkins', ['partner_id' => $partner->id, 'pass' => $pass])
            ->assertCreated()
            ->assertJsonPath('data.customer.first_name', 'Lena')
            ->assertJsonPath('data.stamped', true)
            ->assertJsonPath('data.stamps.filled', 2)
            ->assertJsonPath('data.stamps.fields', 10)
            ->json('data');

        $this->assertSame(['partner', 'stamped', 'bonus_stamp', 'reward_credits', 'stamps', 'open_bookings', 'customer'], array_keys($data));
        $this->assertSame(['filled', 'fields', 'remaining', 'stamps'], array_keys($data['stamps']));
        // Nur der Stempel von eben - der beim anderen Partner bleibt verborgen.
        $this->assertCount(1, $data['stamps']['stamps']);
        $this->assertSame($partner->id, $data['stamps']['stamps'][0]['partner']['id']);
        $this->assertStringNotContainsString('Ganz woanders', json_encode($data));
        $this->assertStringNotContainsString('Geheime Runde', json_encode($data));

        $this->assertCount(1, $data['open_bookings']);
        $this->assertSame('Lena', $data['open_bookings'][0]['customer']['first_name']);
        foreach (['group', 'plan_key', 'calendar_path'] as $key) {
            $this->assertArrayNotHasKey($key, $data['open_bookings'][0]);
        }

        // Dieselbe Sicht in der Liste des Partners.
        $listed = $this->getJson('/api/partner/bookings?partner_id='.$partner->id)->assertOk()->json('data.0');
        $this->assertSame('Lena', $listed['customer']['first_name']);
        foreach (['group', 'plan_key', 'calendar_path'] as $key) {
            $this->assertArrayNotHasKey($key, $listed);
        }
    }

    /** GET /api/stamps: die eigene Stempelkarte - nur angemeldet, nur die eigene. */
    public function test_stempelkarte_lesen(): void
    {
        $this->getJson('/api/stamps')->assertUnauthorized();

        $other = $this->user();
        $user = $this->actingAsUser();
        $partner = $this->partner(['name' => 'Café am Wall']);
        DB::table('stamps')->insert(['user_id' => $other->id, 'partner_id' => $partner->id, 'stamp_day' => '2026-10-01', 'created_at' => now()]);

        $this->getJson('/api/stamps')->assertOk()->assertJsonPath('data.total', 0)->assertJsonPath('data.stamps', []);

        $this->postJson('/api/checkins', ['token' => $partner->checkin_token, 'method' => 'qr'])->assertCreated();
        $this->getJson('/api/stamps')
            ->assertOk()
            ->assertJsonPath('data.total', 1)
            ->assertJsonPath('data.filled', 1)
            ->assertJsonPath('data.fields', 10)
            ->assertJsonPath('data.stamps.0.partner.name', 'Café am Wall');
        $this->assertSame(1, DB::table('stamps')->where('user_id', $user->id)->count());
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
