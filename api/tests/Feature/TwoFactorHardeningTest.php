<?php

namespace Tests\Feature;

use App\Mail\TwoFactorCode;
use App\Models\User;
use App\Support\Totp;
use App\Support\TwoFactor;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\DataProvider;
use Symfony\Component\Mailer\Exception\TransportException;
use Symfony\Component\Mailer\SentMessage;
use Symfony\Component\Mailer\Transport\AbstractTransport;
use Tests\AppFeatureTestCase;

/**
 * Two-factor sign-in hardening (F-19):
 * - wrong codes count per account across every challenge and step-up; at the cap (10 in 15
 *   minutes by default) no code is accepted and no code mail is sent until the window ends;
 * - switching it on needs the password; switching it off and new recovery codes need the
 *   password AND a current code;
 * - every change signs out the other sessions and sends a notice (best effort).
 *
 * The notice class is named as a string: the tests must run (and fail) on code without it.
 */
class TwoFactorHardeningTest extends AppFeatureTestCase
{
    private const NOTICE = 'App\\Mail\\AccountSecurityNotice';

    private const MSG_LOCKED_15 = 'Zu viele falsche Codes – bitte warte 15 Minuten und versuch es dann noch mal.';

    /** A TOTP account; returns [user, secret]. */
    private function totpUser(): array
    {
        $secret = Totp::generateSecret();
        $user = $this->makeUser([
            'two_factor_method' => TwoFactor::METHOD_TOTP,
            'two_factor_secret' => $secret,
            'two_factor_confirmed_at' => now(),
        ]);

        return [$user, $secret];
    }

