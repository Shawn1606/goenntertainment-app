<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Testing\TestResponse;
use Tests\AppFeatureTestCase;

/**
 * POST /api/login and the second factor.
 *
 * Sign-in belongs to Laravel; Node's copy of this route is deleted (F-01, one owner per path).
 * These tests were Node tests of that copy (server/test/account.test.js) and moved here. Node
 * answered a 2FA account with a 403 because it could not check the code; Laravel answers with
 * the 2FA challenge. What both promise is the same and is asserted here: after the password a
 * 2FA account gets no token and no user, and a wrong password answers the same with or without
 * 2FA.
 */
class LoginTest extends AppFeatureTestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        // An e-mail 2FA account gets a code by mail after the right password; nothing is sent.
        Mail::fake();
    }

    private function login(string $email, string $password): TestResponse
    {
        return $this->postJson('/api/login', ['email' => $email, 'password' => $password, 'device_name' => 'test']);
    }

    private function tokenCount(User $user): int
    {
        return DB::table('personal_access_tokens')
            ->where('tokenable_type', User::class)
            ->where('tokenable_id', $user->id)
            ->count();
    }

    public function test_login_with_two_factor_returns_a_challenge_not_a_token(): void
    {
        $user = $this->makeUser(['two_factor_method' => 'totp']);

        $response = $this->login($user->email, self::TEST_PASSWORD)
            ->assertOk()
            ->assertJsonPath('two_factor.method', 'totp')
            ->assertJsonMissingPath('token')
            ->assertJsonMissingPath('user');

        $this->assertIsString($response->json('two_factor.challenge'));
        $this->assertSame(0, $this->tokenCount($user));
    }

    public function test_wrong_password_answers_the_same_with_or_without_two_factor(): void
    {
        $withTwoFactor = $this->makeUser(['two_factor_method' => 'email']);
        $without = $this->makeUser();

        $a = $this->login($withTwoFactor->email, 'falsch12345')->assertStatus(422);
        $b = $this->login($without->email, 'falsch12345')->assertStatus(422);

        $this->assertSame($b->json(), $a->json());
        $this->assertSame(0, $this->tokenCount($withTwoFactor));
        Mail::assertNothingOutgoing();
    }

    public function test_login_without_two_factor_returns_a_token(): void
    {
        $user = $this->makeUser();

        $response = $this->login($user->email, self::TEST_PASSWORD)->assertOk();

        $this->assertNotEmpty($response->json('token'));
        $this->assertSame(1, $this->tokenCount($user));
    }
}
