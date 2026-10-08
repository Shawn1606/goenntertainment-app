<?php

namespace Tests\Feature;

use App\Models\Booking;
use App\Models\TestphaseChallenge;
use App\Models\User;
use App\Support\Bookings;
use App\Support\Wallet;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Weitere Ideen in der Testphase: geheime Challenges (11), Challenges mit Wahl
 * (13), Happy Hour (21), Rueckmeldungen (30), reservierte Kontingente (36),
 * Wunschliste (45), Treuestufen (52), Sammelalbum (55), Kosten teilen (62),
 * Abstimmungen (64).
 */
class TestPhaseMoreTest extends MarketplaceTestCase
{
    private function admin(array $attributes = []): User
    {
        return $this->actingAsUser(['is_admin' => true] + $attributes);
    }

    private function visit(User $user, int $partnerId, string $at): void
    {
        DB::table('stamps')->insert(['user_id' => $user->id, 'partner_id' => $partnerId, 'stamp_day' => Carbon::parse($at)->toDateString(), 'created_at' => Carbon::parse($at)]);
    }

    private function challenge(array $attributes): TestphaseChallenge
    {
        return TestphaseChallenge::create($attributes + ['type' => 'monthly', 'title' => 'Test', 'metric' => 'visits', 'target' => 1, 'reward_credits' => 50, 'period' => 'month']);
    }

    private function group(User $owner, array $members): int
    {
        $id = DB::table('friend_groups')->insertGetId(['owner_id' => $owner->id, 'name' => 'Crew', 'invite_code' => strtoupper(substr(md5(uniqid('', true)), 0, 8)), 'created_at' => now(), 'updated_at' => now()]);
        foreach ([$owner, ...$members] as $m) {
            DB::table('group_members')->insert(['group_id' => $id, 'user_id' => $m->id]);
        }

        return $id;
    }

    public function test_geheime_challenge_zeigt_sich_erst_wenn_geschafft(): void
    {
        $admin = $this->admin();
        $partner = $this->partner();
        $c = $this->challenge(['title' => 'Nachteule', 'description' => 'Geheim!', 'is_secret' => true, 'match_text' => 'Bowling']);

        $row = collect($this->getJson('/api/admin/testphase')->json('data.challenges'))->firstWhere('id', $c->id);
        $this->assertSame('Geheime Challenge', $row['title']);
        $this->assertFalse($row['revealed']);
        $this->assertNull($row['match_text']);

        $c->update(['match_text' => null]);
        $this->visit($admin, $partner->id, now()->toDateTimeString());
        $row = collect($this->getJson('/api/admin/testphase')->json('data.challenges'))->firstWhere('id', $c->id);
        $this->assertSame('Nachteule', $row['title']);
        $this->assertTrue($row['revealed']);
        $this->assertTrue($row['claim']['claimable']);
    }

    public function test_challenges_mit_wahl_hoechstens_drei_und_nur_gewaehlte_zaehlen(): void
    {
        $admin = $this->admin();
        $partner = $this->partner();
        $choices = collect(range(1, 4))->map(fn ($i) => $this->challenge(['title' => "Wahl {$i}", 'is_choice' => true]));
        $this->visit($admin, $partner->id, now()->toDateTimeString());

        // Geschafft, aber nicht gewaehlt: nicht abholbar.
        $this->postJson('/api/admin/testphase/claim', ['key' => 'challenge:'.$choices[0]->id])->assertStatus(422);

        foreach ($choices->take(3) as $c) {
            $this->postJson('/api/admin/testphase/choose', ['challenge_id' => $c->id])->assertOk();
        }
        $this->postJson('/api/admin/testphase/choose', ['challenge_id' => $choices[3]->id])->assertStatus(422);

        $this->postJson('/api/admin/testphase/claim', ['key' => 'challenge:'.$choices[0]->id])->assertOk();
        // Abgeholte bleibt gewaehlt, andere lassen sich abwaehlen.
        $this->postJson('/api/admin/testphase/choose', ['challenge_id' => $choices[0]->id])->assertStatus(422);
        $this->postJson('/api/admin/testphase/choose', ['challenge_id' => $choices[1]->id])->assertOk();
        $this->postJson('/api/admin/testphase/choose', ['challenge_id' => $choices[3]->id])->assertOk();
        unset($admin);
    }

