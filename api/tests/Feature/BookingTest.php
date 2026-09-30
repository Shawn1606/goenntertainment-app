<?php

namespace Tests\Feature;

use App\Models\Booking;
use App\Models\Payment;

class BookingTest extends MarketplaceTestCase
{
    public function test_angebote_liste_zeigt_nur_aktive_bei_aktiven_partnern(): void
    {
        $this->actingAsUser();
        $active = $this->partner();
        $paused = $this->partner(['is_active' => false]);
        $this->offer($active, ['title' => 'Sichtbar']);
        $this->offer($active, ['title' => 'Aus', 'is_active' => false]);
        $this->offer($paused, ['title' => 'Partner pausiert']);

        $this->getJson('/api/offers')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.title', 'Sichtbar')
            ->assertJsonPath('data.0.partner.name', $active->name)
            ->assertJsonMissingPath('data.0.partner.checkin_token');
    }

    public function test_gold_zu_zweit_bezahlt_mit_rabatt(): void
    {
        $user = $this->actingAsUser(['club_plan' => 'gold']);
        $offer = $this->offer($this->partner());

        $this->postJson("/api/offers/{$offer->id}/quote", ['people' => 2, 'pay_method' => 'money'])
            ->assertOk()
            ->assertJsonPath('data.discount_percent', 17.5)
            ->assertJsonPath('data.total_cents', 4948);

        $this->postJson('/api/bookings', ['offer_id' => $offer->id, 'people' => 2, 'pay_method' => 'money'])
            ->assertCreated()
            ->assertJsonPath('data.status', 'confirmed')
            ->assertJsonPath('data.total_cents', 4948)
            ->assertJsonPath('data.plan_key', 'gold');

        $payment = Payment::where('user_id', $user->id)->sole();
        $this->assertSame('test', $payment->provider);
        $this->assertSame(4948, $payment->amount_cents);
    }

    public function test_mit_credits_nur_wenn_genug_da_und_storno_bringt_sie_zurueck(): void
    {
        $user = $this->actingAsUser();
        $offer = $this->offer($this->partner());

        $this->postJson('/api/bookings', ['offer_id' => $offer->id, 'people' => 1, 'pay_method' => 'credits'])
            ->assertStatus(422)
            ->assertJsonValidationErrors('credits');

        $this->postJson('/api/wallet/purchase', ['credits' => 500])->assertCreated()->assertJsonPath('data.balance', 500);

        $booking = $this->postJson('/api/bookings', ['offer_id' => $offer->id, 'people' => 1, 'pay_method' => 'credits'])
            ->assertCreated()
            ->assertJsonPath('data.total_credits', 450)
            ->assertJsonPath('credits_balance', 50)
            ->json('data');

        $this->postJson("/api/bookings/{$booking['id']}/cancel")
            ->assertOk()
            ->assertJsonPath('data.status', 'cancelled')
            ->assertJsonPath('credits_balance', 500);

        $this->postJson("/api/bookings/{$booking['id']}/cancel")->assertStatus(422);
        $this->assertSame(500, $user->fresh()->credits_balance);
    }

    public function test_grenzen_des_angebots_gelten(): void
    {
        $this->actingAsUser();
        $offer = $this->offer($this->partner(), ['min_people' => 2, 'max_people' => 6, 'price_credits' => null]);

        $this->postJson('/api/bookings', ['offer_id' => $offer->id, 'people' => 1, 'pay_method' => 'money'])
            ->assertStatus(422)->assertJsonValidationErrors('people');
        $this->postJson('/api/bookings', ['offer_id' => $offer->id, 'people' => 7, 'pay_method' => 'money'])
            ->assertStatus(422)->assertJsonValidationErrors('people');
        $this->postJson('/api/bookings', ['offer_id' => $offer->id, 'people' => 2, 'pay_method' => 'credits'])
            ->assertStatus(422)->assertJsonValidationErrors('pay_method');
    }

    public function test_fremde_buchungen_gibt_es_nicht(): void
    {
        $owner = $this->user();
        $offer = $this->offer($this->partner());
        $booking = Booking::create([
            'code' => 'ABCDEFGH', 'user_id' => $owner->id, 'offer_id' => $offer->id, 'partner_id' => $offer->partner_id,
            'offer_title' => 'x', 'partner_name' => 'y', 'people' => 1, 'plan_key' => 'free', 'pay_method' => 'money',
            'valid_until' => now()->addDay(),
        ]);

        $this->actingAsUser();
        $this->getJson("/api/bookings/{$booking->id}")->assertNotFound();
        $this->postJson("/api/bookings/{$booking->id}/cancel")->assertNotFound();
    }

    public function test_ohne_freigeschaltete_zahlung_wird_nichts_abgebucht(): void
    {
        config(['club.payments' => 'off']);
        $this->actingAsUser();
        $offer = $this->offer($this->partner());

        $this->postJson('/api/bookings', ['offer_id' => $offer->id, 'people' => 1, 'pay_method' => 'money'])->assertStatus(503);
        $this->postJson('/api/wallet/purchase', ['credits' => 100])->assertStatus(503);
        $this->assertSame(0, Booking::count());
    }

    public function test_einloesen_am_aufkleber_braucht_den_richtigen_partner(): void
    {
        $this->actingAsUser();
        $partner = $this->partner();
        $other = $this->partner();
        $offer = $this->offer($partner);

        $booking = $this->postJson('/api/bookings', ['offer_id' => $offer->id, 'people' => 1, 'pay_method' => 'money'])->json('data');

        $this->postJson("/api/bookings/{$booking['id']}/redeem", ['token' => $other->checkin_token])->assertStatus(422);
        $this->postJson("/api/bookings/{$booking['id']}/redeem", ['token' => 'https://goe4fun.de/c/'.$partner->checkin_token])
            ->assertOk()
            ->assertJsonPath('data.status', 'redeemed');
        $this->postJson("/api/bookings/{$booking['id']}/redeem", ['token' => $partner->checkin_token])->assertStatus(422);
    }
}
