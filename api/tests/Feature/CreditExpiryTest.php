<?php

namespace Tests\Feature;

use App\Models\CreditLot;
use App\Models\CreditTransaction;
use App\Support\Wallet;

/**
 * Credits verfallen je Gutschrift: Free nach 365 Tagen, Gold nach 18, Platinum
 * nach 30 Monaten (shared/club.json, plans[].creditValidity). Ausgegeben wird
 * zuerst, was am fruehesten verfaellt.
 */
class CreditExpiryTest extends MarketplaceTestCase
{
    public function test_nur_der_alte_kauf_verfaellt_nicht_der_spaetere(): void
    {
        $user = $this->actingAsUser();

        // 1000 + 250 Bonus + 200 Erstkauf, kurz vor Ablauf noch 100 + 25 dazu.
        $this->postJson('/api/wallet/purchase', ['credits' => 1000])->assertCreated();
        $this->travel(360)->days();
        $this->postJson('/api/wallet/purchase', ['credits' => 100])->assertCreated();
        $this->assertSame(1575, $user->fresh()->credits_balance);

        // Tag 365 ist um: nur der erste Posten verfaellt.
        $this->travel(6)->days();
        $this->assertSame(1, Wallet::expireDue());
        $this->assertSame(125, $user->fresh()->credits_balance);

        $expired = CreditTransaction::where('kind', 'expired')->sole();
        $this->assertSame(-1450, $expired->amount);
        $this->assertStringStartsWith('Verfallen: 1.450 Credits vom ', $expired->description);

        // Der zweite Kauf gilt bis 365 Tage nach SEINEM Kauf.
        $this->travel(358)->days();
        Wallet::expireDue();
        $this->assertSame(125, $user->fresh()->credits_balance);

        $this->travel(2)->days();
        Wallet::expireDue();
        $this->assertSame(0, $user->fresh()->credits_balance);
    }

    public function test_ausgegeben_wird_zuerst_was_frueher_verfaellt(): void
    {
        $user = $this->actingAsUser();
        $this->postJson('/api/wallet/purchase', ['credits' => 1000])->assertCreated(); // 1450
        $this->travel(100)->days();
        $this->postJson('/api/wallet/purchase', ['credits' => 100])->assertCreated();  // 125

        Wallet::debit($user, 1500, 'booking', 'Test');

        [$old, $new] = CreditLot::orderBy('id')->get()->all();
        $this->assertSame(0, $old->remaining);
        $this->assertSame(75, $new->remaining);

        // Am Stichtag des ersten Postens verfaellt nichts mehr - er ist aufgebraucht.
        $this->travel(266)->days();
        Wallet::expireDue();
        $this->assertSame(75, $user->fresh()->credits_balance);
        $this->assertSame(0, CreditTransaction::where('kind', 'expired')->count());
    }

    public function test_verfallene_credits_lassen_sich_nicht_mehr_ausgeben(): void
    {
        $user = $this->actingAsUser();
        $offer = $this->offer($this->partner());
        $this->postJson('/api/wallet/purchase', ['credits' => 500])->assertCreated(); // 700

        // Ohne Zeitplan-Lauf: Die Buchung selbst bucht den Verfall aus.
        $this->travel(366)->days();
        $this->postJson('/api/bookings', ['offer_id' => $offer->id, 'people' => 1, 'pay_method' => 'credits'])
            ->assertStatus(422)
            ->assertJsonValidationErrors('credits');

        $this->getJson('/api/wallet')
            ->assertOk()
            ->assertJsonPath('data.balance', 0)
            ->assertJsonPath('data.lots', [])
            ->assertJsonPath('data.transactions.0.kind', 'expired');
    }

    public function test_storno_gibt_credits_mit_alter_frist_zurueck(): void
    {
        $user = $this->actingAsUser();
        $offer = $this->offer($this->partner());
        $this->postJson('/api/wallet/purchase', ['credits' => 500])->assertCreated(); // 700
        $lot = CreditLot::sole();

        $this->travel(10)->days();
        $booking = $this->postJson('/api/bookings', ['offer_id' => $offer->id, 'people' => 1, 'pay_method' => 'credits'])
            ->assertCreated()
            ->json('data');
        $this->postJson("/api/bookings/{$booking['id']}/cancel")->assertOk()->assertJsonPath('credits_balance', 700);

        // Kein neuer Posten: Die 450 sitzen wieder im alten, mit dessen Frist.
        $this->assertSame(1, CreditLot::count());
        $this->assertSame(700, $lot->fresh()->remaining);
    }

    public function test_storno_nach_verfall_gibt_eine_nachfrist(): void
    {
        $user = $this->actingAsUser();
        $offer = $this->offer($this->partner(), ['valid_days' => 400]);
        $this->postJson('/api/wallet/purchase', ['credits' => 500])->assertCreated(); // 700

        $booking = $this->postJson('/api/bookings', ['offer_id' => $offer->id, 'people' => 1, 'pay_method' => 'credits'])
            ->assertCreated()
            ->json('data');

        // Der Rest (250) verfaellt; die gebuchten 450 kommen danach zurueck.
        $this->travel(366)->days();
        Wallet::expireDue();
        $this->assertSame(0, $user->fresh()->credits_balance);

        $this->postJson("/api/bookings/{$booking['id']}/cancel")->assertOk()->assertJsonPath('credits_balance', 450);

        $grace = CreditLot::orderByDesc('id')->first();
        $this->assertSame(450, $grace->remaining);
        $this->assertTrue($grace->expires_at->between(now()->addDays(29), now()->addDays(31)));

        $this->travel(31)->days();
        Wallet::expireDue();
        $this->assertSame(0, $user->fresh()->credits_balance);
    }

    public function test_wallet_zeigt_was_wann_verfaellt(): void
    {
        $this->actingAsUser();
        $this->postJson('/api/wallet/purchase', ['credits' => 200])->assertCreated(); // 200 + 50 + 40

        $data = $this->getJson('/api/wallet')
            ->assertOk()
            ->assertJsonPath('data.validity_label', '365 Tage')
            ->assertJsonPath('data.lots.0.credits', 290)
            ->assertJsonPath('data.lots.0.amount', 290)
            ->assertJsonPath('data.lots.0.kind', 'purchase')
            ->json('data');

        $this->assertNotNull($data['transactions'][0]['expires_at']);
        $this->assertSame($data['lots'][0]['expires_at'], $data['transactions'][0]['expires_at']);

        $this->getJson('/api/club')->assertOk()->assertJsonPath('data.next_expiry.credits', 290);
    }

    public function test_monats_credits_verfallen_einzeln(): void
    {
        $user = $this->actingAsUser();
        $this->postJson('/api/club/subscribe', ['plan' => 'gold'])->assertOk()->assertJsonPath('data.credits', 42);

        $this->travel(32)->days();
        \App\Support\ClubMembership::renewDue();
        $this->assertSame(84, $user->fresh()->credits_balance);
        $this->assertSame(2, CreditLot::count());

        // Gold: 18 Monate nach der ersten Gutschrift verfaellt nur sie.
        $this->travel(17)->months();
        Wallet::expireDue();
        $this->assertSame(42, (int) CreditLot::sum('remaining'));
    }
}
