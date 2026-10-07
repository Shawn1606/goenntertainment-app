<?php

namespace Tests\Feature;

use App\Support\TwoFactor;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Testing\TestResponse;
use Tests\AppFeatureTestCase;

/**
 * The auth limiters count per client address AND per account across addresses (F-01, F-19):
 * rotating the client address does not reset an account's count. Each test pins small
 * numbers through config/ratelimits.php, so it shows the scope it is about in a few requests;
 * RateLimitRulesTest pins the default numbers. The counters live in the database cache store,
 * as in the deploy (AppFeatureTestCase::CACHE_STORE).
 */
class AuthRateLimitTest extends AppFeatureTestCase
{
    private const MSG_429 = 'Zu viele Versuche – bitte warte kurz und probier es dann noch mal.';

    /** A rule that never trips within one test. */
    private const WIDE = '10000/3600';

    /** The statuses of a series of requests, each from its own client address. */
    private function fromAddresses(int $count, callable $send): array
    {
        $statuses = [];
        for ($i = 1; $i <= $count; $i++) {
            $this->withServerVariables(['REMOTE_ADDR' => '198.51.100.'.$i]);
            $statuses[] = $send($i)->status();
        }

        return $statuses;
    }

    private function assertTooMany(TestResponse $response): void
    {
        $response->assertStatus(429)->assertJsonPath('message', self::MSG_429);
        $this->assertGreaterThan(0, (int) $response->headers->get('Retry-After'));
    }

    public function test_register_is_limited_per_address_with_the_german_answer(): void
    {
        config(['ratelimits.register' => ['ip' => '3/600', 'account' => self::WIDE]]);
        $this->withServerVariables(['REMOTE_ADDR' => '198.51.100.7']);

        for ($i = 0; $i < 3; $i++) {
            $this->postJson('/api/register', [])->assertStatus(422);
        }

        $this->assertTooMany($this->postJson('/api/register', []));
    }

    public function test_register_is_limited_per_account_across_addresses(): void
    {
        config(['ratelimits.register' => ['ip' => self::WIDE, 'account' => '2/3600']]);

        $statuses = $this->fromAddresses(3, fn () => $this->postJson('/api/register', ['email' => 'Same.Person@example.invalid']));

        $this->assertSame([422, 422, 429], $statuses);
    }

    public function test_login_is_limited_per_account_across_addresses_and_spellings(): void
    {
        config(['ratelimits.login' => ['account_ip' => self::WIDE, 'ip' => self::WIDE, 'account' => '3/3600']]);
        $user = $this->makeUser();
        $spellings = [$user->email, strtoupper($user->email), ' '.ucfirst($user->email), $user->email];

        $statuses = $this->fromAddresses(4, fn (int $i) => $this->postJson('/api/login', [
            'email' => $spellings[$i - 1],
            'password' => 'wrong-password-not-a-secret-1',
        ]));

        $this->assertSame([422, 422, 422, 429], $statuses);

        // Another account is not affected.
        $this->postJson('/api/login', ['email' => $this->makeUser()->email, 'password' => 'wrong-password-not-a-secret-1'])
            ->assertStatus(422);
    }

    public function test_login_is_limited_per_unknown_address_across_addresses(): void
    {
        config(['ratelimits.login' => ['account_ip' => self::WIDE, 'ip' => self::WIDE, 'account' => '2/3600']]);

        $statuses = $this->fromAddresses(3, fn () => $this->postJson('/api/login', [
            'email' => 'nobody-here@example.invalid',
            'password' => 'wrong-password-not-a-secret-1',
        ]));

        $this->assertSame([422, 422, 429], $statuses);
    }

    public function test_forgot_password_is_limited_per_account_across_addresses(): void
    {
        config(['ratelimits.password-forgot' => ['ip' => self::WIDE, 'account' => '2/3600']]);
        $user = $this->makeUser();

        $statuses = $this->fromAddresses(3, fn () => $this->postJson('/api/forgot-password', ['email' => $user->email]));

        $this->assertSame([200, 200, 429], $statuses);
    }

