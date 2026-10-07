<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Tests\AppFeatureTestCase;

/**
 * GET /api/leaderboard and blocks (F-13): two accounts in a block relation, in either direction,
 * do not see each other in the ranking, and the own rank counts only the accounts the viewer
 * sees, so no gap in the numbering points at a hidden account.
 *
 * The leaderboard is Laravel's (Node's copy is deleted, F-01); server/test/blocks.test.js lists it
 * as its row R22 and delegates it here. C is never part of the block and is the control: what C
 * sees shows that the hidden accounts are on the list and were hidden by the block alone.
 */
class LeaderboardBlocksTest extends AppFeatureTestCase
{
    /** $count events hosted by $userId, each with the host as participant (as Node stores them). */
    private function hostEvents(int $userId, int $count): void
    {
        for ($i = 0; $i < $count; $i++) {
            $id = DB::table('activities')->insertGetId([
                'user_id' => $userId,
                'title' => 'Leaderboard-Block '.$i,
                'description' => 'Testbeschreibung',
                'location' => 'Teststrasse 1',
                'starts_at' => now()->addDay(),
                'created_at' => now(),
                'updated_at' => now(),
            ]);
            DB::table('activity_user')->insert([
                'activity_id' => $id,
                'user_id' => $userId,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
    }

    private function block(User $blocker, User $blocked): void
    {
        DB::table('user_blocks')->insert([
            'blocker_id' => $blocker->id,
            'blocked_id' => $blocked->id,
            'created_at' => now(),
        ]);
    }

    /** The leaderboard as $viewer sees it. */
    private function leaderboard(User $viewer): array
    {
        return $this->withBearer($this->issueToken($viewer))->getJson('/api/leaderboard')->assertOk()->json();
    }

    private static function ids(array $board): array
    {
        return array_map(fn (array $entry) => $entry['user']['id'], $board['data']);
    }

    /** A, B and C with 3, 1 and 2 hosted events; A has blocked B. */
    private function threeAccounts(): array
    {
        [$a, $b, $c] = [$this->makeUser(), $this->makeUser(), $this->makeUser()];
        $this->hostEvents($a->id, 3);
        $this->hostEvents($b->id, 1);
        $this->hostEvents($c->id, 2);
        $this->block($a, $b);

        return [$a, $b, $c];
    }

    public function test_accounts_in_a_block_relation_do_not_see_each_other_on_the_leaderboard(): void
    {
        [$a, $b, $c] = $this->threeAccounts();

        $forC = self::ids($this->leaderboard($c));
        $this->assertContains($a->id, $forC, 'control: C sees A');
        $this->assertContains($b->id, $forC, 'control: C sees B');

        $forB = self::ids($this->leaderboard($b));
        $this->assertNotContains($a->id, $forB, 'B sees A, who blocked B');
        $this->assertContains($b->id, $forB);

        $forA = self::ids($this->leaderboard($a));
        $this->assertNotContains($b->id, $forA, 'A sees B, whom A blocked');
        $this->assertContains($a->id, $forA);
    }

    public function test_ranks_on_the_list_count_only_visible_accounts(): void
    {
        [, $b, $c] = $this->threeAccounts();

        $forC = $this->leaderboard($c);
        $rankOfBForC = $forC['data'][array_search($b->id, self::ids($forC), true)]['rank'];

        $forB = $this->leaderboard($b);
        $this->assertSame(range(1, count($forB['data'])), array_column($forB['data'], 'rank'), 'ranks without gaps');
        $this->assertSame($b->id, $forB['me']['user']['id']);
        // A has more XP than B and is hidden from B: B is one place further up than C counts.
        $this->assertSame($rankOfBForC - 1, $forB['me']['rank']);
    }

    public function test_the_own_rank_outside_the_top_list_counts_only_visible_accounts(): void
    {
        // 50 accounts with one event each fill the top list; A has two events, B and C none.
        for ($i = 0; $i < 50; $i++) {
            $username = self::freeUsername('board');
            $filler = DB::table('users')->insertGetId([
                'name' => 'Feature Test',
                'username' => $username,
                'email' => $username.'@example.invalid',
                'account_type' => 'standard',
                'created_at' => now(),
                'updated_at' => now(),
            ]);
            $this->hostEvents($filler, 1);
        }
        [$a, $b, $c] = [$this->makeUser(), $this->makeUser(), $this->makeUser()];
        $this->hostEvents($a->id, 2);
        $this->block($b, $a);

        $forC = $this->leaderboard($c);
        $forB = $this->leaderboard($b);
        $this->assertNotContains($c->id, self::ids($forC), 'C must be outside the top list');
        $this->assertNotContains($b->id, self::ids($forB), 'B must be outside the top list');

        // Both have no XP; for C, A is one more account ahead than for B, who blocked A.
        $this->assertSame($forC['me']['rank'] - 1, $forB['me']['rank']);
    }
}
