<?php

namespace Tests\Feature;

use App\Models\CreditLot;
use App\Models\CreditTransaction;
use App\Models\Stamp;
use App\Support\Checkins;
use App\Support\ClubMembership;
use App\Support\Wallet;

/**
 * Was die Stufen ueber den Rabatt hinaus bringen: laengere Gueltigkeit der
 * Credits, mehr Credits fuer die volle Stempelkarte, die goldene Karte - und
 * der doppelte Stempel beim ersten Besuch (Testphase, nur Admins).
 */
class ClubPlanBenefitsTest extends MarketplaceTestCase
{
    public function test_gueltigkeit_haengt_an_der_stufe(): void
    {
        $this->freezeSecond();
        $free = $this->user();
        $gold = $this->user(['club_plan' => 'gold']);
        $platinum = $this->user(['club_plan' => 'platinum']);

        foreach ([$free, $gold, $platinum] as $user) {
            Wallet::credit($user, 100, 'admin', 'Test');
        }

        $this->assertTrue(CreditLot::where('user_id', $free->id)->sole()->expires_at->equalTo(now()->addDays(365)));
        $this->assertTrue(CreditLot::where('user_id', $gold->id)->sole()->expires_at->equalTo(now()->addMonthsNoOverflow(18)));
        $this->assertTrue(CreditLot::where('user_id', $platinum->id)->sole()->expires_at->equalTo(now()->addMonthsNoOverflow(30)));
    }

    public function test_upgrade_verlaengert_offene_credits_kuendigung_kuerzt_nicht(): void
    {
        $user = $this->actingAsUser();
        Wallet::credit($user, 100, 'admin', 'Vorher als Free');
        $lot = CreditLot::sole();
        $this->assertTrue($lot->expires_at->equalTo($lot->created_at->copy()->addDays(365)));

        $this->postJson('/api/club/subscribe', ['plan' => 'platinum'])->assertOk();
        $this->assertTrue($lot->fresh()->expires_at->equalTo($lot->created_at->copy()->addMonthsNoOverflow(30)));
        $this->getJson('/api/wallet')->assertJsonPath('data.validity_label', '30 Monate');

        // Kuendigen und auslaufen lassen: die Frist bleibt, wie sie war.
        $this->postJson('/api/club/cancel')->assertOk();
        $this->travel(32)->days();
        ClubMembership::renewDue();
        $this->assertSame('free', $user->fresh()->club_plan);
        $this->assertTrue($lot->fresh()->expires_at->equalTo($lot->created_at->copy()->addMonthsNoOverflow(30)));
    }

    public function test_stempelkarte_bringt_je_stufe_mehr_und_jede_fuenfte_ist_golden(): void
    {
        $free = $this->user();
        $gold = $this->user(['club_plan' => 'gold']);
        $platinum = $this->user(['club_plan' => 'platinum']);

        // Fuenf volle Karten auf einmal: vier normale, die fuenfte golden (x1,5).
        $this->assertSame(4 * 100 + 150, Checkins::adjust($free, 50)['reward_credits']);
        $this->assertSame(4 * 125 + 188, Checkins::adjust($gold, 50)['reward_credits']);
        $this->assertSame(4 * 150 + 225, Checkins::adjust($platinum, 50)['reward_credits']);

        $this->assertSame(550, $free->fresh()->credits_balance);
        $this->assertStringStartsWith('Goldene Stempelkarte voll', CreditTransaction::where('user_id', $gold->id)->latest('id')->first()->description);
    }

    public function test_karte_zeigt_belohnung_und_goldene_karte(): void
    {
        $user = $this->actingAsUser(['club_plan' => 'gold']);

        $this->getJson('/api/club')
            ->assertJsonPath('data.stamps.reward_credits', 125)
            ->assertJsonPath('data.stamps.golden', false)
            ->assertJsonPath('data.stamps.golden_every', 5)
            ->assertJsonPath('data.stamps.cards_until_golden', 4);

        Checkins::adjust($user, 40);
        $this->getJson('/api/club')
            ->assertJsonPath('data.stamps.completed_cards', 4)
            ->assertJsonPath('data.stamps.reward_credits', 188)
            ->assertJsonPath('data.stamps.golden', true)
            ->assertJsonPath('data.stamps.cards_until_golden', 0);
    }

    public function test_volle_karte_beim_besuch_zahlt_den_wert_der_stufe(): void
    {
        $user = $this->actingAsUser(['club_plan' => 'platinum']);
        Checkins::adjust($user, 9);
        $this->assertSame(0, $user->fresh()->credits_balance);

        $this->postJson('/api/checkins', ['token' => $this->partner()->checkin_token, 'method' => 'nfc'])
            ->assertCreated()
            ->assertJsonPath('data.reward_credits', 150)
            ->assertJsonPath('data.credits', 150);
    }

    public function test_testphase_erster_besuch_doppelter_stempel_nur_fuer_admins(): void
    {
        $partner = $this->partner();

        $this->actingAsUser();
        $this->postJson('/api/checkins', ['token' => $partner->checkin_token, 'method' => 'nfc'])
            ->assertJsonPath('data.bonus_stamp', false)
            ->assertJsonPath('data.stamps.filled', 1);

        $admin = $this->actingAsUser(['is_admin' => true]);
        $this->postJson('/api/checkins', ['token' => $partner->checkin_token, 'method' => 'nfc'])
            ->assertJsonPath('data.bonus_stamp', true)
            ->assertJsonPath('data.stamps.filled', 2);

        // Zweiter Besuch beim selben Partner: wieder normal.
        $this->travel(1)->days();
        $this->postJson('/api/checkins', ['token' => $partner->checkin_token, 'method' => 'nfc'])
            ->assertJsonPath('data.bonus_stamp', false)
            ->assertJsonPath('data.stamps.filled', 3);

        $this->assertSame(3, Stamp::where('user_id', $admin->id)->count());
    }
}