    /** The current TOTP code, usable again (the replay marker is cleared first). */
    private function freshTotp(User $user, string $secret): string
    {
        DB::table('users')->where('id', $user->id)->update(['two_factor_last_step' => null]);

        return Totp::now($secret);
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

    /** Signs in with the password; returns the answer (a challenge when two-factor is on). */
    private function signIn(User $user): TestResponse
    {
        return $this->postJson('/api/login', ['email' => $user->email, 'password' => self::TEST_PASSWORD]);
    }

    /** The last code mailed, plus one: certainly wrong. */
    private static function wrongMailedCode(): string
    {
        return sprintf('%06d', ((int) Mail::sent(TwoFactorCode::class)->last()->code + 1) % 1000000);
    }

    public function test_wrong_codes_across_sign_ins_lock_the_second_factor_and_its_mails(): void
    {
        Mail::fake();
        $user = $this->makeUser(['two_factor_method' => TwoFactor::METHOD_EMAIL, 'two_factor_confirmed_at' => now()]);

        // Two sign-ins, five wrong codes each: each challenge is used up after five, the account
        // after ten.
        for ($signIn = 0; $signIn < 2; $signIn++) {
            $challenge = $this->signIn($user)->assertOk()->json('two_factor.challenge');
            $wrong = self::wrongMailedCode();
            for ($i = 0; $i < 5; $i++) {
                $this->postJson('/api/login/two-factor', ['challenge' => $challenge, 'code' => $wrong])->assertStatus(422);
            }
        }
        $mailsBefore = Mail::sent(TwoFactorCode::class)->count();

        // A third sign-in: the password is right, but no challenge and no code mail.
        $this->signIn($user)
            ->assertStatus(422)
            ->assertJsonPath('errors.email.0', self::MSG_LOCKED_15)
            ->assertJsonMissingPath('two_factor');
        $this->assertSame($mailsBefore, Mail::sent(TwoFactorCode::class)->count());
    }

    public function test_step_up_failures_count_toward_the_same_cap_and_the_lock_ends(): void
    {
        Mail::fake();
        [$user, $secret] = $this->totpUser();
        $token = $this->issueToken($user);

        for ($i = 0; $i < 10; $i++) {
            if ($i === 5) {
                $this->travel(61)->seconds(); // past the per-minute route limit, inside the 15-minute window
            }
            $this->withBearer($token)
                ->deleteJson('/api/user/two-factor', ['password' => self::TEST_PASSWORD, 'code' => self::wrongTotp($secret)])
                ->assertStatus(422)
                ->assertJsonValidationErrors('code');
        }

        // The right code is refused now, at sign-in as well.
        $this->travel(61)->seconds();
        $this->withBearer($token)
            ->deleteJson('/api/user/two-factor', ['password' => self::TEST_PASSWORD, 'code' => $this->freshTotp($user, $secret)])
            ->assertStatus(422)
            ->assertJsonPath('errors.code.0', 'Zu viele falsche Codes – bitte warte 13 Minuten und versuch es dann noch mal.');
        $this->signIn($user)->assertStatus(422)->assertJsonPath('errors.email.0', 'Zu viele falsche Codes – bitte warte 13 Minuten und versuch es dann noch mal.');
        $this->assertSame(TwoFactor::METHOD_TOTP, DB::table('users')->where('id', $user->id)->value('two_factor_method'));

        // After the window the right code works again.
        $this->travel(15)->minutes();
        $this->withBearer($token)
            ->deleteJson('/api/user/two-factor', ['password' => self::TEST_PASSWORD, 'code' => $this->freshTotp($user, $secret)])
            ->assertOk();
    }

    public function test_switching_on_needs_the_current_password(): void
    {
        Mail::fake();
        $user = $this->makeUser();
        $token = $this->issueToken($user);

        foreach (['email', 'totp'] as $method) {
            $this->withBearer($token)->postJson("/api/user/two-factor/{$method}")
                ->assertStatus(422)
                ->assertJsonPath('errors.password.0', 'Bitte bestätige mit deinem Passwort.');
            $this->withBearer($token)->postJson("/api/user/two-factor/{$method}", ['password' => 'wrong-password-not-a-secret-1'])
                ->assertStatus(422)
                ->assertJsonPath('errors.password.0', 'Das Passwort stimmt nicht.');
        }

        // Nothing was started: no code mailed, no challenge, no secret written.
        Mail::assertNothingSent();
        $this->assertSame(0, DB::table('two_factor_challenges')->where('user_id', $user->id)->count());
        $this->assertNull(DB::table('users')->where('id', $user->id)->value('two_factor_secret'));

        $this->withBearer($token)->postJson('/api/user/two-factor/email', ['password' => self::TEST_PASSWORD])->assertOk();
        Mail::assertSent(TwoFactorCode::class);
        $this->withBearer($token)->postJson('/api/user/two-factor/totp', ['password' => self::TEST_PASSWORD])
            ->assertOk()
            ->assertJsonStructure(['secret', 'otpauth_url']);
    }

    public static function protectedActions(): array
    {
        return [
            'switching off' => ['DELETE', '/api/user/two-factor'],
            'new recovery codes' => ['POST', '/api/user/two-factor/recovery-codes'],
        ];
    }

    #[DataProvider('protectedActions')]
    public function test_switching_off_and_new_codes_need_password_and_code(string $method, string $uri): void
    {
        Mail::fake();
        [$user, $secret] = $this->totpUser();
        $token = $this->issueToken($user);

        $this->withBearer($token)->json($method, $uri, ['password' => self::TEST_PASSWORD])
            ->assertStatus(422)
            ->assertJsonPath('errors.code.0', 'Bitte gib den Code ein.');
        $this->withBearer($token)->json($method, $uri, ['code' => $this->freshTotp($user, $secret)])
            ->assertStatus(422)
            ->assertJsonPath('errors.password.0', 'Bitte bestätige mit deinem Passwort.');
        $this->withBearer($token)->json($method, $uri, ['password' => 'wrong-password-not-a-secret-1', 'code' => $this->freshTotp($user, $secret)])
            ->assertStatus(422)
            ->assertJsonPath('errors.password.0', 'Das Passwort stimmt nicht.');
        $this->assertSame(TwoFactor::METHOD_TOTP, DB::table('users')->where('id', $user->id)->value('two_factor_method'));

        $this->withBearer($token)->json($method, $uri, ['password' => self::TEST_PASSWORD, 'code' => $this->freshTotp($user, $secret)])
            ->assertOk();
    }

    /** Each change made with token A: [action, notice kind]. */
    public static function twoFactorChanges(): array
    {
        return [
            'switch on by e-mail' => ['enable-email', 'two_factor_enabled'],
            'switch on with an app' => ['enable-totp', 'two_factor_enabled'],
            'switch off' => ['disable', 'two_factor_disabled'],
            'new recovery codes' => ['recovery-codes', 'recovery_codes_renewed'],
        ];
    }

    #[DataProvider('twoFactorChanges')]
    public function test_each_change_signs_out_other_sessions_and_sends_a_notice(string $change, string $kind): void
    {
        Mail::fake();
        if (str_starts_with($change, 'enable')) {
            $user = $this->makeUser();
            $secret = null;
        } else {
            [$user, $secret] = $this->totpUser();
        }
        $tokenA = $this->issueToken($user);
        $tokenB = $this->issueToken($user);

        $this->perform($change, $user, $tokenA, $secret);

        $this->withBearer($tokenB)->getJson('/api/user')->assertUnauthorized();
        $this->withBearer($tokenA)->getJson('/api/user')->assertOk();
        Mail::assertSent(self::NOTICE, fn ($mail) => $mail->hasTo($user->email) && $mail->kind === $kind);
    }

    public function test_a_notice_that_cannot_be_sent_does_not_undo_the_change(): void
    {
        Mail::extend('failing-for-test', fn () => new class extends AbstractTransport
        {
            protected function doSend(SentMessage $message): void
            {
                throw new TransportException('fixture transport failure');
            }

            public function __toString(): string
            {
                return 'failing-for-test';
            }
        });
        config(['mail.mailers.failing-for-test' => ['transport' => 'failing-for-test'], 'mail.default' => 'failing-for-test']);
        $user = $this->makeUser();

        $this->perform('enable-totp', $user, $this->issueToken($user), null);

        $this->assertSame(TwoFactor::METHOD_TOTP, DB::table('users')->where('id', $user->id)->value('two_factor_method'));
    }

    private function perform(string $change, User $user, string $token, ?string $secret): void
    {
        $this->withBearer($token);

        match ($change) {
            'enable-email' => (function () {
                $challenge = $this->postJson('/api/user/two-factor/email', ['password' => self::TEST_PASSWORD])->assertOk()->json('challenge');
                $code = Mail::sent(TwoFactorCode::class)->last()->code;
                $this->postJson('/api/user/two-factor/email/confirm', ['challenge' => $challenge, 'code' => $code])->assertOk();
            })(),
            'enable-totp' => (function () {
                $secret = $this->postJson('/api/user/two-factor/totp', ['password' => self::TEST_PASSWORD])->assertOk()->json('secret');
                $this->postJson('/api/user/two-factor/totp/confirm', ['code' => Totp::now($secret)])->assertOk();
            })(),
            'disable' => $this->deleteJson('/api/user/two-factor', ['password' => self::TEST_PASSWORD, 'code' => $this->freshTotp($user, $secret)])->assertOk(),
            'recovery-codes' => $this->postJson('/api/user/two-factor/recovery-codes', ['password' => self::TEST_PASSWORD, 'code' => $this->freshTotp($user, $secret)])->assertOk(),
        };
    }
}
