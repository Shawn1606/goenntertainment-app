<?php

namespace Tests\Feature;

use App\Models\TwoFactorChallenge;
use App\Models\User;
use App\Support\PasswordReset;
use App\Support\Totp;
use App\Support\TwoFactor;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Database\Events\TransactionCommitted;
use Illuminate\Database\Events\TransactionRolledBack;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\AppFeatureTestCase;

/**
 * A sign-in that is under way while the account's credentials change must not end with a token
 * that outlives the change (F-09: every token is revoked on a reset; F-20: a credential change
 * signs out the other sessions).
 *
 * The password sign-in reads the account, checks the password (bcrypt, a noticeable time) and
 * only then writes its token; the two-factor sign-in uses its challenge up and then writes its
 * token. A reset that commits in between must not leave that token behind.
 *
 * PHPUnit has one database connection, so a concurrent change cannot run at the same time. It is
 * staged at a chosen moment of the sign-in and runs as soon as a concurrent writer of the account
 * could: at once when the sign-in holds no lock on the account (DB::afterCommit runs at once
 * outside a transaction), or when the transaction that holds the lock commits. Which locks the
 * sign-in holds when it writes its token is pinned on its own, from the statements it sends
 * (test_the_token_is_written_in_the_transaction_that_locked_the_account).
 */
class SignInRaceTest extends AppFeatureTestCase
{
    private const NEW_PASSWORD = 'Fixture-New-Pass-8642';

    private const RESET_MAIL = 'App\\Mail\\PasswordResetCode';

