<?php

namespace Tests\Feature;

use App\Models\CreditTransaction;
use App\Models\User;
use App\Models\VoucherBatch;
use App\Support\ClubMembership;
use App\Support\Codes;
use App\Support\Vouchers;

class ClubWalletTest extends MarketplaceTestCase
{
    public function test_club_stand_fuer_neues_konto(): void
    {
        $this->actingAsUser();

        $this->getJson('/api/club')
            ->assertOk()
            ->assertJsonPath('data.plan', 'free')
            ->assertJsonPath('data.plan_name', 'Free Plan')
            ->assertJsonPath('data.credits', 0)
            ->assertJsonPath('data.stamps.filled', 0)
            ->assertJsonPath('data.stamps.fields', 10)
            ->assertJsonPath('data.packs.0.credits', 50)
            ->assertJsonPath('data.packs.0.price_cents', 375)
            ->assertJsonCount(3, 'data.plans');

        $this->getJson('/api/user')->assertJsonPath('user.club_plan', 'free')->assertJsonPath('user.credits_balance', 0);
    }

    public function test_gold_abschliessen_bringt_monats_credits_und_kuendigung_laeuft_aus(): void
    {
        $user = $this->actingAsUser();

        $this->postJson('/api/club/subscribe', ['plan' => 'gold'])
            ->assertOk()
            ->assertJsonPath('data.plan', 'gold')
            ->assertJsonPath('data.credits', 42);

        $this->postJson('/api/club/subscribe', ['plan' => 'gold'])->assertStatus(422);
        $this->postJson('/api/club/subscribe', ['plan' => 'free'])->assertStatus(422);

        $this->postJson('/api/club/cancel')->assertOk()->assertJsonPath('data.cancel_at_period_end', true);

        // Kuendigung zuruecknehmen kostet nichts extra.
        $this->postJson('/api/club/subscribe', ['plan' => 'gold'])->assertOk()->assertJsonPath('data.credits', 42);
        $this->postJson('/api/club/cancel')->assertOk();

        $this->travel(32)->days();
        ClubMembership::renewDue();
        $this->assertSame('free', $user->fresh()->club_plan);
    }

    public function test_verlaengerung_bucht_ab_und_schreibt_credits_gut(): void
    {
        $user = $this->actingAsUser();
        $this->postJson('/api/club/subscribe', ['plan' => 'platinum'])->assertOk()->assertJsonPath('data.credits', 83);

        $this->travel(32)->days();
        $this->assertSame(1, ClubMembership::renewDue());

        $fresh = $user->fresh();
        $this->assertSame('platinum', $fresh->club_plan);
        $this->assertSame(166, $fresh->credits_balance);
        $this->assertTrue($fresh->club_renews_at->isFuture());
    }

    public function test_gutschein_einmal_einloesbar(): void
    {
        $batch = VoucherBatch::create(['label' => 'Test', 'retailer' => 'REWE', 'credits' => 100, 'quantity' => 2]);
        Vouchers::generate($batch);
        $code = $batch->vouchers()->first()->code;

        $user = $this->actingAsUser();

        $this->postJson('/api/wallet/redeem', ['code' => 'falsch'])->assertStatus(422)->assertJsonValidationErrors('code');
        $this->postJson('/api/wallet/redeem', ['code' => strtolower(Codes::format($code))])
            ->assertCreated()
            ->assertJsonPath('data.balance', 100);
        $this->postJson('/api/wallet/redeem', ['code' => $code])
            ->assertStatus(422)
            ->assertJsonPath('message', 'Den hast du schon eingelöst – die Credits sind auf deinem Konto.');

        $this->assertSame(100, $user->fresh()->credits_balance);
        $this->getJson('/api/wallet')->assertJsonPath('data.transactions.0.kind', 'voucher');
    }

    public function test_abgelaufener_gutschein(): void
    {
        $batch = VoucherBatch::create(['label' => 'Alt', 'credits' => 50, 'quantity' => 1, 'expires_at' => now()->addDay()]);
        Vouchers::generate($batch);
        $this->travel(2)->days();

        $this->actingAsUser();
        $this->postJson('/api/wallet/redeem', ['code' => $batch->vouchers()->first()->code])
            ->assertStatus(422)
            ->assertJsonPath('message', 'Dieser Gutschein ist abgelaufen.');
    }

    public function test_nur_bekannte_pakete(): void
    {
        $this->actingAsUser();
        $this->postJson('/api/wallet/purchase', ['credits' => 77])->assertStatus(422);
        // 1000 + 250 Mengenbonus + 200 Erstkauf-Bonus (shared/club.json).
        $this->getJson('/api/wallet')->assertJsonPath('data.first_purchase_bonus_percent', 20);
        $this->postJson('/api/wallet/purchase', ['credits' => 1000])
            ->assertCreated()
            ->assertJsonPath('data.balance', 1450)
            ->assertJsonPath('data.bonus', 250)
            ->assertJsonPath('data.first_purchase_bonus', 200);
        $this->assertSame(1450, User::sole()->credits_balance);
        $this->assertSame('1.000 Credits + 250 Bonus + 200 Erstkauf-Bonus gekauft', CreditTransaction::sole()->description);

        // Der Erstkauf-Bonus gilt nur einmal.
        $this->getJson('/api/wallet')->assertJsonPath('data.first_purchase_bonus_percent', 0);
        $this->postJson('/api/wallet/purchase', ['credits' => 1000])
            ->assertCreated()
            ->assertJsonPath('data.balance', 2700)
            ->assertJsonPath('data.first_purchase_bonus', 0);
    }

    public function test_kleinstes_paket_hat_keinen_mengenbonus(): void
    {
        $this->actingAsUser();
        $this->postJson('/api/wallet/purchase', ['credits' => 50])
            ->assertCreated()
            ->assertJsonPath('data.balance', 60)
            ->assertJsonPath('data.bonus', 0)
            ->assertJsonPath('data.first_purchase_bonus', 10);
        $this->assertSame('50 Credits + 10 Erstkauf-Bonus gekauft', CreditTransaction::sole()->description);
    }
}
