<?php

namespace Tests\Feature;

use App\Models\Booking;
use App\Models\CreditTransaction;
use App\Models\TestphaseChallenge;
use App\Models\User;
use App\Support\Bookings;
use App\Support\Wallet;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Testphase (nur Admins): Challenges, Stadt-Bingo, Check-in-Serie und das
 * Abholen der Belohnungen.
 */
class TestPhaseTest extends MarketplaceTestCase
{
    private function admin(array $attributes = []): User
    {
        return $this->actingAsUser(['is_admin' => true] + $attributes);
    }

    private function visit(User $user, int $partnerId, string $at): void
    {
        DB::table('stamps')->insert([
            'user_id' => $user->id,
            'partner_id' => $partnerId,
            'stamp_day' => Carbon::parse($at)->toDateString(),
            'created_at' => Carbon::parse($at),
        ]);
    }

    private function challenge(array $attributes): TestphaseChallenge
    {
        return TestphaseChallenge::create($attributes + [
            'type' => 'monthly',
            'title' => 'Test',
            'metric' => 'visits',
            'target' => 1,
            'reward_credits' => 50,
            'period' => 'month',
        ]);
    }

    public function test_nur_fuer_admins(): void
    {
        $this->actingAsUser();
        $this->getJson('/api/admin/testphase')->assertForbidden();
        $this->postJson('/api/admin/testphase/claim', ['key' => 'bingo:full'])->assertForbidden();
    }

    public function test_beispiele_decken_alle_arten_ab(): void
    {
        $this->admin();
        $this->partner(['name' => 'Bowling-Center Süd']);

        $data = $this->postJson('/api/admin/testphase/examples')->assertOk()->json('data');
        $types = collect($data['challenges'])->pluck('type')->unique()->sort()->values()->all();
        $this->assertSame(['group', 'monthly', 'partner', 'season', 'weekly'], $types);

        // Zweimal aufrufen legt nichts doppelt an.
        $this->postJson('/api/admin/testphase/examples')->assertOk()->assertJsonPath('created', 0);
    }

    public function test_bowling_challenge_zaehlt_besuche_und_bringt_credits_einmal(): void
    {
        Carbon::setTestNow('2026-10-14 15:00:00');
        $admin = $this->admin();
        $bowling = $this->partner(['name' => 'Bowling-Center Süd']);
        $cafe = $this->partner(['name' => 'Café am Wall']);
        $challenge = $this->challenge(['title' => 'Bowling', 'match_text' => 'bowling', 'target' => 2, 'reward_credits' => 150]);

        $this->visit($admin, $bowling->id, '2026-10-02 18:00');
        $this->visit($admin, $cafe->id, '2026-10-03 10:00');
        $this->visit($admin, $bowling->id, '2026-09-30 18:00'); // Vormonat zaehlt nicht

        $state = $this->getJson('/api/admin/testphase')->assertOk()->json('data');
        $c = collect($state['challenges'])->firstWhere('id', $challenge->id);
        $this->assertSame(1, $c['progress']);
        $this->assertFalse($c['claim']['claimable']);
        $this->postJson('/api/admin/testphase/claim', ['key' => 'challenge:'.$challenge->id])->assertStatus(422);

        $this->visit($admin, $bowling->id, '2026-10-09 18:00');
        $this->postJson('/api/admin/testphase/claim', ['key' => 'challenge:'.$challenge->id])
            ->assertOk()
            ->assertJsonPath('credits', 150)
            ->assertJsonPath('balance', 150);

        $this->assertSame('challenge', CreditTransaction::sole()->kind);
        $this->postJson('/api/admin/testphase/claim', ['key' => 'challenge:'.$challenge->id])->assertStatus(422);

        // Neuer Monat, neue Runde.
        Carbon::setTestNow('2026-11-02 12:00:00');
        $c = collect($this->getJson('/api/admin/testphase')->json('data.challenges'))->firstWhere('id', $challenge->id);
        $this->assertSame(0, $c['progress']);
        $this->assertFalse($c['claim']['claimed']);
    }

