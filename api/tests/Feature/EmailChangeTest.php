<?php

namespace Tests\Feature;

use App\Mail\TwoFactorCode;
use App\Models\User;
use App\Support\Totp;
use App\Support\TwoFactor;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\DataProviderExternal;
use Symfony\Component\Mailer\Exception\TransportException;
use Symfony\Component\Mailer\SentMessage;
use Symfony\Component\Mailer\Transport\AbstractTransport;
use Tests\AppFeatureTestCase;

/**
 * Changing the e-mail address (F-04) takes two steps. PUT /api/user/email takes the current
 * password, and the current code when two-factor sign-in is on, and changes nothing yet: it mails
 * a one-time code to the NEW address. POST /api/user/email/confirm with that code and the same
 * address makes the change: it signs out every other session, drops every open code that went to
 * the old address, and notifies the OLD address; if that notice cannot be sent, nothing changes.
 * PATCH /api/user can no longer change the address at all.
 *
 * Mail classes and challenge purposes are named as strings: the tests must run (and fail) on code
 * without them.
 */
class EmailChangeTest extends AppFeatureTestCase
{
    private const NOTICE = 'App\\Mail\\AccountSecurityNotice';

    private const CODE_MAIL = 'App\\Mail\\EmailChangeCode';

    private const PURPOSE = 'new_email';

    private const MSG_NEEDS_STEP_UP = 'Die E-Mail-Adresse lässt sich nur mit deinem Passwort ändern – nutze „E-Mail-Adresse ändern" in den Einstellungen.';

    private const MSG_CODE_SHAPE = 'Bitte gib den 6-stelligen Code aus der E-Mail ein.';

    private const MSG_TAKEN = 'Diese E-Mail-Adresse ist bereits registriert.';

    private function newAddress(): string
    {
        return self::freeUsername('moved').'@example.invalid';
    }

    private function change(string $token, array $body): TestResponse
    {
        return $this->withBearer($token)->putJson('/api/user/email', $body);
    }

    private function confirm(string $token, string $email, mixed $code): TestResponse
    {
        return $this->withBearer($token)->postJson('/api/user/email/confirm', ['email' => $email, 'code' => $code]);
    }

    private function emailOf(User $user): string
    {
        return (string) DB::table('users')->where('id', $user->id)->value('email');
    }

    /**
     * The code of the last code mail to $address (under Mail::fake), after checking that exactly
     * $count such mails went there.
     */
    private function codeSentTo(string $address, int $count = 1): string
    {
        $mails = Mail::sent(self::CODE_MAIL, fn ($mail) => $mail->hasTo($address));
        $this->assertCount($count, $mails, "expected {$count} code mail(s) to the new address");

        return (string) $mails->last()->code;
    }