    public function test_happy_hour_nur_fuer_admins_im_club_an_ruhigen_tagen(): void
    {
        Carbon::setTestNow('2026-10-05 12:00:00'); // Montag
        $offer = $this->offer($this->partner(), ['price_credits' => 100]);
        $tuesday = '2026-10-06';
        $saturday = '2026-10-10';

        $gold = $this->user(['club_plan' => 'gold', 'is_admin' => true]);
        $this->assertSame(15.0, Bookings::quote($gold, $offer, 1, 'credits', $tuesday)['happy_hour_percent']);
        // 100 - 5 % Club = 95, dann -15 % = 80,75 -> 81
        $this->assertSame(81, Bookings::quote($gold, $offer, 1, 'credits', $tuesday)['total_credits']);
        $this->assertSame(95, Bookings::quote($gold, $offer, 1, 'credits', $saturday)['total_credits']);

        $platinum = $this->user(['club_plan' => 'platinum', 'is_admin' => true]);
        $this->assertSame(72, Bookings::quote($platinum, $offer, 1, 'credits', $tuesday)['total_credits']);

        $notAdmin = $this->user(['club_plan' => 'platinum']);
        $this->assertSame(90, Bookings::quote($notAdmin, $offer, 1, 'credits', $tuesday)['total_credits']);
        $free = $this->user(['is_admin' => true]);
        $this->assertSame(100, Bookings::quote($free, $offer, 1, 'credits', $tuesday)['total_credits']);
    }

    public function test_rueckmeldung_nach_dem_einloesen_bringt_credits_einmal(): void
    {
        $admin = $this->admin();
        $offer = $this->offer($this->partner());
        $id = $this->postJson('/api/bookings', ['offer_id' => $offer->id, 'people' => 1, 'pay_method' => 'money'])->json('data.id');

        $this->postJson("/api/bookings/{$id}/feedback", ['rating' => 5])->assertStatus(422);
        Bookings::redeem(Booking::findOrFail($id));

        $this->postJson("/api/bookings/{$id}/feedback", ['rating' => 4, 'comment' => 'Super nett!'])
            ->assertOk()
            ->assertJsonPath('credits', 10)
            ->assertJsonPath('data.feedback_given', true);
        $this->postJson("/api/bookings/{$id}/feedback", ['rating' => 4])->assertStatus(422);
        $this->assertSame(10, $admin->fresh()->credits_balance);
        $this->getJson('/api/admin/testphase')->assertJsonPath('data.feedback.0.comment', 'Super nett!');

        // Ohne Testphase: nicht moeglich.
        $this->actingAsUser();
        $this->postJson("/api/bookings/{$id}/feedback", ['rating' => 4])->assertForbidden();
    }

    public function test_tageskontingent_mit_platinum_reserve(): void
    {
        $offer = $this->offer($this->partner(), ['daily_capacity' => 4, 'platinum_reserved' => 2]);
        $day = now()->addDays(2)->toDateString();

        $this->actingAsUser();
        $this->postJson('/api/bookings', ['offer_id' => $offer->id, 'people' => 1, 'pay_method' => 'money'])
            ->assertStatus(422)->assertJsonValidationErrors('preferred_date');
        $this->postJson('/api/bookings', ['offer_id' => $offer->id, 'people' => 2, 'pay_method' => 'money', 'preferred_date' => $day])->assertCreated();
        $this->getJson("/api/offers/{$offer->id}/availability?date={$day}")
            ->assertJsonPath('data.available', 2)
            ->assertJsonPath('data.available_for_you', 0);
        $this->postJson('/api/bookings', ['offer_id' => $offer->id, 'people' => 1, 'pay_method' => 'money', 'preferred_date' => $day])
            ->assertStatus(422)
            ->assertJsonPath('errors.people.0', 'Die letzten 2 Plätze am '.Carbon::parse($day)->format('d.m.').' sind für Platinum-Mitglieder reserviert.');

        $this->actingAsUser(['club_plan' => 'platinum']);
        $this->postJson('/api/bookings', ['offer_id' => $offer->id, 'people' => 2, 'pay_method' => 'money', 'preferred_date' => $day])->assertCreated();
        $this->postJson('/api/bookings', ['offer_id' => $offer->id, 'people' => 1, 'pay_method' => 'money', 'preferred_date' => $day])
            ->assertStatus(422)->assertJsonValidationErrors('people');
    }

    public function test_wunschliste_platinum_zaehlt_doppelt(): void
    {
        $this->admin();
        $this->postJson('/api/admin/testphase/wishes', ['name' => 'Kino Lumière', 'note' => 'Bitte!'])->assertCreated();
        $this->postJson('/api/admin/testphase/wishes', ['name' => 'kino lumière'])->assertStatus(422);
        $wish = $this->getJson('/api/admin/testphase')->json('data.wishes.0');
        $this->assertSame(1, $wish['score']);
        $this->assertTrue($wish['voted']);

        $this->admin(['club_plan' => 'platinum']);
        $this->postJson("/api/admin/testphase/wishes/{$wish['id']}/vote")->assertOk()->assertJsonPath('data.wishes.0.score', 3);
        $this->postJson("/api/admin/testphase/wishes/{$wish['id']}/vote")->assertOk()->assertJsonPath('data.wishes.0.score', 1);
    }