    public function test_softdrinks_ueber_eingeloeste_gratis_angebote(): void
    {
        $admin = $this->admin();
        $cafe = $this->partner(['name' => 'Café am Wall']);
        $softdrink = $this->offer($cafe, ['kind' => 'perk', 'title' => 'Softdrink gratis', 'price_cents' => null, 'price_credits' => 60]);
        $challenge = $this->challenge(['metric' => 'redeemed', 'match_text' => 'Softdrink', 'offer_kind' => 'perk', 'target' => 2]);
        Wallet::credit($admin, 500, 'admin', 'Test');

        for ($i = 0; $i < 2; $i++) {
            $id = $this->postJson('/api/bookings', ['offer_id' => $softdrink->id, 'people' => 1, 'pay_method' => 'credits'])->assertCreated()->json('data.id');
            // Gebucht allein zaehlt nicht - erst eingeloest.
            $progress = collect($this->getJson('/api/admin/testphase')->json('data.challenges'))->firstWhere('id', $challenge->id)['progress'];
            $this->assertSame($i, $progress);
            Bookings::redeem(Booking::findOrFail($id));
        }

        $c = collect($this->getJson('/api/admin/testphase')->json('data.challenges'))->firstWhere('id', $challenge->id);
        $this->assertSame(2, $c['progress']);
        $this->assertTrue($c['claim']['claimable']);
    }

    public function test_stufen_challenge_nur_fuer_die_stufe(): void
    {
        $admin = $this->admin();
        $partner = $this->partner();
        $challenge = $this->challenge(['plans' => ['platinum']]);
        $this->visit($admin, $partner->id, now()->toDateTimeString());

        $c = collect($this->getJson('/api/admin/testphase')->json('data.challenges'))->firstWhere('id', $challenge->id);
        $this->assertFalse($c['allowed']);
        $this->postJson('/api/admin/testphase/claim', ['key' => 'challenge:'.$challenge->id])->assertStatus(422);

        $admin->forceFill(['club_plan' => 'platinum'])->save();
        $this->postJson('/api/admin/testphase/claim', ['key' => 'challenge:'.$challenge->id])->assertOk();
    }

    public function test_gruppen_challenge_zaehlt_buchungen_aller_mitglieder(): void
    {
        $admin = $this->admin();
        $friend = $this->user();
        $groupId = DB::table('friend_groups')->insertGetId(['owner_id' => $friend->id, 'name' => 'Crew', 'invite_code' => 'CREW1234', 'created_at' => now(), 'updated_at' => now()]);
        DB::table('group_members')->insert([['group_id' => $groupId, 'user_id' => $admin->id], ['group_id' => $groupId, 'user_id' => $friend->id]]);
        $challenge = $this->challenge(['type' => 'group', 'metric' => 'group_bookings', 'target' => 2]);
        $offer = $this->offer($this->partner());

        $bookings = [];
        foreach ([$friend, $friend] as $booker) {
            $bookings[] = Booking::create([
                'code' => strtoupper(substr(md5((string) microtime(true).random_int(0, 9999)), 0, 8)),
                'user_id' => $booker->id, 'offer_id' => $offer->id, 'partner_id' => $offer->partner_id, 'group_id' => $groupId,
                'offer_title' => $offer->title, 'partner_name' => 'P', 'people' => 2, 'plan_key' => 'free', 'pay_method' => 'money',
                'status' => 'confirmed', 'valid_until' => now()->addDays(30),
            ]);
        }

        // Gebucht allein zaehlt nicht - offene Buchungen lassen sich noch stornieren.
        $c = collect($this->getJson('/api/admin/testphase')->json('data.challenges'))->firstWhere('id', $challenge->id);
        $this->assertSame(0, $c['progress']);

        foreach ($bookings as $booking) {
            Bookings::redeem($booking);
        }
        $c = collect($this->getJson('/api/admin/testphase')->json('data.challenges'))->firstWhere('id', $challenge->id);
        $this->assertSame(2, $c['progress']);
        $this->assertTrue($c['claim']['claimable']);
    }

