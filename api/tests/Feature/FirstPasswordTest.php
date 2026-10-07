<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\TwoFactor;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Illuminate\Testing\TestResponse;
use Tests\AppFeatureTestCase;

/**
 * An account without a password (created by the removed Google sign-in) sets its first password
 * only with a one-time code mailed to its own address (F-04): POST /api/user/password/code, then
 * PUT /api/user/password {password, code}. The session alone used to be enough, so a stolen or
 * borrowed token could give the account a password of its holder's choosing. Accounts with a
 * password keep changing it with the current one.
 *
 * The mail class and the challenge purpose are named as strings: the tests must run (and fail) on
 * code without them.
 */
class FirstPasswordTest extends AppFeatureTestCase
{
    private const CODE_MAIL = 'App\\Mail\\FirstPasswordCode';

    private const PURPOSE = 'first_pw';

    private const NEW_PASSWORD = 'Fixture-First-Pass-9753';

    private const MSG_CODE_NEEDED = 'Dein Konto hat noch kein Passwort. Fordere einen Code per E-Mail an und gib ihn hier ein.';

    private const MSG_HAS_PASSWORD = 'Dein Konto hat schon ein Passwort – zum Ändern brauchst du das aktuelle.';

    private function passwordless(): User
    {
        return $this->makeUser(['password' => null]);
    }

    private function requestCode(string $token): TestResponse
    {
        return $this->withBearer($token)->postJson('/api/user/password/code');
    }

    private function setPassword(string $token, array $body): TestResponse
    {
        return $this->withBearer($token)->putJson('/api/user/password', $body);
    }

    private function storedPassword(User $user): ?string
    {
        return DB::table('users')->where('id', $user->id)->value('password');
    }

    /** The code of the last code mail to $address, after checking that $count went there. */
    private function codeSentTo(string $address, int $count = 1): string
    {
        $mails = Mail::sent(self::CODE_MAIL, fn ($mail) => $mail->hasTo($address));
        $this->assertCount($count, $mails, "expected {$count} code mail(s) to the account's address");

        return (string) $mails->last()->code;
    }

    private static function otherCode(string $code): string
    {
        return sprintf('%06d', ((int) $code + 1) % 1000000);
    }

    public function test_the_session_alone_no_longer_sets_a_first_password(): void
    {
        Mail::fake();
        $user = $this->passwordless();

        $this->setPassword($this->issueToken($user), ['password' => self::NEW_PASSWORD, 'password_confirmation' => self::NEW_PASSWORD])
            ->assertStatus(422)
            ->assertJsonPath('errors.code.0', self::MSG_CODE_NEEDED);

        $this->assertNull($this->storedPassword($user), 'a first password was set with the session alone');
    }

    public function test_the_code_goes_to_the_accounts_own_address(): void
    {
        Mail::fake();
        $user = $this->passwordless();

        $this->requestCode($this->issueToken($user))
            ->assertOk()
            ->assertJsonPath('destination', TwoFactor::maskEmail($user->email))
            ->assertJsonPath('expires_in', 600);

        $code = $this->codeSentTo($user->email);
        $this->assertMatchesRegularExpression('/^\d{6}$/', $code);
        $this->assertCount(1, Mail::sent(self::CODE_MAIL));
        $this->assertNull($this->storedPassword($user));
    }

    public function test_with_the_mailed_code_the_first_password_is_set_and_other_sessions_end(): void
    {
        Mail::fake();
        $user = $this->passwordless();
        $tokenA = $this->issueToken($user);
        $tokenB = $this->issueToken($user);

        $this->requestCode($tokenA)->assertOk();
        $code = $this->codeSentTo($user->email);

        $this->setPassword($tokenA, ['password' => self::NEW_PASSWORD, 'password_confirmation' => self::NEW_PASSWORD, 'code' => $code])
            ->assertOk()
            ->assertJsonPath('message', 'Passwort geändert.');

        $this->assertTrue(Hash::check(self::NEW_PASSWORD, (string) $this->storedPassword($user)));
        $this->withBearer($tokenB)->getJson('/api/user')->assertUnauthorized();
        $this->withBearer($tokenA)->getJson('/api/user')->assertOk();
        $this->assertSame(0, DB::table('two_factor_challenges')->where('user_id', $user->id)->where('purpose', self::PURPOSE)->count());

        // The account has a password now: the next change needs it, a code is no longer enough.
        $this->setPassword($tokenA, ['password' => 'Fixture-Other-Pass-1357', 'code' => $code])
            ->assertStatus(422)
            ->assertJsonValidationErrors('current_password');
        $this->assertTrue(Hash::check(self::NEW_PASSWORD, (string) $this->storedPassword($user)));
    }

