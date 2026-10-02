<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\PasswordPolicy;
use App\Support\TwoFactor;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\AppFeatureTestCase;

/**
 * Password reset by a one-time code (F-09): POST /forgot-password mails a 6-digit code to the
 * stored address; POST /reset-password takes the address, the code and the new password. The
 * code is stored only as a keyed hash, lasts 10 minutes, survives 5 wrong tries, works once, and
 * code mails are a minute apart per account (App\Support\PasswordReset); the per-account cap is
 * the route throttle (config/ratelimits.php). There is no reset link any more.
 *
 * Revocation of every session on a reset is pinned in TokenRevocationTest, the e-mail change
 * dropping open codes in EmailChangeTest, logs in PasswordResetLogTest and LogHygieneTest, the log
 * mailer in CodeMailTest.
 *
 * The mail class is named as a string: the tests must run (and fail) on code without it.
 */
class PasswordResetCodeTest extends AppFeatureTestCase
{
    private const CODE_MAIL = 'App\\Mail\\PasswordResetCode';

    private const MSG_SENT = 'Falls ein Konto zu dieser Adresse existiert, haben wir dir einen Code geschickt.';

    private const MSG_INVALID = 'Der Code ist ungültig oder abgelaufen. Fordere bei Bedarf einen neuen an.';

    private const MSG_CODE_SHAPE = 'Bitte gib den 6-stelligen Code aus der E-Mail ein.';

    private const NEW_PASSWORD = 'Fixture-New-Pass-8642';

