<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\Totp;
use App\Support\TwoFactor;
use Illuminate\Support\Facades\DB;
use Tests\AppFeatureTestCase;
use Tests\Support\ParallelServers;

/**
 * The per-account caps hold EXACTLY when requests arrive at the same time (REVIEW F-19; review
 * findings RL-2 and AUTH-4). One request after the other, a cap is easy to keep; what counts is
 * a burst, where many PHP processes look at the same counter at once and each must see the
 * count of the ones before it.
 *
 * - wrong second-factor codes: at most 10 per account are checked (ratelimits.two-factor-failures),
 *   at the sign-in, at a step-up (switching two-factor off) and at the app setup alike;
 * - a route limit per account (here the sign-in's): exactly its number of requests get through.
 *
 * How: ParallelServers starts several `php -S` processes on this checkout. Each test first brings
 * the account to one below its cap, one request after the other. Then it holds the row of that
 * counter (SELECT ... FOR UPDATE) and sends the burst: a request that has passed the check and
 * goes to count waits on that row. Without a per-account lock around check and count, every
 * server has a request past the check at the same time; with it, only one request is past the
 * check and the others wait for the lock. The row is released when every server has a request
 * waiting on it, or after HOLD_SECONDS. The route limits that are not under test are wide for the
 * servers, so only the cap under test can refuse a request.
 *
 * Unlike the other database feature tests, this class does NOT run inside a rolled-back
 * transaction: the servers are other processes with their own connections and must see the
 * accounts. tearDown deletes what the tests wrote, and the servers keep their counters under a
 * cache prefix of their own, so no counter of another test is touched.
 */
class ConcurrentCapsTest extends AppFeatureTestCase
{
    /** Parallel server processes per burst. */
    private const SERVERS = 10;

    /** The account's cap of wrong codes the servers run with: 10 in 15 minutes (the default). */
    private const FAILURE_CAP = 10;

    /**
     * How long the counter's row is held at most. Shorter than the time a request waits for the
     * per-account lock before it gives up (5 s), so the waiting requests get their turn.
     */
    private const HOLD_SECONDS = 3;

    /** A rule that never trips within one test. */
    private const WIDE = '100000/3600';

    private const LOCKED = '/^Zu viele falsche Codes – bitte warte \d+ Minuten? und versuch es dann noch mal\.$/u';

    private ?ParallelServers $servers = null;

    /** @var list<int> accounts this test wrote, deleted in tearDown */
    private array $userIds = [];

    private string $cachePrefix = '';

    /** The most requests seen waiting on the held counter at once (for the failure messages). */
    private int $mostWaiting = 0;

    /** The servers must see the accounts, so nothing here is wrapped in a transaction. */
    public function beginDatabaseTransaction(): void {}

    protected function tearDown(): void
    {
        $this->servers?->stop();

        if ($this->userIds !== []) {
            DB::table('personal_access_tokens')->where('tokenable_type', User::class)->whereIn('tokenable_id', $this->userIds)->delete();
            DB::table('two_factor_challenges')->whereIn('user_id', $this->userIds)->delete();
            DB::table('users')->whereIn('id', $this->userIds)->delete();
        }
        if ($this->cachePrefix !== '') {
            DB::table('cache')->where('key', 'like', $this->cachePrefix.'%')->delete();
            DB::table('cache_locks')->where('key', 'like', $this->cachePrefix.'%')->delete();
        }

        parent::tearDown();
    }

    /**
     * Starts the servers with the default caps plus $limits (env name => rule), and has each
     * answer once, so none is still starting up when the burst comes.
     */
    private function startServers(array $limits): void
    {
        $this->cachePrefix = 'concurrent-caps-'.bin2hex(random_bytes(6)).'-';

        $this->servers = ParallelServers::start(self::SERVERS, array_merge([
            'APP_KEY' => (string) config('app.key'),
            'CACHE_STORE' => 'database',
            'CACHE_PREFIX' => $this->cachePrefix,
            'MAIL_MAILER' => 'array',
            'LOG_CHANNEL' => 'stderr',
            'AUTH_LIMIT_2FA_FAILURES' => self::FAILURE_CAP.'/900',
        ], $limits));

        foreach ($this->servers->burst(array_fill(0, self::SERVERS, ['method' => 'GET', 'path' => '/api/health'])) as $answer) {
            $this->assertSame(200, $answer['status'], 'warm-up'.$this->servers->logTail());
        }
    }