    public function test_a_wrong_code_sets_nothing_and_five_use_the_code_up(): void
    {
        Mail::fake();
        $user = $this->passwordless();
        $token = $this->issueToken($user);

        $this->requestCode($token)->assertOk();
        $code = $this->codeSentTo($user->email);
        $body = ['password' => self::NEW_PASSWORD, 'code' => self::otherCode($code)];

        for ($i = 1; $i <= 4; $i++) {
            $this->setPassword($token, $body)->assertStatus(422)->assertJsonPath('errors.code.0', TwoFactor::MSG_WRONG);
        }
        $this->setPassword($token, $body)->assertStatus(422)->assertJsonPath('errors.code.0', TwoFactor::MSG_TOO_MANY);
        $this->setPassword($token, ['code' => $code] + $body)->assertStatus(422)->assertJsonPath('errors.code.0', TwoFactor::MSG_TOO_MANY);

        $this->assertNull($this->storedPassword($user));
    }

    /** The new password is checked first: a weak one does not cost the code an attempt. */
    public function test_the_new_password_is_checked_before_the_code(): void
    {
        Mail::fake();
        $user = $this->passwordless();
        $token = $this->issueToken($user);

        $this->requestCode($token)->assertOk();
        $code = $this->codeSentTo($user->email);

        $this->setPassword($token, ['password' => 'short', 'code' => $code])->assertStatus(422)->assertJsonValidationErrors('password');
        $this->assertSame(0, (int) DB::table('two_factor_challenges')->where('user_id', $user->id)->where('purpose', self::PURPOSE)->value('attempts'));

        $this->setPassword($token, ['password' => self::NEW_PASSWORD, 'code' => $code])->assertOk();
        $this->assertTrue(Hash::check(self::NEW_PASSWORD, (string) $this->storedPassword($user)));
    }

    public function test_an_account_with_a_password_gets_no_code_and_still_needs_its_current_one(): void
    {
        Mail::fake();
        $user = $this->makeUser();
        $token = $this->issueToken($user);

        $this->requestCode($token)->assertStatus(409)->assertJsonPath('message', self::MSG_HAS_PASSWORD);
        Mail::assertNothingSent();

        $this->setPassword($token, ['password' => self::NEW_PASSWORD, 'code' => '123456'])
            ->assertStatus(422)
            ->assertJsonValidationErrors('current_password');
        $this->assertTrue(Hash::check(self::TEST_PASSWORD, (string) $this->storedPassword($user)));
    }

    public function test_code_mails_are_a_minute_apart_and_a_new_code_replaces_the_previous_one(): void
    {
        Mail::fake();
        $user = $this->passwordless();
        $token = $this->issueToken($user);

        $this->requestCode($token)->assertOk();
        $first = $this->codeSentTo($user->email);

        $wait = $this->requestCode($token)
            ->assertStatus(429)
            ->assertJsonPath('message', TwoFactor::MSG_RESEND_WAIT)
            ->json('retry_after');
        $this->assertGreaterThan(0, $wait);
        $this->assertLessThanOrEqual(60, $wait);
        $this->codeSentTo($user->email);

        $this->travel(61)->seconds();
        $this->requestCode($token)->assertOk();
        $second = $this->codeSentTo($user->email, 2);
        $this->assertSame(1, DB::table('two_factor_challenges')->where('user_id', $user->id)->where('purpose', self::PURPOSE)->count());

        if ($first !== $second) {
            $this->setPassword($token, ['password' => self::NEW_PASSWORD, 'code' => $first])
                ->assertStatus(422)
                ->assertJsonPath('errors.code.0', TwoFactor::MSG_WRONG);
        }
        $this->setPassword($token, ['password' => self::NEW_PASSWORD, 'code' => $second])->assertOk();
    }

    public function test_the_code_expires_after_ten_minutes(): void
    {
        Mail::fake();
        $user = $this->passwordless();
        $token = $this->issueToken($user);

        $this->requestCode($token)->assertOk();
        $code = $this->codeSentTo($user->email);

        $this->travel(601)->seconds();

        $this->setPassword($token, ['password' => self::NEW_PASSWORD, 'code' => $code])
            ->assertStatus(422)
            ->assertJsonPath('errors.code.0', TwoFactor::MSG_EXPIRED);
        $this->assertNull($this->storedPassword($user));
    }

    /** The code belongs to the address it was mailed to: once the account has another, it is void. */
    public function test_the_code_is_bound_to_the_address_it_was_mailed_to(): void
    {
        Mail::fake();
        $user = $this->passwordless();
        $token = $this->issueToken($user);

        $this->requestCode($token)->assertOk();
        $code = $this->codeSentTo($user->email);
        DB::table('users')->where('id', $user->id)->update(['email' => self::freeUsername('other').'@example.invalid']);

        $this->setPassword($token, ['password' => self::NEW_PASSWORD, 'code' => $code])
            ->assertStatus(422)
            ->assertJsonPath('errors.code.0', TwoFactor::MSG_WRONG);
        $this->assertNull($this->storedPassword($user));
    }

    public function test_both_steps_need_a_session(): void
    {
        Mail::fake();
        $this->postJson('/api/user/password/code')->assertUnauthorized();
        $this->putJson('/api/user/password', ['password' => self::NEW_PASSWORD, 'code' => '123456'])->assertUnauthorized();
        Mail::assertNothingSent();
    }
}
