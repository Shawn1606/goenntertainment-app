<?php

namespace Tests\Feature;

use App\Mail\TwoFactorCode;
use App\Models\User;
use App\Support\Totp;
use App\Support\TwoFactor;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\DataProviderExternal;
use Symfony\Component\Mailer\Exception\TransportException;
use Symfony\Component\Mailer\SentMessage;
use Symfony\Component\Mailer\Transport\AbstractTransport;
use Tests\AppFeatureTestCase;

/**
 * Changing the e-mail address takes the current password, and the current code when two-factor
 * sign-in is on (F-04). It signs out every other session, drops open reset links and codes of
 * the old address, and notifies the OLD address; if that notice cannot be sent, nothing changes.
 * PATCH /api/user can no longer change the address at all.
 *
 * The notice class is named as a string: the tests must run (and fail) on code without it.
 */
class EmailChangeTest extends AppFeatureTestCase
{
    private const NOTICE = 'App\\Mail\\AccountSecurityNotice';

    private const MSG_NEEDS_STEP_UP = 'Die E-Mail-Adresse lässt sich nur mit deinem Passwort ändern – nutze „E-Mail-Adresse ändern" in den Einstellungen.';

    private function newAddress(): string
    {
        return self::freeUsername('moved').'@example.invalid';
    }

    private function change(string $token, array $body): TestResponse
    {
        return $this->withBearer($token)->putJson('/api/user/email', $body);
    }

    private function emailOf(User $user): string
    {
        return (string) DB::table('users')->where('id', $user->id)->value('email');
    }

    /** A TOTP account; returns [user, secret]. */
    private function totpUser(): array
    {
        $secret = Totp::generateSecret();
        $user = $this->makeUser(['two_factor_method' => TwoFactor::METHOD_TOTP, 'two_factor_secret' => $secret, 'two_factor_confirmed_at' => now()]);

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

    public function test_patch_user_can_no_longer_change_the_email(): void
    {
        $user = $this->makeUser();
        $old = $user->email;

        $this->withBearer($this->issueToken($user))
            ->patchJson('/api/user', ['email' => $this->newAddress()])
            ->assertStatus(422)
            ->assertJsonPath('errors.email.0', self::MSG_NEEDS_STEP_UP);

        $this->assertSame($old, $this->emailOf($user));
    }

    public function test_patch_user_accepts_the_unchanged_email(): void
    {
        $user = $this->makeUser();

        $this->withBearer($this->issueToken($user))
            ->patchJson('/api/user', ['email' => $user->email, 'name' => 'Same Address'])
            ->assertOk()
            ->assertJsonPath('user.email', $user->email)
            ->assertJsonPath('user.name', 'Same Address');
    }

    public function test_the_change_requires_the_current_password(): void
    {
        Mail::fake();
        $user = $this->makeUser();
        $token = $this->issueToken($user);
        $new = $this->newAddress();

        $this->change($token, ['email' => $new])->assertStatus(422)->assertJsonValidationErrors('current_password');
        $this->change($token, ['email' => $new, 'current_password' => 'wrong-password-not-a-secret-1'])
            ->assertStatus(422)
            ->assertJsonPath('errors.current_password.0', 'Das Passwort stimmt nicht.');

        $this->assertSame($user->email, $this->emailOf($user));
        Mail::assertNothingSent();
    }

    public function test_with_the_password_the_address_changes_and_is_unverified(): void
    {
        Mail::fake();
        $user = $this->makeUser(['email_verified_at' => now()]);

        $new = $this->newAddress();
        $this->change($this->issueToken($user), ['email' => $new, 'current_password' => self::TEST_PASSWORD])
            ->assertOk()
            ->assertJsonPath('user.email', $new);

        $this->assertSame($new, $this->emailOf($user));
        $this->assertNull(DB::table('users')->where('id', $user->id)->value('email_verified_at'));
    }

    public function test_with_two_factor_sign_in_the_change_also_needs_the_code(): void
    {
        Mail::fake();
        [$user, $secret] = $this->totpUser();
        $token = $this->issueToken($user);
        $new = $this->newAddress();

        $this->change($token, ['email' => $new, 'current_password' => self::TEST_PASSWORD])
            ->assertStatus(422)
            ->assertJsonValidationErrors('code');
        $this->change($token, ['email' => $new, 'current_password' => self::TEST_PASSWORD, 'code' => self::wrongTotp($secret)])
            ->assertStatus(422)
            ->assertJsonValidationErrors('code');
        $this->assertSame($user->email, $this->emailOf($user));

        $this->change($token, ['email' => $new, 'current_password' => self::TEST_PASSWORD, 'code' => Totp::now($secret)])
            ->assertOk();
        $this->assertSame($new, $this->emailOf($user));
    }

    public function test_with_the_email_method_the_code_goes_to_the_old_address(): void
    {
        Mail::fake();
        $user = $this->makeUser(['two_factor_method' => TwoFactor::METHOD_EMAIL, 'two_factor_confirmed_at' => now()]);
        $token = $this->issueToken($user);
        $old = $user->email;

        $this->withBearer($token)->postJson('/api/user/two-factor/code')->assertOk();
        Mail::assertSent(TwoFactorCode::class, fn ($mail) => $mail->hasTo($old));
        $code = Mail::sent(TwoFactorCode::class)->last()->code;

        $new = $this->newAddress();
        $this->change($token, ['email' => $new, 'current_password' => self::TEST_PASSWORD, 'code' => $code])->assertOk();
        $this->assertSame($new, $this->emailOf($user));
    }

    public function test_the_change_signs_out_every_other_session(): void
    {
        Mail::fake();
        $user = $this->makeUser();
        $tokenA = $this->issueToken($user);
        $tokenB = $this->issueToken($user);

        $this->change($tokenA, ['email' => $this->newAddress(), 'current_password' => self::TEST_PASSWORD])->assertOk();

        $this->withBearer($tokenB)->getJson('/api/user')->assertUnauthorized();
        $this->withBearer($tokenA)->getJson('/api/user')->assertOk();
    }

    public function test_the_old_address_gets_a_notice_and_the_new_one_nothing(): void
    {
        Mail::fake();
        $user = $this->makeUser();
        $old = $user->email;
        $new = $this->newAddress();

        $this->change($this->issueToken($user), ['email' => $new, 'current_password' => self::TEST_PASSWORD])->assertOk();

        Mail::assertSent(self::NOTICE, fn ($mail) => $mail->hasTo($old) && $mail->kind === 'email_changed');
        Mail::assertNotSent(self::NOTICE, fn ($mail) => $mail->hasTo($new));
        $this->assertCount(1, Mail::sent(self::NOTICE));
    }

    public function test_nothing_changes_when_the_notice_cannot_be_sent(): void
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
        $tokenA = $this->issueToken($user);
        $tokenB = $this->issueToken($user);

        $this->change($tokenA, ['email' => $this->newAddress(), 'current_password' => self::TEST_PASSWORD])
            ->assertStatus(503)
            ->assertJsonPath('message', 'Wir konnten gerade keinen Hinweis an deine bisherige Adresse schicken – deine E-Mail-Adresse bleibt unverändert. Probier es gleich noch mal.');

        $this->assertSame($user->email, $this->emailOf($user));
        $this->withBearer($tokenB)->getJson('/api/user')->assertOk();
    }