    private const MSG_WRONG_CREDENTIALS = 'Diese Zugangsdaten passen nicht zu unseren Aufzeichnungen.';

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
    }

    private function tokenCount(User $user): int
    {
        return DB::table('personal_access_tokens')
            ->where('tokenable_type', User::class)
            ->where('tokenable_id', $user->id)
            ->count();
    }

    private function signIn(string $email, string $password = self::TEST_PASSWORD): TestResponse
    {
        return $this->postJson('/api/login', ['email' => $email, 'password' => $password, 'device_name' => 'race']);
    }

    /** A reset code for $user, as the reset mail carries it. */
    private function resetCode(User $user): string
    {
        $this->postJson('/api/forgot-password', ['email' => $user->email])->assertOk();
        Mail::assertSent(self::RESET_MAIL);

        return (string) Mail::sent(self::RESET_MAIL)->last()->code;
    }

    /** True when the call stack is inside $method (Class::method). */
    private static function inside(string $method): bool
    {
        foreach (debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS) as $frame) {
            if (($frame['class'] ?? '').'::'.$frame['function'] === $method) {
                return true;
            }
        }

        return false;
    }

    /**
     * Runs $change once, at the moment POST /login has read the account (before the password is
     * checked against what it read), as a concurrent writer of the account would.
     */
    private function atTheSignInsLookup(User $user, \Closure $change): \Closure
    {
        $state = (object) ['done' => false];
        User::retrieved(function (User $retrieved) use ($user, $change, $state): void {
            if (! $state->done
                && $retrieved->getKey() === $user->getKey()
                && self::inside('App\\Http\\Controllers\\AuthController::login')) {
                $state->done = true;
                DB::afterCommit($change);
            }
        });

        return static fn (): bool => $state->done;
    }

    public static function credentialChanges(): array
    {
        return [
            'password reset (the code flow)' => ['reset'],
            'password changed' => ['password'],
            'e-mail address changed' => ['email'],
            'two-factor sign-in switched on' => ['two-factor'],
        ];
    }

    /**
     * The change commits after POST /login read the account and before it wrote a token. The
     * sign-in answers like a wrong password, and no token exists afterwards: it must not get a
     * token for credentials that no longer hold (without the check, it got one that the
     * change's revocation never saw).
     */
    #[DataProvider('credentialChanges')]
    public function test_a_password_sign_in_gets_no_token_when_the_credentials_change_after_its_check(string $change): void
    {
        $user = $this->makeUser();
        $code = $change === 'reset' ? $this->resetCode($user) : null;
        $wrongPassword = $this->signIn($user->email, 'Fixture-Wrong-Pass-1357')->assertStatus(422)->json();

        $happened = $this->atTheSignInsLookup($user, function () use ($change, $user, $code): void {
            match ($change) {
                'reset' => $this->assertSame(PasswordReset::OK, PasswordReset::reset($user, (string) $code, self::NEW_PASSWORD)),
                'password' => DB::table('users')->where('id', $user->id)->update(['password' => Hash::make(self::NEW_PASSWORD)]),
                'email' => DB::table('users')->where('id', $user->id)->update(['email' => self::freeUsername('moved').'@example.invalid']),
                'two-factor' => DB::table('users')->where('id', $user->id)->update([
                    'two_factor_method' => TwoFactor::METHOD_EMAIL,
                    'two_factor_confirmed_at' => now(),
                ]),
            };
        });

        $answer = $this->signIn($user->email);

        $this->assertTrue($happened(), 'the change was not staged at the sign-in\'s lookup');
        $answer->assertStatus(422)->assertJsonPath('errors.email.0', self::MSG_WRONG_CREDENTIALS);
        $this->assertSame($wrongPassword, $answer->json(), 'the answer differs from a wrong password\'s');
        $this->assertSame(0, $this->tokenCount($user), 'a token was written for credentials that changed');
    }

    /**
     * The two-factor sign-in with a right code, and a password reset that runs as soon as the
     * transaction that used the challenge up has committed: the earliest moment the reset's
     * deletion of open sign-ins gets past the challenge's lock. Without the fix the token was
     * written after that transaction, so the reset ran in between and the token survived it.
     * Now the token is written in that transaction, the reset runs after it and revokes it.
     */
    public function test_a_two_factor_sign_in_leaves_no_token_when_a_reset_follows_the_code_check(): void
    {
        $secret = Totp::generateSecret();
        $user = $this->makeUser([
            'two_factor_method' => TwoFactor::METHOD_TOTP,
            'two_factor_secret' => $secret,
            'two_factor_confirmed_at' => now(),
        ]);
        $code = $this->resetCode($user);
        $challenge = $this->signIn($user->email)->assertOk()->json('two_factor.challenge');
        $this->assertIsString($challenge);

        $state = (object) ['reset' => null];
        TwoFactorChallenge::deleted(function (TwoFactorChallenge $deleted) use ($user, $code, $state): void {
            if ($state->reset === null && $deleted->purpose === TwoFactor::PURPOSE_LOGIN && (int) $deleted->user_id === $user->id) {
                $state->reset = 'staged';
                DB::afterCommit(function () use ($user, $code, $state): void {
                    $state->reset = PasswordReset::reset($user, $code, self::NEW_PASSWORD);
                });
            }
        });

        $answer = $this->postJson('/api/login/two-factor', ['challenge' => $challenge, 'code' => Totp::now($secret), 'device_name' => 'race']);

        $this->assertSame(PasswordReset::OK, $state->reset, 'the reset did not run after the code check');
        $this->assertSame(0, $this->tokenCount($user), 'a token survived the reset');
        if ($answer->status() === 200) {
            $this->withBearer((string) $answer->json('token'))->getJson('/api/user')->assertUnauthorized();
        } else {
            $answer->assertStatus(422)->assertJsonPath('errors.challenge.0', TwoFactor::MSG_EXPIRED_LOGIN);
        }
    }

    /**
     * The other order: the reset commits after the two-factor sign-in found its challenge and
     * before the code is checked. The reset ended the open sign-in, so the code is not checked
     * at all and no token is written (this held before the fix too; it is the order the fix
     * leaves as the only alternative to the one above).
     */
    public function test_a_two_factor_sign_in_whose_challenge_a_reset_ended_gets_no_token(): void
    {
        $secret = Totp::generateSecret();
        $user = $this->makeUser([
            'two_factor_method' => TwoFactor::METHOD_TOTP,
            'two_factor_secret' => $secret,
            'two_factor_confirmed_at' => now(),
        ]);
        $code = $this->resetCode($user);
        $challenge = $this->signIn($user->email)->assertOk()->json('two_factor.challenge');

        $state = (object) ['reset' => null];
        User::retrieved(function (User $retrieved) use ($user, $code, $state): void {
            if ($state->reset === null
                && $retrieved->getKey() === $user->getKey()
                && self::inside('App\\Http\\Controllers\\TwoFactorController::verifyLogin')) {
                $state->reset = 'staged';
                DB::afterCommit(function () use ($user, $code, $state): void {
                    $state->reset = PasswordReset::reset($user, $code, self::NEW_PASSWORD);
                });
            }
        });

        $this->postJson('/api/login/two-factor', ['challenge' => $challenge, 'code' => Totp::now($secret)])
            ->assertStatus(422)
            ->assertJsonPath('errors.challenge.0', TwoFactor::MSG_EXPIRED_LOGIN);

        $this->assertSame(PasswordReset::OK, $state->reset);
        $this->assertSame(0, $this->tokenCount($user));
    }

    public static function signIns(): array
    {
        return [
            'password sign-in' => ['password'],
            'two-factor sign-in' => ['two-factor'],
        ];
    }

    /**
     * Why a concurrent change can only come before or after the sign-in, never in between: the
     * token is written in the same transaction that first locked the account's row (and, for the
     * two-factor sign-in, then the challenge's row and deleted it), with no commit in between. A
     * reset, a password or e-mail change and a two-factor change all lock or write that row
     * first, so they wait for that transaction; and the revocation that follows them deletes
     * the open sign-ins first and the tokens after.
     */
    #[DataProvider('signIns')]
    public function test_the_token_is_written_in_the_transaction_that_locked_the_account(string $signIn): void
    {
        $secret = Totp::generateSecret();
        $user = $signIn === 'password' ? $this->makeUser() : $this->makeUser([
            'two_factor_method' => TwoFactor::METHOD_TOTP,
            'two_factor_secret' => $secret,
            'two_factor_confirmed_at' => now(),
        ]);
        $challenge = $signIn === 'password' ? null : $this->signIn($user->email)->assertOk()->json('two_factor.challenge');

        // Every statement with the transaction level it ran at, and every commit and rollback with
        // the level it returned to: a lock is held only until its transaction ends.
        $statements = [];
        DB::listen(function (QueryExecuted $query) use (&$statements): void {
            $statements[] = ['sql' => $query->sql, 'level' => $query->connection->transactionLevel()];
        });
        Event::listen([TransactionCommitted::class, TransactionRolledBack::class], function (TransactionCommitted|TransactionRolledBack $event) use (&$statements): void {
            $statements[] = ['sql' => '(end of transaction)', 'level' => $event->connection->transactionLevel()];
        });
        $base = DB::transactionLevel();

        $answer = $signIn === 'password'
            ? $this->signIn($user->email)
            : $this->postJson('/api/login/two-factor', ['challenge' => $challenge, 'code' => Totp::now($secret)]);
        $answer->assertOk()->assertJsonStructure(['token']);

        $insert = $this->lastIndex($statements, '/^insert into `personal_access_tokens`/');
        $this->assertNotNull($insert, 'no token was written');
        $level = $statements[$insert]['level'];
        $this->assertGreaterThan($base, $level, 'the token was written outside a transaction');

        $locks = ['account' => '/^select \* from `users` where `users`\.`id` = \? limit 1 for update$/'];
        if ($signIn !== 'password') {
            $locks['challenge'] = '/^select \* from `two_factor_challenges` where `two_factor_challenges`\.`id` = \? limit 1 for update$/';
        }

        $previous = -1;
        foreach ($locks as $name => $pattern) {
            $lock = $this->lastIndex(array_slice($statements, 0, $insert), $pattern);
            $this->assertNotNull($lock, "the {$name} row was not locked before the token was written");
            $this->assertGreaterThan($previous, $lock, "the {$name} row was locked out of order (account first)");
            $this->assertSame($level, $statements[$lock]['level'], "the {$name} row was locked in another transaction");
            for ($i = $lock; $i <= $insert; $i++) {
                $this->assertGreaterThanOrEqual($level, $statements[$i]['level'], "the transaction that locked the {$name} row ended before the token was written");
            }
            $previous = $lock;
        }
    }

    /** Index of the last statement matching $pattern, or null. */
    private function lastIndex(array $statements, string $pattern): ?int
    {
        for ($i = count($statements) - 1; $i >= 0; $i--) {
            if (preg_match($pattern, $statements[$i]['sql']) === 1) {
                return $i;
            }
        }

        return null;
    }
}
