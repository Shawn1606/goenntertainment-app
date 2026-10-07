<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\AppFeatureTestCase;

/**
 * The server tests do not sign in through a route: their fixtures (server/test/support/
 * fixtures.js, createUser and insertToken) write access tokens straight into
 * personal_access_tokens. This test writes a row the same way and checks that Laravel's Sanctum
 * guard takes it, and refuses the expired variant. A named mirror of the fixture's token format:
 * tokenable_type App\Models\User, the sha256 of the plain part in `token`, abilities ["*"],
 * expires_at set by the database clock, and the bearer value "<id>|<plain>" whose plain part is
 * 40 random letters and digits plus their crc32b (server/test/fixture-accounts.test.js checks
 * the fixture side).
 */
class SanctumTokenFormatTest extends AppFeatureTestCase
{
    /** A token row written like insertToken() in server/test/support/fixtures.js. */
    private function fixtureToken(int $userId, string $expiresSql): string
    {
        $entropy = Str::random(40);
        $plain = $entropy.hash('crc32b', $entropy);
        $id = DB::table('personal_access_tokens')->insertGetId([
            'tokenable_type' => 'App\\Models\\User',
            'tokenable_id' => $userId,
            'name' => 'test',
            'token' => hash('sha256', $plain),
            'abilities' => '["*"]',
            'expires_at' => DB::raw($expiresSql),
            'created_at' => DB::raw('NOW()'),
            'updated_at' => DB::raw('NOW()'),
        ]);

        return $id.'|'.$plain;
    }

    public function test_a_token_written_like_the_server_fixture_authenticates(): void
    {
        $user = $this->makeUser();
        $token = $this->fixtureToken($user->id, 'NOW() + INTERVAL 1 DAY');

        $this->withBearer($token)->getJson('/api/user')
            ->assertOk()
            ->assertJsonPath('user.id', $user->id);
    }

    public function test_an_expired_fixture_token_is_refused(): void
    {
        $user = $this->makeUser();
        $token = $this->fixtureToken($user->id, 'NOW() - INTERVAL 1 HOUR');

        $this->withBearer($token)->getJson('/api/user')->assertUnauthorized();
    }

    public function test_the_fixture_shape_is_the_one_sanctum_issues(): void
    {
        $bearer = $this->issueToken($this->makeUser());

        $this->assertMatchesRegularExpression('/^\d+\|[A-Za-z0-9]{40}[0-9a-f]{8}$/', $bearer);
        [, $plain] = explode('|', $bearer, 2);
        $this->assertSame(hash('crc32b', substr($plain, 0, 40)), substr($plain, 40));
        // The same value server/test/fixture-accounts.test.js expects from Node's zlib.crc32.
        $this->assertSame('414fa339', hash('crc32b', 'The quick brown fox jumps over the lazy dog'));
    }
}