    /**
     * Sends the burst while the row of the counter $key (as the servers name it, without the
     * prefix) is held; see the class comment.
     */
    private function burstWhileCounterIsHeld(array $requests, string $key): array
    {
        $row = $this->cachePrefix.$key;
        $this->assertTrue(DB::table('cache')->where('key', $row)->exists(), "the counter {$key} exists before the burst");

        DB::beginTransaction();
        try {
            DB::table('cache')->where('key', $row)->lockForUpdate()->first();

            return $this->servers->burst($requests, function () use ($row): void {
                $deadline = microtime(true) + self::HOLD_SECONDS;
                do {
                    // The servers' statements on that row, as MySQL shows them for this account.
                    $waiting = DB::table('performance_schema.processlist')
                        ->where('ID', '<>', DB::raw('CONNECTION_ID()'))
                        ->where('INFO', 'like', '%for update%')
                        ->where('INFO', 'like', '%'.$row.'%')
                        ->count();
                    $this->mostWaiting = max($this->mostWaiting, $waiting);
                    if ($waiting >= self::SERVERS) {
                        break;
                    }
                    usleep(20_000);
                } while (microtime(true) < $deadline);

                DB::rollBack();
            });
        } finally {
            while (DB::transactionLevel() > 0) {
                DB::rollBack();
            }
        }
    }

    private function committedUser(array $attributes = []): User
    {
        $user = $this->makeUser($attributes);
        $this->userIds[] = (int) $user->id;

        return $user;
    }

    /** A TOTP account; returns [user, secret]. */
    private function totpUser(): array
    {
        $secret = Totp::generateSecret();
        $user = $this->committedUser([
            'two_factor_method' => TwoFactor::METHOD_TOTP,
            'two_factor_secret' => $secret,
            'two_factor_confirmed_at' => now(),
        ]);

        return [$user, $secret];
    }

    /** A six-digit code the secret does not produce around now. */
    private static function wrongTotp(string $secret): string
    {
        $candidate = (int) Totp::now($secret) + 500000;
        while (Totp::verify($secret, sprintf('%06d', $candidate % 1000000)) !== null) {
            $candidate++;
        }

        return sprintf('%06d', $candidate % 1000000);
    }

    /** The account's counter of wrong codes, as App\Support\TwoFactor names it. */
    private static function failureCounter(User $user): string
    {
        return 'two-factor-failures:'.$user->id.':900';
    }

    /** How many answers carry $message (exactly, or matching a /pattern/) on $field. */
    private static function answersWith(array $answers, string $field, string $message): int
    {
        return count(array_filter($answers, static function (array $answer) use ($field, $message): bool {
            $text = $answer['json']['errors'][$field][0] ?? null;
            if (! is_string($text)) {
                return false;
            }

            return str_starts_with($message, '/') ? preg_match($message, $text) === 1 : $text === $message;
        }));
    }

    /** What happened, for the failure messages. */
    private function context(array $answers, string $counts): string
    {
        $statuses = array_count_values(array_map(static fn (array $a): int => $a['status'], $answers));
        ksort($statuses);

        return 'statuses '.json_encode($statuses).", {$counts}, at most {$this->mostWaiting} request(s) waited on the held counter at once"
            .$this->servers->logTail();
    }

    public function test_wrong_sign_in_codes_sent_at_once_are_checked_only_up_to_the_cap(): void
    {
        [$user, $secret] = $this->totpUser();
        $wrong = self::wrongTotp($secret);
        $this->startServers([
            'AUTH_LIMIT_2FA_CHALLENGE' => self::WIDE,
            'AUTH_LIMIT_2FA_IP' => self::WIDE,
            'AUTH_LIMIT_2FA_ACCOUNT' => self::WIDE,
        ]);

        // One below the cap: nine wrong codes on two sign-ins (a sign-in takes five).
        $before = [];
        foreach ([5, 4] as $count) {
            $challenge = TwoFactor::createChallenge($user, TwoFactor::PURPOSE_LOGIN, TwoFactor::METHOD_TOTP)[1];
            for ($i = 0; $i < $count; $i++) {
                $before[] = ['method' => 'POST', 'path' => '/api/login/two-factor', 'body' => ['challenge' => $challenge, 'code' => $wrong]];
            }
        }
        $this->assertSame(array_fill(0, 9, 422), array_column($this->servers->inTurn($before), 'status'));
        $this->assertSame(9, (int) DB::table('two_factor_challenges')->where('user_id', $user->id)->sum('attempts'));

        // Eight more sign-ins, five wrong codes for each, all at once: one more may be checked.
        $requests = [];
        for ($i = 0; $i < 8; $i++) {
            $challenge = TwoFactor::createChallenge($user, TwoFactor::PURPOSE_LOGIN, TwoFactor::METHOD_TOTP)[1];
            for ($round = 0; $round < 5; $round++) {
                $requests[] = ['method' => 'POST', 'path' => '/api/login/two-factor', 'body' => ['challenge' => $challenge, 'code' => $wrong]];
            }
        }
        $answers = $this->burstWhileCounterIsHeld($requests, self::failureCounter($user));

        // Every wrong code that was checked counts on its challenge; the others were refused unseen.
        $checked = (int) DB::table('two_factor_challenges')->where('user_id', $user->id)->sum('attempts');
        $locked = self::answersWith($answers, 'challenge', self::LOCKED);
        $context = $this->context($answers, "checked {$checked} in all, locked {$locked}");
        $this->assertSame(self::FAILURE_CAP, $checked, $context);
        $this->assertSame(40 - 1, $locked, $context);
    }