    /** A rule that never trips within one test. */
    private const WIDE = '10000/3600';

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
    }

    private function forgot(string $email): TestResponse
    {
        return $this->postJson('/api/forgot-password', ['email' => $email]);
    }

    private function reset(string $email, string $code, string $password = self::NEW_PASSWORD): TestResponse
    {
        return $this->postJson('/api/reset-password', [
            'email' => $email,
            'code' => $code,
            'password' => $password,
            'password_confirmation' => $password,
        ]);
    }

    /** The code of the last reset mail; fails (an assertion) when none was sent. */
    private function mailedCode(): string
    {
        Mail::assertSent(self::CODE_MAIL);

        return (string) Mail::sent(self::CODE_MAIL)->last()->code;
    }

    /** A six-digit code that is not $code. */
    private static function otherCode(string $code): string
    {
        return sprintf('%06d', ((int) $code + 1) % 1000000);
    }

    private function passwordOf(User $user): string
    {
        return (string) DB::table('users')->where('id', $user->id)->value('password');
    }

    /** The address with its first "e" replaced by "É": the column's collation finds the same row. */
    private static function variantOf(string $email): string
    {
        $at = (int) strpos($email, 'e');

        return substr($email, 0, $at)."\u{00C9}".substr($email, $at + 1);
    }

    public function test_forgot_password_mails_a_six_digit_code_to_the_stored_address(): void
    {
        $user = $this->makeUser();
        $variant = self::variantOf($user->email);
        $this->assertNotSame($user->email, $variant);

        $this->forgot($variant)
            ->assertOk()
            ->assertExactJson(['status' => 'sent', 'message' => self::MSG_SENT]);

        Mail::assertSent(self::CODE_MAIL, 1);
        $mail = Mail::sent(self::CODE_MAIL)->first();
        $this->assertSame([$user->email], array_column($mail->to, 'address'), 'the code went to another spelling than the stored address');
        $this->assertMatchesRegularExpression('/^\d{6}$/', $mail->code);
        $this->assertSame(10, $mail->minutes);
    }

    public function test_an_unknown_address_gets_the_same_answer_and_no_mail(): void
    {
        $known = $this->forgot($this->makeUser()->email)->assertOk()->json();
        Mail::assertSent(self::CODE_MAIL, 1);

        $unknown = $this->forgot(self::freeUsername('nobody').'@example.invalid')->assertOk()->json();

        $this->assertSame($known, $unknown);
        Mail::assertSent(self::CODE_MAIL, 1);
    }

    public function test_the_code_is_stored_only_as_a_keyed_hash(): void
    {
        $user = $this->makeUser();
        $this->forgot($user->email)->assertOk();
        $code = $this->mailedCode();

        $rows = DB::table('two_factor_challenges')->where('user_id', $user->id)->where('purpose', 'reset')->get();
        $this->assertCount(1, $rows);
        $row = (array) $rows->first();
        $this->assertMatchesRegularExpression('/^[0-9a-f]{64}$/', (string) $row['code_hash']);
        $this->assertNotSame(hash('sha256', $code), $row['code_hash'], 'the code is hashed without a key');
        foreach ($row as $column => $value) {
            $this->assertStringNotContainsString($code, (string) $value, "column {$column} holds the code");
        }
    }

    public function test_the_mailed_code_sets_the_new_password(): void
    {
        $user = $this->makeUser();
        $this->forgot($user->email)->assertOk();

        $this->reset($user->email, $this->mailedCode())
            ->assertOk()
            ->assertExactJson(['status' => 'reset', 'message' => 'Dein Passwort wurde zurueckgesetzt.']);

        $this->assertTrue(Hash::check(self::NEW_PASSWORD, $this->passwordOf($user)));
        $this->postJson('/api/login', ['email' => $user->email, 'password' => self::TEST_PASSWORD])->assertStatus(422);
        $this->postJson('/api/login', ['email' => $user->email, 'password' => self::NEW_PASSWORD])->assertOk()->assertJsonStructure(['token']);
        $this->assertSame(0, DB::table('two_factor_challenges')->where('user_id', $user->id)->where('purpose', 'reset')->count());
    }

    public function test_a_wrong_code_is_refused_like_an_unknown_address(): void
    {
        $user = $this->makeUser();
        $before = $this->passwordOf($user);
        $this->forgot($user->email)->assertOk();
        $code = $this->mailedCode();

        $wrong = $this->reset($user->email, self::otherCode($code))
            ->assertStatus(422)
            ->assertJsonPath('message', self::MSG_INVALID)
            ->assertJsonPath('errors.code.0', self::MSG_INVALID)
            ->json();
        $unknown = $this->reset(self::freeUsername('nobody').'@example.invalid', $code)->assertStatus(422)->json();

        $this->assertSame($wrong, $unknown);
        $this->assertSame($before, $this->passwordOf($user));
        $this->assertSame(1, (int) DB::table('two_factor_challenges')->where('user_id', $user->id)->where('purpose', 'reset')->value('attempts'));
    }

    public function test_a_malformed_code_is_refused_before_it_is_checked(): void
    {
        $user = $this->makeUser();
        $this->forgot($user->email)->assertOk();
        $this->mailedCode();

        foreach (['', '12345', '1234567', 'abcdef'] as $code) {
            $this->reset($user->email, $code)
                ->assertStatus(422)
                ->assertJsonPath('errors.code.0', self::MSG_CODE_SHAPE);
        }

        $this->assertSame(0, (int) DB::table('two_factor_challenges')->where('user_id', $user->id)->where('purpose', 'reset')->value('attempts'));
    }

    public function test_spaces_in_the_code_are_ignored(): void
    {
        $user = $this->makeUser();
        $this->forgot($user->email)->assertOk();
        $code = $this->mailedCode();

        $this->reset($user->email, substr($code, 0, 3).' '.substr($code, 3))->assertOk();
    }

    /**
     * Ten minutes by PHP's clock, whatever the time zone: the test MySQL runs in UTC, the
     * development default APP_TIMEZONE is Europe/Berlin. Nothing in the flow uses MySQL's NOW(),
     * so both zones give the same answer (P3-8).
     */
    public static function expiry(): array
    {
        return [
            'UTC, 9 min 50 s' => ['UTC', 590, true],
            'UTC, 10 min 1 s' => ['UTC', 601, false],
            'Europe/Berlin, 9 min 50 s' => ['Europe/Berlin', 590, true],
            'Europe/Berlin, 10 min 1 s' => ['Europe/Berlin', 601, false],
        ];
    }

    #[DataProvider('expiry')]
    public function test_the_code_expires_after_ten_minutes(string $timezone, int $seconds, bool $works): void
    {
        $saved = date_default_timezone_get();
        date_default_timezone_set($timezone);
        config(['app.timezone' => $timezone]);

        try {
            $user = $this->makeUser();
            $before = $this->passwordOf($user);
            $this->forgot($user->email)->assertOk();
            $code = $this->mailedCode();

            $this->travel($seconds)->seconds();

            if ($works) {
                $this->reset($user->email, $code)->assertOk();
                $this->assertTrue(Hash::check(self::NEW_PASSWORD, $this->passwordOf($user)));
            } else {
                $this->reset($user->email, $code)->assertStatus(422)->assertJsonPath('errors.code.0', self::MSG_INVALID);
                $this->assertSame($before, $this->passwordOf($user));
            }
        } finally {
            date_default_timezone_set($saved);
        }
    }

    public function test_five_wrong_codes_use_the_code_up(): void
    {
        $user = $this->makeUser();
        $before = $this->passwordOf($user);
        $this->forgot($user->email)->assertOk();
        $code = $this->mailedCode();

        for ($i = 0; $i < 5; $i++) {
            $this->reset($user->email, self::otherCode($code))->assertStatus(422)->assertJsonPath('errors.code.0', self::MSG_INVALID);
        }

        $this->reset($user->email, $code)->assertStatus(422)->assertJsonPath('errors.code.0', self::MSG_INVALID);
        $this->assertSame($before, $this->passwordOf($user));
    }

    public function test_a_code_works_only_once(): void
    {
        $user = $this->makeUser();
        $this->forgot($user->email)->assertOk();
        $code = $this->mailedCode();

        $this->reset($user->email, $code)->assertOk();
        $afterFirst = $this->passwordOf($user);

        $this->reset($user->email, $code, 'Fixture-Other-Pass-9753')->assertStatus(422)->assertJsonPath('errors.code.0', self::MSG_INVALID);
        $this->assertSame($afterFirst, $this->passwordOf($user));
    }

    public function test_a_new_code_replaces_the_previous_one(): void
    {
        $user = $this->makeUser();
        $this->forgot($user->email)->assertOk();
        $first = $this->mailedCode();

        $this->travel(61)->seconds();
        $this->forgot($user->email)->assertOk();
        Mail::assertSent(self::CODE_MAIL, 2);
        $second = $this->mailedCode();

        if ($second !== $first) {
            $this->reset($user->email, $first)->assertStatus(422)->assertJsonPath('errors.code.0', self::MSG_INVALID);
        }
        $this->reset($user->email, $second)->assertOk();
        $this->assertSame(0, DB::table('two_factor_challenges')->where('user_id', $user->id)->where('purpose', 'reset')->count());
    }

    /**
     * The per-account cap of code mails is the route throttle of /forgot-password (C22; its
     * default, pinned here as config, is 3 an hour and 10 a day), and within it mails are a
     * minute apart. Another spelling of the address is the same account for both.
     */
    public function test_code_mails_are_a_minute_apart_and_capped_per_account_by_the_route_throttle(): void
    {
        config(['ratelimits.password-forgot' => ['ip' => self::WIDE, 'account' => '3/3600,10/86400']]);
        $user = $this->makeUser();

        $this->forgot($user->email)->assertOk();
        $this->forgot(self::variantOf($user->email))->assertOk()->assertJsonPath('message', self::MSG_SENT);
        Mail::assertSent(self::CODE_MAIL, 1);

        $this->travel(61)->seconds();
        $this->forgot(strtoupper($user->email))->assertOk();
        Mail::assertSent(self::CODE_MAIL, 2);

        $this->travel(61)->seconds();
        $this->forgot($user->email)->assertStatus(429);
        Mail::assertSent(self::CODE_MAIL, 2);
    }

    /**
     * The username rule is checked after the code (its message would otherwise tell a stranger
     * that the address has an account), and a password that breaks it does not use the code up.
     * (Replaces the Node test of the former Node reset route, by way of PasswordResetTest.)
     */
    public function test_a_password_with_the_username_is_refused_without_using_the_code_up(): void
    {
        // The address must not carry the username as its local part, or the public e-mail part
        // of the rule would fire first.
        $user = $this->makeUser();
        $email = 'resetcode'.random_int(10_000_000, 99_999_999).'@example.invalid';
        DB::table('users')->where('id', $user->id)->update(['email' => $email]);
        $this->forgot($email)->assertOk();
        $code = $this->mailedCode();

        $this->reset($email, $code, $user->username.'77')
            ->assertStatus(422)
            ->assertJsonPath('message', PasswordPolicy::MSG_PERSONAL);

        $this->reset($email, $code)->assertOk();
    }

    /** P3-8: a wrong reset code is counted on the code only, never toward the two-factor cap. */
    public function test_wrong_reset_codes_do_not_count_toward_the_two_factor_cap(): void
    {
        config(['ratelimits.two-factor-failures.account' => '2/900']);
        $user = $this->makeUser(['two_factor_method' => TwoFactor::METHOD_EMAIL, 'two_factor_confirmed_at' => now()]);
        $this->forgot($user->email)->assertOk();
        $code = $this->mailedCode();

        for ($i = 0; $i < 3; $i++) {
            $this->reset($user->email, self::otherCode($code))->assertStatus(422);
        }

        $this->assertFalse(TwoFactor::accountLocked($user->id));
    }

    /** The former link flow is gone: a body with a link token and no code changes nothing. */
    public function test_the_link_token_flow_is_gone(): void
    {
        $user = $this->makeUser();
        $before = $this->passwordOf($user);
        // A row as the former forgot-password wrote it (with Laravel's clock, which the former
        // reset compared with); a code flow must not accept it.
        DB::table('password_reset_tokens')->insert([
            'email' => $user->email,
            'token' => Hash::make('fixture-reset-token-not-a-secret'),
            'created_at' => now(),
        ]);

        $this->postJson('/api/reset-password', [
            'token' => 'fixture-reset-token-not-a-secret',
            'email' => $user->email,
            'password' => self::NEW_PASSWORD,
        ])->assertStatus(422)->assertJsonPath('errors.code.0', self::MSG_CODE_SHAPE);

        $this->assertSame($before, $this->passwordOf($user));
    }

    /** password_reset_tokens stays in the schema (backlog) but nothing writes to it. */
    public function test_forgot_password_writes_nothing_to_password_reset_tokens(): void
    {
        $user = $this->makeUser();

        $this->forgot($user->email)->assertOk();
        $this->assertSame(0, DB::table('password_reset_tokens')->where('email', $user->email)->count());

        $this->reset($user->email, $this->mailedCode())->assertOk();
        $this->assertSame(0, DB::table('password_reset_tokens')->where('email', $user->email)->count());
    }

    /** A password change while signed in ends every open reset code (it must not undo the change). */
    public function test_a_password_change_drops_open_reset_codes(): void
    {
        $user = $this->makeUser();
        // Made directly, so this also runs where the code flow does not exist yet.
        TwoFactor::createChallenge($user, 'reset', TwoFactor::METHOD_EMAIL);

        $this->withBearer($this->issueToken($user))
            ->putJson('/api/user/password', ['current_password' => self::TEST_PASSWORD, 'password' => self::NEW_PASSWORD])
            ->assertOk();

        $this->assertSame(0, DB::table('two_factor_challenges')->where('user_id', $user->id)->where('purpose', 'reset')->count());
    }
}
