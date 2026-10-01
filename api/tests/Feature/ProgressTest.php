<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Tests\AppFeatureTestCase;

/**
 * GET /api/me/progress and GET /api/leaderboard.
 *
 * Both belong to Laravel; Node's copies are deleted (F-01, one owner per path). These tests were
 * Node tests of those copies (server/test/api.test.js) and moved here with the same assertions.
 * Node created the events through its own POST /api/activities; here they are written straight
 * to the database the way that route stores them (the host is a participant of their own event).
 */
class ProgressTest extends AppFeatureTestCase
{
    /** An event hosted by $host, with the host as participant. */
    private function hostEvent(User $host, string $title): int
    {
        $id = DB::table('activities')->insertGetId([
            'user_id' => $host->id,
            'title' => $title,
            'description' => 'Testbeschreibung',
            'location' => 'Teststrasse 1, 50667 Koeln',
            'starts_at' => now()->addDay(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('activity_user')->insert([
            'activity_id' => $id,
            'user_id' => $host->id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $id;
    }

    public function test_fresh_account_starts_at_zero(): void
    {
        $token = $this->issueToken($this->makeUser(['account_type' => 'creator']));

        $this->withBearer($token)->getJson('/api/me/progress')
            ->assertOk()
            ->assertJsonPath('stats.hosted', 0)
            ->assertJsonPath('stats.joined', 0)
            ->assertJsonPath('xp', 0);
    }

    public function test_own_event_counts_as_hosted_and_joined(): void
    {
        $user = $this->makeUser(['account_type' => 'creator']);
        $this->hostEvent($user, 'Progress-Test');

        $response = $this->withBearer($this->issueToken($user))->getJson('/api/me/progress')
            ->assertOk()
            // Whoever creates an event takes part in it: both must count.
            ->assertJsonPath('stats.hosted', 1)
            ->assertJsonPath('stats.joined', 1);

        $this->assertGreaterThan(0, $response->json('xp'));
    }

    public function test_progress_requires_authentication(): void
    {
        $this->getJson('/api/me/progress')->assertUnauthorized();
    }

    public function test_leaderboard_is_sorted_by_xp_descending(): void
    {
        $active = $this->makeUser(['account_type' => 'creator']);
        $this->hostEvent($active, 'Leaderboard-Test 1');
        $this->hostEvent($active, 'Leaderboard-Test 2');
        $idle = $this->makeUser(['account_type' => 'creator']);

        $response = $this->withBearer($this->issueToken($idle))->getJson('/api/leaderboard')->assertOk();

        $entries = $response->json('data');
        $xps = array_column($entries, 'xp');
        $sorted = $xps;
        rsort($sorted);
        $this->assertSame($sorted, $xps, 'must be sorted descending');

        $index = array_search($active->id, array_map(fn (array $e) => $e['user']['id'], $entries), true);
        $this->assertNotFalse($index, 'the active account must be on the list');
        $this->assertGreaterThan(0, $entries[$index]['xp']);
        $this->assertSame($index + 1, $entries[$index]['rank']);
    }

    public function test_leaderboard_knows_my_rank(): void
    {
        $user = $this->makeUser(['account_type' => 'creator']);

        $response = $this->withBearer($this->issueToken($user))->getJson('/api/leaderboard')->assertOk();

        $this->assertSame($user->id, $response->json('me.user.id'));
        $this->assertIsInt($response->json('me.rank'));
    }
}