    public function test_wrong_step_up_codes_sent_at_once_are_checked_only_up_to_the_cap(): void
    {
        [$user, $secret] = $this->totpUser();
        $token = $user->createToken('test', ['*'], now()->addDay())->plainTextToken;
        $this->startServers(['AUTH_LIMIT_2FA_SETUP_USER' => self::WIDE]);

        // App codes and recovery codes (this account has none left) count alike.
        $switchOff = static fn (int $i) => ['method' => 'DELETE', 'path' => '/api/user/two-factor', 'token' => $token, 'body' => [
            'password' => self::TEST_PASSWORD,
            'code' => $i % 2 === 0 ? self::wrongTotp($secret) : 'zzzz-zzzz',
        ]];
        $before = $this->servers->inTurn(array_map($switchOff, range(0, self::FAILURE_CAP - 2)));
        $this->assertSame(self::FAILURE_CAP - 1, self::answersWith($before, 'code', TwoFactor::MSG_WRONG));

        $answers = $this->burstWhileCounterIsHeld(array_map($switchOff, range(0, 29)), self::failureCounter($user));

        $wrong = self::answersWith($answers, 'code', TwoFactor::MSG_WRONG);
        $locked = self::answersWith($answers, 'code', self::LOCKED);
        $context = $this->context($answers, "wrong {$wrong}, locked {$locked}");
        $this->assertSame(1, $wrong, $context);
        $this->assertSame(29, $locked, $context);
        $this->assertSame(TwoFactor::METHOD_TOTP, DB::table('users')->where('id', $user->id)->value('two_factor_method'));
    }

    public function test_wrong_setup_codes_sent_at_once_are_checked_only_up_to_the_cap(): void
    {
        // A started app setup: the secret is stored, two-factor sign-in is not on yet.
        $user = $this->committedUser(['two_factor_secret' => $secret = Totp::generateSecret()]);
        $token = $user->createToken('test', ['*'], now()->addDay())->plainTextToken;
        $this->startServers(['AUTH_LIMIT_2FA_SETUP_USER' => self::WIDE]);

        $confirm = ['method' => 'POST', 'path' => '/api/user/two-factor/totp/confirm', 'token' => $token, 'body' => ['code' => self::wrongTotp($secret)]];
        $before = $this->servers->inTurn(array_fill(0, self::FAILURE_CAP - 1, $confirm));
        $this->assertSame(self::FAILURE_CAP - 1, self::answersWith($before, 'code', TwoFactor::MSG_WRONG));

        $answers = $this->burstWhileCounterIsHeld(array_fill(0, 30, $confirm), self::failureCounter($user));

        $wrong = self::answersWith($answers, 'code', TwoFactor::MSG_WRONG);
        $locked = self::answersWith($answers, 'code', self::LOCKED);
        $context = $this->context($answers, "wrong {$wrong}, locked {$locked}");
        $this->assertSame(1, $wrong, $context);
        $this->assertSame(29, $locked, $context);
        $this->assertNull(DB::table('users')->where('id', $user->id)->value('two_factor_method'));
    }

    public function test_a_route_limit_per_account_lets_exactly_its_number_through(): void
    {
        $user = $this->committedUser();
        $this->startServers([
            'AUTH_LIMIT_LOGIN_ACCOUNT_IP' => self::WIDE,
            'AUTH_LIMIT_LOGIN_IP' => self::WIDE,
            'AUTH_LIMIT_LOGIN_ACCOUNT' => '5/3600',
        ]);
        $signIn = ['method' => 'POST', 'path' => '/api/login', 'body' => ['email' => $user->email, 'password' => 'wrong-password-not-a-secret-1']];

        // One below the limit, then a burst: exactly one more gets through to the password check.
        $this->assertSame([422, 422, 422, 422], array_column($this->servers->inTurn(array_fill(0, 4, $signIn)), 'status'));

        // The limiter's counter for this account and rule: ThrottleRequests names it
        // md5(limiter name . limit key); App\Support\RateLimitRules writes the limit key.
        $answers = $this->burstWhileCounterIsHeld(array_fill(0, 30, $signIn), md5('login'.'login|account|user:'.$user->id.'|3600'));

        $statuses = array_count_values(array_column($answers, 'status'));
        ksort($statuses);
        $this->assertSame([422 => 1, 429 => 29], $statuses, $this->context($answers, 'route limit 5/3600 per account'));
    }
}