    public function test_treuestufen_und_sammelalbum(): void
    {
        $admin = $this->admin();
        $partners = collect(range(1, 3))->map(fn ($i) => $this->partner(['name' => "P{$i}"]));
        foreach (range(1, 10) as $d) {
            $this->visit($admin, $partners[$d % 2]->id, now()->subDays($d)->toDateTimeString());
        }

        $state = $this->getJson('/api/admin/testphase')->json('data');
        $this->assertSame('bronze', $state['loyalty']['level']);
        $this->assertSame('silver', $state['loyalty']['next']['key']);
        $this->postJson('/api/admin/testphase/claim', ['key' => 'loyalty:bronze'])->assertOk()->assertJsonPath('credits', 50);
        $this->postJson('/api/admin/testphase/claim', ['key' => 'loyalty:silver'])->assertStatus(422);

        $this->assertSame(2, $state['album']['visited']);
        $this->assertSame(3, $state['album']['total']);
        $this->assertSame(5, $state['album']['stamps'][0]['visits']);
        $this->assertSame(0, $state['album']['stamps'][2]['visits']);
    }

    public function test_kosten_teilen_in_der_gruppe(): void
    {
        $friend = $this->user(['is_admin' => true]);
        $booker = $this->admin();
        $groupId = $this->group($booker, [$friend]);
        $offer = $this->offer($this->partner(), ['price_credits' => 100]);
        Wallet::credit($booker, 500, 'admin', 'Test');
        Wallet::credit($friend, 100, 'admin', 'Test');

        $booking = $this->postJson('/api/bookings', ['offer_id' => $offer->id, 'people' => 2, 'pay_method' => 'credits', 'group_id' => $groupId])->assertCreated()->json('data');
        $shareable = $this->getJson('/api/admin/testphase')->json('data.shares.shareable.0');
        $this->assertSame($booking['id'], $shareable['booking_id']);
        $this->assertSame((int) ceil($booking['total_credits'] / 2), $shareable['share_credits']);

        $this->postJson('/api/admin/testphase/shares', ['booking_id' => $booking['id'], 'user_ids' => [$friend->id]])->assertCreated();
        $before = $booker->fresh()->credits_balance;

        $this->actingAs($friend, 'sanctum');
        $share = $this->getJson('/api/admin/testphase')->json('data.shares.i_owe.0');
        $this->assertSame('pending', $share['status']);
        $this->postJson("/api/admin/testphase/shares/{$share['id']}/pay")->assertOk()->assertJsonPath('credits', $shareable['share_credits']);
        $this->postJson("/api/admin/testphase/shares/{$share['id']}/pay")->assertStatus(422);

        $this->assertSame($before + $shareable['share_credits'], $booker->fresh()->credits_balance);
        $this->assertSame(100 - $shareable['share_credits'], $friend->fresh()->credits_balance);
    }

    public function test_abstimmung_in_der_gruppe(): void
    {
        $friend = $this->user(['is_admin' => true]);
        $owner = $this->admin();
        $groupId = $this->group($owner, [$friend]);
        $a = $this->offer($this->partner(), ['title' => 'Bowling']);
        $b = $this->offer($this->partner(), ['title' => 'Kart']);

        $this->postJson('/api/admin/testphase/polls', ['group_id' => $groupId, 'options' => [['offer_id' => $a->id]]])->assertStatus(422);
        $poll = $this->postJson('/api/admin/testphase/polls', [
            'group_id' => $groupId, 'title' => 'Freitag?', 'options' => [['offer_id' => $a->id], ['offer_id' => $b->id, 'day' => now()->addDays(3)->toDateString()]],
        ])->assertCreated()->json('data.polls.0');
        $this->assertSame('Freitag?', $poll['title']);

        $this->postJson("/api/admin/testphase/polls/{$poll['id']}/vote", ['option_id' => $poll['options'][1]['id']])->assertOk();
        $this->actingAs($friend, 'sanctum');
        $this->postJson("/api/admin/testphase/polls/{$poll['id']}/vote", ['option_id' => $poll['options'][1]['id']])->assertOk();
        $this->postJson("/api/admin/testphase/polls/{$poll['id']}/close")->assertStatus(422);

        $this->actingAs($owner, 'sanctum');
        $closed = $this->postJson("/api/admin/testphase/polls/{$poll['id']}/close")->assertOk()->json('data.polls.0');
        $this->assertTrue($closed['closed']);
        $this->assertSame($poll['options'][1]['id'], $closed['winner_option_id']);
        $this->assertSame(2, $closed['voted']);
        $this->postJson("/api/admin/testphase/polls/{$poll['id']}/vote", ['option_id' => $poll['options'][0]['id']])->assertStatus(422);
    }
}