    /**
     * Buchen, Belohnung abholen, stornieren - Belohnung behalten, Credits voll zurueck: Das geht
     * nicht mehr, weil Buchungen erst eingeloest zaehlen (Challenges wie Stadt-Bingo).
     */
    public function test_buchungen_zaehlen_erst_eingeloest_kein_buchen_abholen_stornieren(): void
    {
        $admin = $this->admin();
        $offer = $this->offer($this->partner());
        $challenge = $this->challenge(['metric' => 'bookings', 'target' => 1, 'reward_credits' => 40]);
        Wallet::credit($admin, 1000, 'admin', 'Test');
        $book = fn () => $this->postJson('/api/bookings', ['offer_id' => $offer->id, 'people' => 1, 'pay_method' => 'credits'])
            ->assertCreated()
            ->json('data.id');

        // Gebucht, aber offen: keine Belohnung - die Buchung liesse sich danach noch stornieren.
        $id = $book();
        $this->postJson('/api/admin/testphase/claim', ['key' => 'challenge:'.$challenge->id])->assertStatus(422);
        $this->postJson("/api/bookings/{$id}/cancel")->assertOk();
        $this->assertSame(1000, $admin->fresh()->credits_balance);

        // Erst eingeloest zaehlt sie - und dann laesst sie sich nicht mehr stornieren.
        $id = $book();
        Bookings::redeem(Booking::findOrFail($id));
        $this->postJson('/api/admin/testphase/claim', ['key' => 'challenge:'.$challenge->id])->assertOk()->assertJsonPath('credits', 40);
        $this->postJson("/api/bookings/{$id}/cancel")->assertStatus(422);
        $this->assertSame(1000 - 450 + 40, $admin->fresh()->credits_balance);
    }

    /** Dasselbe im Stadt-Bingo: Gruppen- und Credits-Buchung zaehlen erst eingeloest. */
    public function test_bingo_zaehlt_nur_eingeloeste_buchungen(): void
    {
        $admin = $this->admin();
        // Ein pausierter Partner bekommt kein Feld: So liegen alle acht Aufgaben aus.
        $offer = $this->offer($this->partner(['is_active' => false]));
        $groupId = DB::table('friend_groups')->insertGetId(['owner_id' => $admin->id, 'name' => 'Crew', 'invite_code' => 'CREW5678', 'created_at' => now(), 'updated_at' => now()]);
        $book = fn (string $status) => Booking::create([
            'code' => strtoupper(substr(md5((string) microtime(true).random_int(0, 9999)), 0, 8)),
            'user_id' => $admin->id, 'offer_id' => $offer->id, 'partner_id' => $offer->partner_id, 'group_id' => $groupId,
            'offer_title' => $offer->title, 'partner_name' => 'P', 'people' => 2, 'plan_key' => 'free', 'pay_method' => 'credits',
            'total_credits' => 900, 'status' => $status, 'redeemed_at' => $status === 'redeemed' ? now() : null, 'valid_until' => now()->addDays(30),
        ]);
        $done = fn (string $task) => collect($this->getJson('/api/admin/testphase')->json('data.bingo.cells'))->firstWhere('task', $task)['done'];

        $book('confirmed');
        $book('cancelled');
        $this->assertFalse($done('credits_booking'));
        $this->assertFalse($done('group_booking'));

        $book('redeemed');
        $this->assertTrue($done('credits_booking'));
        $this->assertTrue($done('group_booking'));
    }

    public function test_wochenmission_gilt_nur_diese_woche(): void
    {
        Carbon::setTestNow('2026-10-07 12:00:00'); // Mittwoch
        $admin = $this->admin();
        $partner = $this->partner();
        $challenge = $this->challenge(['type' => 'weekly', 'period' => 'week']);
        $this->visit($admin, $partner->id, '2026-10-04 12:00'); // Sonntag davor

        $c = collect($this->getJson('/api/admin/testphase')->json('data.challenges'))->firstWhere('id', $challenge->id);
        $this->assertSame(0, $c['progress']);
        $this->assertSame('KW 41', $c['period_label']);

        $this->visit($admin, $partner->id, '2026-10-05 09:00'); // Montag
        $c = collect($this->getJson('/api/admin/testphase')->json('data.challenges'))->firstWhere('id', $challenge->id);
        $this->assertSame(1, $c['progress']);
    }

