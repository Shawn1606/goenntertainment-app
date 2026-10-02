<?php

namespace Tests\Feature;

use App\Providers\AppServiceProvider;
use App\Support\Totp;
use App\Support\TwoFactor;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\RateLimiter;
use Tests\AppFeatureTestCase;

/**
 * The locks that make a check and its count one step (review findings RL-2 and AUTH-4;
 * ConcurrentCapsTest shows what they are for): a request that cannot get its lock in time
 * (config ratelimits.lock-wait) gets the limiters' 429 answer, and nothing is checked or counted.
 * Another request holding the lock is simulated by a row in cache_locks.
 */
class LimiterLockTest extends AppFeatureTestCase
{
    /** A lock row as another request's would look, for the next 60 seconds. */
    private function heldByAnotherRequest(string $name): void
    {
        DB::table('cache_locks')->insert([
            'key' => config('cache.prefix').$name,
            'owner' => 'another-request-in-this-test',
            'expiration' => time() + 60,
        ]);
    }

    public function test_a_code_check_that_cannot_get_the_account_lock_gets_429_and_checks_nothing(): void
    {
        config(['ratelimits.lock-wait' => '1']);
        $secret = Totp::generateSecret();
        $user = $this->makeUser([
            'two_factor_method' => TwoFactor::METHOD_TOTP,
            'two_factor_secret' => $secret,
            'two_factor_confirmed_at' => now(),
        ]);
        $token = $this->issueToken($user);
        $this->heldByAnotherRequest('two-factor-account:'.$user->id);

        // Even the right code: it is not looked at.
        $this->withBearer($token)
            ->deleteJson('/api/user/two-factor', ['password' => self::TEST_PASSWORD, 'code' => Totp::now($secret)])
            ->assertStatus(429)
            ->assertJsonPath('message', AppServiceProvider::MSG_TOO_MANY);

        $this->assertSame(0, RateLimiter::attempts('two-factor-failures:'.$user->id.':900'));
        $this->assertNull(DB::table('users')->where('id', $user->id)->value('two_factor_last_step'), 'the code was not used up');
        $this->assertSame(TwoFactor::METHOD_TOTP, DB::table('users')->where('id', $user->id)->value('two_factor_method'));
    }

    public function test_a_request_that_cannot_get_a_limiter_lock_gets_429_and_is_not_counted(): void
    {
        config(['ratelimits.lock-wait' => '1']);
        $user = $this->makeUser();
        // The counters of a sign-in, as ThrottleRequests names them: md5(limiter . limit key).
        $counters = array_map(static fn (string $limitKey): string => md5('login'.$limitKey), [
            "login|account_ip|user:{$user->id}|127.0.0.1|60",
            'login|ip|127.0.0.1|60',
            "login|account|user:{$user->id}|3600",
            "login|account|user:{$user->id}|86400",
        ]);
        $this->heldByAnotherRequest('throttle:'.$counters[2]);

        $this->postJson('/api/login', ['email' => $user->email, 'password' => 'wrong-password-not-a-secret-1'])
            ->assertStatus(429)
            ->assertJsonPath('message', AppServiceProvider::MSG_TOO_MANY);

        foreach ($counters as $counter) {
            $this->assertSame(0, RateLimiter::attempts($counter), 'no counter of the request was counted');
        }

        // Once the lock is free, the same request is counted on every counter.
        DB::table('cache_locks')->where('key', config('cache.prefix').'throttle:'.$counters[2])->delete();
        $this->postJson('/api/login', ['email' => $user->email, 'password' => 'wrong-password-not-a-secret-1'])->assertStatus(422);
        foreach ($counters as $counter) {
            $this->assertSame(1, RateLimiter::attempts($counter), 'the counter names above are the limiter\'s');
        }
    }
}
