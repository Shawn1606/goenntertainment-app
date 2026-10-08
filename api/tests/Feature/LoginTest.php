<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
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

    /**
     * An unknown address (or an account without a password) costs one bcrypt check, as a known
     * one does: otherwise the response time would tell which addresses have an account. The test
     * counts the checks, not the time, which is reliable in a test run.
     */
    public function test_an_unknown_address_costs_the_same_password_check_as_a_known_one(): void
    {
        $known = $this->makeUser();
        $passwordless = $this->makeUser(['password' => null]);
        $hasher = new class(Hash::getFacadeRoot())
        {
            public int $checks = 0;

            public function __construct(private readonly object $hasher) {}

            public function check(string $value, ?string $hashedValue, array $options = []): bool
            {
                $this->checks++;

                return $this->hasher->check($value, $hashedValue, $options);
            }

            public function __call(string $method, array $arguments): mixed
            {
                return $this->hasher->{$method}(...$arguments);
            }
        };
        Hash::swap($hasher);

        $cases = [
            'unknown address' => self::freeUsername('nobody').'@example.invalid',
            'known address' => $known->email,
            'account without a password' => $passwordless->email,
        ];
        foreach ($cases as $case => $email) {
            $hasher->checks = 0;
            $this->login($email, 'Wrong-Pass-1357')
                ->assertStatus(422)
                ->assertJsonPath('errors.email.0', 'Diese Zugangsdaten passen nicht zu unseren Aufzeichnungen.');
            $this->assertSame(1, $hasher->checks, "{$case}: password checks");
        }

        $hasher->checks = 0;
        $this->login($known->email, self::TEST_PASSWORD)->assertOk();
        $this->assertSame(1, $hasher->checks, 'right password: password checks');
    }

    /** POST /api/logout ends the session of the token it is sent with - only that one. */
    public function test_logout_deletes_only_the_token_in_use(): void
    {
        $this->postJson('/api/logout')->assertUnauthorized();

        $user = $this->makeUser();
        $phone = $this->issueToken($user);
        $tablet = $this->issueToken($user);

        $this->withBearer($phone)->postJson('/api/logout')->assertOk()->assertJsonPath('message', 'Abgemeldet.');

        $this->withBearer($phone)->getJson('/api/user')->assertUnauthorized();
        $this->withBearer($phone)->postJson('/api/logout')->assertUnauthorized();
        $this->withBearer($tablet)->getJson('/api/user')->assertOk();
        $this->assertSame(1, $this->tokenCount($user));
    }
}