    public function test_reset_password_is_limited_per_account_across_addresses(): void
    {
        config(['ratelimits.password-reset' => ['ip' => self::WIDE, 'account' => '2/3600']]);
        $user = $this->makeUser();

        $statuses = $this->fromAddresses(3, fn () => $this->postJson('/api/reset-password', [
            'token' => 'fixture-reset-token-not-a-secret',
            'email' => $user->email,
            'password' => 'Fixture-New-Pass-8642',
        ]));

        $this->assertSame([422, 422, 429], $statuses);
    }

    public function test_two_factor_sign_in_is_limited_per_account_across_challenges_and_addresses(): void
    {
        config(['ratelimits.two-factor' => ['challenge' => self::WIDE, 'ip' => self::WIDE, 'account' => '3/3600']]);
        $user = $this->makeUser(['two_factor_method' => TwoFactor::METHOD_EMAIL]);

        // A fresh sign-in (challenge) per attempt; no code was mailed, so every code is wrong.
        $statuses = $this->fromAddresses(4, function () use ($user) {
            [, $token] = TwoFactor::createChallenge($user, TwoFactor::PURPOSE_LOGIN, TwoFactor::METHOD_EMAIL);

            return $this->postJson('/api/login/two-factor', ['challenge' => $token, 'code' => '123456']);
        });

        $this->assertSame([422, 422, 422, 429], $statuses);
    }

    public function test_two_factor_code_mails_are_limited_per_account_across_challenges_and_addresses(): void
    {
        Mail::fake();
        config(['ratelimits.two-factor-resend' => ['ip' => self::WIDE, 'account' => '2/600']]);
        $user = $this->makeUser(['two_factor_method' => TwoFactor::METHOD_EMAIL]);

        $statuses = $this->fromAddresses(3, function () use ($user) {
            [, $token] = TwoFactor::createChallenge($user, TwoFactor::PURPOSE_LOGIN, TwoFactor::METHOD_EMAIL);

            return $this->postJson('/api/login/two-factor/resend', ['challenge' => $token]);
        });

        $this->assertSame([200, 200, 429], $statuses);
    }

    public function test_password_change_and_account_deletion_share_one_budget_per_account(): void
    {
        config(['ratelimits.account-sensitive' => ['user' => '3/3600']]);
        $user = $this->makeUser();
        $this->withBearer($this->issueToken($user));

        $statuses = $this->fromAddresses(4, fn (int $i) => $i % 2 === 1
            ? $this->putJson('/api/user/password', ['current_password' => 'wrong-password-not-a-secret-1', 'password' => 'Fixture-New-Pass-8642'])
            : $this->deleteJson('/api/me', ['password' => 'wrong-password-not-a-secret-1']));

        $this->assertSame([422, 422, 422, 429], $statuses);
    }

    public function test_profile_updates_are_limited_per_account(): void
    {
        config(['ratelimits.profile' => ['user' => '2/60']]);
        $user = $this->makeUser();
        $this->withBearer($this->issueToken($user));

        $statuses = $this->fromAddresses(3, fn (int $i) => $this->patchJson('/api/user', ['name' => 'Feature Test '.$i]));

        $this->assertSame([200, 200, 429], $statuses);
    }

    public function test_two_factor_setup_has_a_cap_beyond_the_minute(): void
    {
        config(['ratelimits.two-factor-setup' => ['user' => '100/60,3/3600']]);
        $user = $this->makeUser();
        $this->withBearer($this->issueToken($user));

        $statuses = $this->fromAddresses(4, fn () => $this->postJson('/api/user/two-factor/code'));

        // 409: two-factor sign-in is off; the request still counts.
        $this->assertSame([409, 409, 409, 429], $statuses);
    }

    public function test_the_limits_count_in_the_cache_table(): void
    {
        config(['ratelimits.login' => ['account_ip' => '5/60', 'ip' => '5/60', 'account' => '5/3600']]);
        $before = DB::table('cache')->count();

        $this->postJson('/api/login', ['email' => 'nobody-here@example.invalid', 'password' => 'x'])->assertStatus(422);

        // Three scopes, each a counter plus its timer.
        $this->assertSame($before + 6, DB::table('cache')->count());
    }
}