    public function test_bingo_feld_mit_joker_und_partnern(): void
    {
        $admin = $this->admin();
        $partners = collect(range(1, 7))->map(fn ($i) => $this->partner(['name' => "Partner {$i}"]));

        $bingo = $this->getJson('/api/admin/testphase')->assertOk()->json('data.bingo');
        $this->assertCount(9, $bingo['cells']);
        $this->assertSame('joker', $bingo['cells'][4]['kind']);
        $this->assertTrue($bingo['cells'][4]['done']);
        $partnerCells = collect($bingo['cells'])->where('kind', 'partner');
        $this->assertCount(6, $partnerCells);
        $this->assertCount(2, collect($bingo['cells'])->where('kind', 'task'));

        // Dasselbe Feld beim naechsten Laden.
        $this->assertSame($bingo['cells'], $this->getJson('/api/admin/testphase')->json('data.bingo.cells'));

        foreach ($partnerCells as $cell) {
            $this->visit($admin, $cell['partner_id'], now()->toDateTimeString());
        }
        $bingo = $this->getJson('/api/admin/testphase')->json('data.bingo');
        foreach ($bingo['lines'] as $line) {
            $allDone = collect($line['cells'])->every(fn ($i) => $bingo['cells'][$i]['done']);
            $this->assertSame($allDone, $line['done']);
            $this->assertSame($allDone, $line['claim']['claimable']);
        }

        $done = collect($bingo['lines'])->firstWhere('done', true);
        if ($done !== null) {
            $this->postJson('/api/admin/testphase/claim', ['key' => 'bingo:line:'.$done['index']])->assertOk()->assertJsonPath('credits', 50);
        }
        // The two task cells are drawn per account id and period, and the visits above complete
        // some of them (two partners in one day, a first visit): whether the board is full depends
        // on the draw, so the claim is checked against the board.
        $full = collect($bingo['cells'])->every(fn ($cell) => $cell['done']);
        $claim = $this->postJson('/api/admin/testphase/claim', ['key' => 'bingo:full']);
        $full ? $claim->assertOk() : $claim->assertStatus(422);
        unset($partners);
    }

    public function test_serie_zaehlt_wochen_und_platinum_hat_einen_joker(): void
    {
        Carbon::setTestNow('2026-10-07 12:00:00'); // KW 41
        $partner = $this->partner();
        $free = $this->admin();
        foreach (['2026-09-16', '2026-09-23', '2026-10-07'] as $day) { // KW 38, 39, (40 fehlt), 41
            $this->visit($free, $partner->id, $day.' 10:00');
        }

        $this->getJson('/api/admin/testphase')->assertJsonPath('data.streak.weeks', 1);

        $free->forceFill(['club_plan' => 'platinum'])->save();
        $this->getJson('/api/admin/testphase')
            ->assertJsonPath('data.streak.weeks', 3)
            ->assertJsonPath('data.streak.joker_used', true);
    }

    public function test_serie_vier_wochen_meilenstein(): void
    {
        Carbon::setTestNow('2026-10-07 12:00:00');
        $admin = $this->admin();
        $partner = $this->partner();
        foreach (['2026-09-16', '2026-09-23', '2026-09-30'] as $day) {
            $this->visit($admin, $partner->id, $day.' 10:00');
        }

        // Diese Woche noch kein Besuch: Serie laeuft (3), ist aber in Gefahr.
        $this->getJson('/api/admin/testphase')
            ->assertJsonPath('data.streak.weeks', 3)
            ->assertJsonPath('data.streak.at_risk', true);

        $this->visit($admin, $partner->id, '2026-10-06 10:00');
        $this->getJson('/api/admin/testphase')->assertJsonPath('data.streak.weeks', 4);
        $this->postJson('/api/admin/testphase/claim', ['key' => 'streak:4'])->assertOk()->assertJsonPath('credits', 50);
        $this->postJson('/api/admin/testphase/claim', ['key' => 'streak:8'])->assertStatus(422);
    }

    public function test_challenge_anlegen_und_loeschen(): void
    {
        $this->admin();
        $this->postJson('/api/admin/testphase/challenges', ['type' => 'season', 'title' => 'Winter', 'metric' => 'visits', 'target' => 3, 'reward_credits' => 80, 'period' => 'range'])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['starts_at', 'ends_at']);

        $id = $this->postJson('/api/admin/testphase/challenges', [
            'type' => 'season', 'title' => 'Winter', 'metric' => 'visits', 'target' => 3, 'reward_credits' => 80,
            'period' => 'range', 'starts_at' => '2026-12-01', 'ends_at' => '2027-02-28', 'plans' => ['gold'],
        ])->assertCreated()->json('id');

        $this->assertSame(['gold'], TestphaseChallenge::findOrFail($id)->plans);
        $this->deleteJson("/api/admin/testphase/challenges/{$id}")->assertOk();
        $this->assertSame(0, TestphaseChallenge::count());
    }
}