    public function test_taken_reserved_unchanged_and_invalid_addresses_are_refused(): void
    {
        Mail::fake();
        $user = $this->makeUser();
        $token = $this->issueToken($user);
        $other = $this->makeUser();
        $password = ['current_password' => self::TEST_PASSWORD];

        $cases = [
            [$other->email, 'Diese E-Mail-Adresse ist bereits registriert.'],
            ['someone@goenntertainment.local', 'Diese E-Mail-Adresse kann nicht verwendet werden.'],
            ['Someone@GOENNTERTAINMENT.LOCAL', 'Diese E-Mail-Adresse kann nicht verwendet werden.'],
            [$user->email, 'Das ist bereits deine E-Mail-Adresse.'],
            ['not-an-address', 'Bitte eine gueltige E-Mail-Adresse angeben.'],
            [str_repeat('a', 250).'@example.invalid', 'Bitte eine gueltige E-Mail-Adresse angeben.'],
        ];
        foreach ($cases as [$email, $message]) {
            $this->change($token, ['email' => $email] + $password)
                ->assertStatus(422)
                ->assertJsonPath('errors.email.0', $message);
        }

        $this->assertSame($user->email, $this->emailOf($user));
        Mail::assertNothingSent();
    }

    /**
     * A spelling of the system domain that users.email treats as the same address is refused
     * like the domain itself (AUTH-1; the cases: ReservedAccountsTest::collationVariants).
     */
    #[DataProviderExternal(ReservedAccountsTest::class, 'collationVariants')]
    public function test_spellings_the_database_treats_as_the_system_domain_are_refused(string $email, string $plain): void
    {
        Mail::fake();
        $user = $this->makeUser();

        $this->change($this->issueToken($user), ['email' => $email, 'current_password' => self::TEST_PASSWORD])
            ->assertStatus(422)
            ->assertJsonPath('errors.email.0', 'Diese E-Mail-Adresse kann nicht verwendet werden.');

        $this->assertSame($user->email, $this->emailOf($user));
        Mail::assertNothingSent();
    }

    public function test_open_reset_links_and_codes_of_the_old_address_are_dropped(): void
    {
        Mail::fake();
        $user = $this->makeUser(['two_factor_method' => TwoFactor::METHOD_EMAIL, 'two_factor_confirmed_at' => now()]);
        $token = $this->issueToken($user);
        DB::table('password_reset_tokens')->insert([
            'email' => $user->email,
            'token' => Hash::make('fixture-reset-token-not-a-secret'),
            'created_at' => now(),
        ]);

        // The confirm code for this change, plus a second open one: both go.
        $this->withBearer($token)->postJson('/api/user/two-factor/code')->assertOk();
        $code = Mail::sent(TwoFactorCode::class)->last()->code;
        TwoFactor::createChallenge($user, TwoFactor::PURPOSE_SETUP, TwoFactor::METHOD_EMAIL);

        $this->change($token, ['email' => $this->newAddress(), 'current_password' => self::TEST_PASSWORD, 'code' => $code])->assertOk();

        $this->assertFalse(DB::table('password_reset_tokens')->where('email', $user->email)->exists());
        $this->assertSame(0, DB::table('two_factor_challenges')
            ->where('user_id', $user->id)
            ->whereIn('purpose', [TwoFactor::PURPOSE_SETUP, TwoFactor::PURPOSE_CONFIRM])
            ->count());
    }

    public function test_an_account_without_a_password_must_set_one_first(): void
    {
        Mail::fake();
        $user = $this->makeUser(['password' => null]);

        $this->change($this->issueToken($user), ['email' => $this->newAddress(), 'current_password' => 'anything-not-a-secret'])
            ->assertStatus(422)
            ->assertJsonPath('errors.current_password.0', 'Lege zuerst ein Passwort fest – unter Einstellungen → Passwort ändern.');

        $this->assertSame($user->email, $this->emailOf($user));
    }
}