    /** A six-digit code that is not $code. */
    private static function otherCode(string $code): string
    {
        return sprintf('%06d', ((int) $code + 1) % 1000000);
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

    /**
     * The password alone changes nothing: a code goes to the new address, and only that code
     * makes the change. The address is then verified (the code came back from it); before the
     * confirmation step existed this test asserted that the new address was unverified.
     */
    public function test_the_address_changes_only_with_the_code_mailed_to_it(): void
    {
        Mail::fake();
        $user = $this->makeUser(['email_verified_at' => null]);
        $old = $user->email;
        $token = $this->issueToken($user);
        $new = $this->newAddress();

        $sent = $this->change($token, ['email' => $new, 'current_password' => self::TEST_PASSWORD])->assertOk();
        $this->assertSame($old, $this->emailOf($user), 'the address changed before the code from the new address was confirmed');
        $sent->assertJsonPath('destination', TwoFactor::maskEmail($new))
            ->assertJsonPath('expires_in', 600)
            ->assertJsonMissingPath('user');

        $code = $this->codeSentTo($new);
        Mail::assertNotSent(self::CODE_MAIL, fn ($mail) => $mail->hasTo($old));
        $this->assertMatchesRegularExpression('/^\d{6}$/', $code);

        $this->confirm($token, $new, $code)
            ->assertOk()
            ->assertJsonPath('user.email', $new);

        $this->assertSame($new, $this->emailOf($user));
        $this->assertNotNull(DB::table('users')->where('id', $user->id)->value('email_verified_at'));
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
        Mail::assertNotSent(self::CODE_MAIL);

        $this->change($token, ['email' => $new, 'current_password' => self::TEST_PASSWORD, 'code' => Totp::now($secret)])
            ->assertOk();
        $this->assertSame($user->email, $this->emailOf($user), 'the address changed before the code from the new address was confirmed');

        $this->confirm($token, $new, $this->codeSentTo($new))->assertOk();
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
        $this->assertSame($old, $this->emailOf($user), 'the address changed before the code from the new address was confirmed');

        $this->confirm($token, $new, $this->codeSentTo($new))->assertOk();
        $this->assertSame($new, $this->emailOf($user));
    }

    public function test_the_change_signs_out_every_other_session(): void
    {
        Mail::fake();
        $user = $this->makeUser();
        $tokenA = $this->issueToken($user);
        $tokenB = $this->issueToken($user);
        $new = $this->newAddress();

        $this->change($tokenA, ['email' => $new, 'current_password' => self::TEST_PASSWORD])->assertOk();
        // Nothing has changed yet, so nobody is signed out yet.
        $this->withBearer($tokenB)->getJson('/api/user')->assertOk();

        $this->confirm($tokenA, $new, $this->codeSentTo($new))->assertOk();

        $this->withBearer($tokenB)->getJson('/api/user')->assertUnauthorized();
        $this->withBearer($tokenA)->getJson('/api/user')->assertOk();
    }

    /** A sign-in waiting for its second factor ends with the change too. */
    public function test_the_change_ends_open_two_factor_sign_ins(): void
    {
        Mail::fake();
        [$user, $secret] = $this->totpUser();
        $token = $this->issueToken($user);
        $challenge = $this->postJson('/api/login', ['email' => $user->email, 'password' => self::TEST_PASSWORD])
            ->assertOk()
            ->json('two_factor.challenge');

        $new = $this->newAddress();
        $this->change($token, ['email' => $new, 'current_password' => self::TEST_PASSWORD, 'code' => Totp::now($secret)])->assertOk();
        $this->confirm($token, $new, $this->codeSentTo($new))->assertOk();

        // A valid code for the challenge from before the change (the replay marker cleared).
        DB::table('users')->where('id', $user->id)->update(['two_factor_last_step' => null]);
        $this->postJson('/api/login/two-factor', ['challenge' => $challenge, 'code' => Totp::now($secret)])
            ->assertStatus(422)
            ->assertJsonPath('errors.challenge.0', TwoFactor::MSG_EXPIRED_LOGIN);
        $this->assertSame(1, DB::table('personal_access_tokens')->where('tokenable_type', User::class)->where('tokenable_id', $user->id)->count());
    }

    /**
     * The notice goes to the old address, once the change is made; the new address gets only its
     * code. (This test was "..._and_the_new_one_nothing" before the new address got a code.)
     */
    public function test_the_old_address_gets_a_notice_and_the_new_one_only_the_code(): void
    {
        Mail::fake();
        $user = $this->makeUser();
        $token = $this->issueToken($user);
        $old = $user->email;
        $new = $this->newAddress();

        $this->change($token, ['email' => $new, 'current_password' => self::TEST_PASSWORD])->assertOk();
        Mail::assertNotSent(self::NOTICE);
        $code = $this->codeSentTo($new);

        $this->confirm($token, $new, $code)->assertOk();

        Mail::assertSent(self::NOTICE, fn ($mail) => $mail->hasTo($old) && $mail->kind === 'email_changed');
        Mail::assertNotSent(self::NOTICE, fn ($mail) => $mail->hasTo($new));
        $this->assertCount(1, Mail::sent(self::NOTICE));
        $this->assertCount(1, Mail::sent(self::CODE_MAIL));
        Mail::assertNotSent(self::CODE_MAIL, fn ($mail) => $mail->hasTo($old));
    }

    /**
     * The transport takes the code mail to the new address and refuses the notice to the old one.
     * Nothing changes, the other session stays, and the code stays valid for another try.
     */
    public function test_nothing_changes_when_the_notice_cannot_be_sent(): void
    {
        $transport = new class extends AbstractTransport
        {
            public ?string $refuse = null;

            /** @var list<SentMessage> */
            public array $sent = [];

            protected function doSend(SentMessage $message): void
            {
                foreach ($message->getEnvelope()->getRecipients() as $recipient) {
                    if ($recipient->getAddress() === $this->refuse) {
                        throw new TransportException('fixture transport failure');
                    }
                }
                $this->sent[] = $message;
            }

            public function __toString(): string
            {
                return 'failing-for-test';
            }
        };
        Mail::extend('failing-for-test', fn () => $transport);
        config(['mail.mailers.failing-for-test' => ['transport' => 'failing-for-test'], 'mail.default' => 'failing-for-test']);

        $user = $this->makeUser();
        $transport->refuse = $user->email;
        $tokenA = $this->issueToken($user);
        $tokenB = $this->issueToken($user);
        $new = $this->newAddress();

        $this->change($tokenA, ['email' => $new, 'current_password' => self::TEST_PASSWORD])->assertOk();
        $this->assertCount(1, $transport->sent, 'the code mail to the new address was not sent');
        $this->assertMatchesRegularExpression('/\b(\d{6})\b/', $transport->sent[0]->getOriginalMessage()->getTextBody(), 'no code in the mail');
        preg_match('/\b(\d{6})\b/', $transport->sent[0]->getOriginalMessage()->getTextBody(), $m);

        $this->confirm($tokenA, $new, $m[1])
            ->assertStatus(503)
            ->assertJsonPath('message', 'Wir konnten gerade keinen Hinweis an deine bisherige Adresse schicken – deine E-Mail-Adresse bleibt unverändert. Probier es gleich noch mal.');

        $this->assertSame($user->email, $this->emailOf($user));
        $this->withBearer($tokenB)->getJson('/api/user')->assertOk();

        // Once the notice can go out, the same code makes the change.
        $transport->refuse = null;
        $this->confirm($tokenA, $new, $m[1])->assertOk();
        $this->assertSame($new, $this->emailOf($user));
    }

    public function test_taken_reserved_unchanged_and_invalid_addresses_are_refused(): void
    {
        Mail::fake();
        $user = $this->makeUser();
        $token = $this->issueToken($user);
        $other = $this->makeUser();
        $password = ['current_password' => self::TEST_PASSWORD];

        $cases = [
            [$other->email, self::MSG_TAKEN],
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
     * like the domain itself (the cases: ReservedAccountsTest::collationVariants).
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

    /**
     * Since the password reset works by a mailed code (F-09), an open reset is a 'reset' challenge
     * whose code went to the OLD address; it is dropped with the e-mail codes when the change is
     * made. (This test used to insert a reset link
     * row into password_reset_tokens, which nothing writes any more.) The challenges are made
     * directly, with the purpose spelled out, so the test also runs where the code flows do not
     * exist yet.
     */
    public function test_open_reset_codes_and_e_mail_codes_of_the_old_address_are_dropped(): void
    {
        Mail::fake();
        $user = $this->makeUser(['two_factor_method' => TwoFactor::METHOD_EMAIL, 'two_factor_confirmed_at' => now()]);
        $token = $this->issueToken($user);
        TwoFactor::createChallenge($user, 'reset', TwoFactor::METHOD_EMAIL);

        // The confirm code for this change, plus a second open one: both go.
        $this->withBearer($token)->postJson('/api/user/two-factor/code')->assertOk();
        $code = Mail::sent(TwoFactorCode::class)->last()->code;
        TwoFactor::createChallenge($user, TwoFactor::PURPOSE_SETUP, TwoFactor::METHOD_EMAIL);

        $new = $this->newAddress();
        $this->change($token, ['email' => $new, 'current_password' => self::TEST_PASSWORD, 'code' => $code])->assertOk();
        $this->confirm($token, $new, $this->codeSentTo($new))->assertOk();

        $this->assertSame(0, DB::table('two_factor_challenges')
            ->where('user_id', $user->id)
            ->where('purpose', 'reset')
            ->count(), 'an open reset code of the old address survived');
        $this->assertSame(0, DB::table('two_factor_challenges')
            ->where('user_id', $user->id)
            ->whereIn('purpose', [TwoFactor::PURPOSE_SETUP, TwoFactor::PURPOSE_CONFIRM, self::PURPOSE])
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
        Mail::assertNothingSent();
    }

    /** The code confirms the address it was mailed to; with any other address it is wrong. */
    public function test_the_code_confirms_only_the_address_it_was_mailed_to(): void
    {
        Mail::fake();
        $user = $this->makeUser();
        $token = $this->issueToken($user);
        $new = $this->newAddress();

        $this->change($token, ['email' => $new, 'current_password' => self::TEST_PASSWORD])->assertOk();
        $code = $this->codeSentTo($new);

        $elsewhere = $this->newAddress();
        $this->confirm($token, $elsewhere, $code)
            ->assertStatus(422)
            ->assertJsonPath('errors.code.0', TwoFactor::MSG_WRONG);
        $this->assertSame($user->email, $this->emailOf($user));

        $this->confirm($token, $new, $code)->assertOk();
        $this->assertSame($new, $this->emailOf($user));
    }

    public function test_a_wrong_code_changes_nothing_and_five_use_the_code_up(): void
    {
        Mail::fake();
        $user = $this->makeUser();
        $token = $this->issueToken($user);
        $new = $this->newAddress();

        $this->change($token, ['email' => $new, 'current_password' => self::TEST_PASSWORD])->assertOk();
        $code = $this->codeSentTo($new);
        $wrong = self::otherCode($code);

        for ($i = 1; $i <= 4; $i++) {
            $this->confirm($token, $new, $wrong)->assertStatus(422)->assertJsonPath('errors.code.0', TwoFactor::MSG_WRONG);
        }
        $this->confirm($token, $new, $wrong)->assertStatus(422)->assertJsonPath('errors.code.0', TwoFactor::MSG_TOO_MANY);
        // Used up: the right code does not help any more.
        $this->confirm($token, $new, $code)->assertStatus(422)->assertJsonPath('errors.code.0', TwoFactor::MSG_TOO_MANY);

        $this->assertSame($user->email, $this->emailOf($user));
    }

    public function test_a_malformed_code_is_refused_before_it_is_checked(): void
    {
        Mail::fake();
        $user = $this->makeUser();
        $token = $this->issueToken($user);
        $new = $this->newAddress();

        $this->change($token, ['email' => $new, 'current_password' => self::TEST_PASSWORD])->assertOk();

        $this->confirm($token, $new, '12345')->assertStatus(422)->assertJsonPath('errors.code.0', self::MSG_CODE_SHAPE);
        $this->confirm($token, $new, str_repeat('1', 10000))->assertStatus(422)->assertJsonPath('errors.code.0', self::MSG_CODE_SHAPE);
        $this->confirm($token, $new, '')->assertStatus(422)->assertJsonPath('errors.code.0', TwoFactor::MSG_CODE_REQUIRED);

        $this->assertSame(0, (int) DB::table('two_factor_challenges')->where('user_id', $user->id)->where('purpose', self::PURPOSE)->value('attempts'));
        $this->assertSame($user->email, $this->emailOf($user));
    }

    public function test_the_code_expires_after_ten_minutes(): void
    {
        Mail::fake();
        $user = $this->makeUser();
        $token = $this->issueToken($user);
        $new = $this->newAddress();

        $this->change($token, ['email' => $new, 'current_password' => self::TEST_PASSWORD])->assertOk();
        $code = $this->codeSentTo($new);

        $this->travel(601)->seconds();

        $this->confirm($token, $new, $code)->assertStatus(422)->assertJsonPath('errors.code.0', TwoFactor::MSG_EXPIRED);
        $this->assertSame($user->email, $this->emailOf($user));
    }

    public function test_confirming_without_a_pending_change_is_refused(): void
    {
        Mail::fake();
        $user = $this->makeUser();

        $this->confirm($this->issueToken($user), $this->newAddress(), '123456')
            ->assertStatus(422)
            ->assertJsonPath('errors.code.0', TwoFactor::MSG_EXPIRED);

        $this->assertSame($user->email, $this->emailOf($user));
        Mail::assertNothingSent();
    }

    public function test_code_mails_are_a_minute_apart_and_a_new_code_replaces_the_previous_one(): void
    {
        Mail::fake();
        $user = $this->makeUser();
        $token = $this->issueToken($user);
        $new = $this->newAddress();

        $this->change($token, ['email' => $new, 'current_password' => self::TEST_PASSWORD])->assertOk();
        $first = $this->codeSentTo($new);

        $wait = $this->change($token, ['email' => $new, 'current_password' => self::TEST_PASSWORD])
            ->assertStatus(429)
            ->assertJsonPath('message', TwoFactor::MSG_RESEND_WAIT)
            ->json('retry_after');
        $this->assertGreaterThan(0, $wait);
        $this->assertLessThanOrEqual(60, $wait);
        $this->codeSentTo($new);

        $this->travel(61)->seconds();
        $this->change($token, ['email' => $new, 'current_password' => self::TEST_PASSWORD])->assertOk();
        $second = $this->codeSentTo($new, 2);
        $this->assertSame(1, DB::table('two_factor_challenges')->where('user_id', $user->id)->where('purpose', self::PURPOSE)->count());

        if ($first !== $second) {
            $this->confirm($token, $new, $first)->assertStatus(422)->assertJsonPath('errors.code.0', TwoFactor::MSG_WRONG);
        }
        $this->confirm($token, $new, $second)->assertOk();
        $this->assertSame($new, $this->emailOf($user));
    }

    /**
     * A request refused for the minute between two mails does not use up the second-factor code
     * it carries: here a recovery code, which would be gone for good.
     */
    public function test_a_refused_request_does_not_use_up_the_second_factor_code(): void
    {
        Mail::fake();
        [$user, $secret] = $this->totpUser();
        $recovery = TwoFactor::replaceRecoveryCodes($user)[0];
        $token = $this->issueToken($user);
        $new = $this->newAddress();

        $this->change($token, ['email' => $new, 'current_password' => self::TEST_PASSWORD, 'code' => Totp::now($secret)])->assertOk();
        $this->change($token, ['email' => $new, 'current_password' => self::TEST_PASSWORD, 'code' => $recovery])->assertStatus(429);

        $this->travel(61)->seconds();
        $this->change($token, ['email' => $new, 'current_password' => self::TEST_PASSWORD, 'code' => $recovery])->assertOk();
        $this->codeSentTo($new, 2);
    }

    /** The code is kept only as a keyed hash, and the new address is not stored at all. */
    public function test_the_code_is_stored_only_as_a_keyed_hash_and_the_address_not_at_all(): void
    {
        Mail::fake();
        $user = $this->makeUser();
        $new = $this->newAddress();

        $this->change($this->issueToken($user), ['email' => $new, 'current_password' => self::TEST_PASSWORD])->assertOk();
        $code = $this->codeSentTo($new);

        $rows = DB::table('two_factor_challenges')->where('user_id', $user->id)->where('purpose', self::PURPOSE)->get();
        $this->assertCount(1, $rows);
        $row = (array) $rows->first();
        $this->assertMatchesRegularExpression('/^[0-9a-f]{64}$/', (string) $row['code_hash']);
        $this->assertNotSame(hash('sha256', $code), $row['code_hash']);
        $stored = json_encode($row);
        $this->assertStringNotContainsString($code, $stored);
        $this->assertStringNotContainsString($new, $stored);
        $this->assertStringNotContainsString(strstr($new, '@', true), $stored);
    }

    public function test_an_address_taken_after_the_code_was_sent_is_refused(): void
    {
        Mail::fake();
        $user = $this->makeUser();
        $token = $this->issueToken($user);
        $new = $this->newAddress();

        $this->change($token, ['email' => $new, 'current_password' => self::TEST_PASSWORD])->assertOk();
        $code = $this->codeSentTo($new);
        $this->makeUser(['email' => $new]);

        $this->confirm($token, $new, $code)->assertStatus(422)->assertJsonPath('errors.email.0', self::MSG_TAKEN);
        $this->assertSame($user->email, $this->emailOf($user));
    }

    /** A new password ends a pending change: it was asked for with the old one. */
    public function test_a_password_change_ends_a_pending_change(): void
    {
        Mail::fake();
        $user = $this->makeUser();
        $token = $this->issueToken($user);
        $new = $this->newAddress();

        $this->change($token, ['email' => $new, 'current_password' => self::TEST_PASSWORD])->assertOk();
        $code = $this->codeSentTo($new);

        $this->withBearer($token)
            ->putJson('/api/user/password', ['current_password' => self::TEST_PASSWORD, 'password' => 'Fixture-New-Pass-8642'])
            ->assertOk();

        $this->confirm($token, $new, $code)->assertStatus(422)->assertJsonPath('errors.code.0', TwoFactor::MSG_EXPIRED);
        $this->assertSame($user->email, $this->emailOf($user));
    }

    /**
     * Wrong codes count toward the account's cap of wrong codes (config
     * ratelimits.two-factor-failures, 10 in 15 minutes), as every code a signed-in account types:
     * at the cap no code is checked and none is mailed.
     */
    public function test_wrong_codes_count_toward_the_accounts_cap(): void
    {
        Mail::fake();
        $user = $this->makeUser();
        $token = $this->issueToken($user);
        $new = $this->newAddress();

        $this->change($token, ['email' => $new, 'current_password' => self::TEST_PASSWORD])->assertOk();
        $code = $this->codeSentTo($new);
        for ($i = 0; $i < 5; $i++) {
            $this->confirm($token, $new, self::otherCode($code))->assertStatus(422);
        }

        $this->travel(61)->seconds();
        $this->change($token, ['email' => $new, 'current_password' => self::TEST_PASSWORD])->assertOk();
        $code = $this->codeSentTo($new, 2);
        for ($i = 0; $i < 5; $i++) {
            $this->confirm($token, $new, self::otherCode($code))->assertStatus(422);
        }

        // Ten wrong codes: the right one is not even looked at, and no new code is mailed.
        $this->confirm($token, $new, $code)->assertStatus(422)->assertJsonPath('errors.code.0', TwoFactor::lockedMessage($user->id));
        $this->travel(61)->seconds();
        $this->change($token, ['email' => $new, 'current_password' => self::TEST_PASSWORD])
            ->assertStatus(422)
            ->assertJsonPath('errors.code.0', TwoFactor::lockedMessage($user->id));
        $this->codeSentTo($new, 2);
        $this->assertSame($user->email, $this->emailOf($user));
    }

    public function test_both_steps_need_a_session(): void
    {
        Mail::fake();
        $this->putJson('/api/user/email', ['email' => $this->newAddress(), 'current_password' => self::TEST_PASSWORD])->assertUnauthorized();
        $this->postJson('/api/user/email/confirm', ['email' => $this->newAddress(), 'code' => '123456'])->assertUnauthorized();
        Mail::assertNothingSent();
    }
}
