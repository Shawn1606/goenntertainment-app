<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\Totp;
use App\Support\TwoFactor;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\AppFeatureTestCase;

/**
 * Credential changes end the other sessions (F-20). The account has two tokens: A, the one the
 * change is made with, and B, another device. After a change made while signed in, B is refused
 * and A still works; after a password reset, where nobody is signed in, both are refused.
 *
 * Denominator: every action that changes a credential is a row of credentialChanges() (the
 * e-mail change and the two-factor changes have their own rows in EmailChangeTest and
 * TwoFactorHardeningTest, next to their other checks). The password reset runs the code flow
 * (F-09): the code from the reset mail, where it used to insert a link token row.
 */
class TokenRevocationTest extends AppFeatureTestCase
{
    public static function credentialChanges(): array
    {
        return [
            'password change (signed in)' => ['password-change', false],
            'password reset (signed out)' => ['password-reset', true],
        ];
    }

    #[DataProvider('credentialChanges')]
    public function test_credential_changes_revoke_the_other_tokens(string $change, bool $revokesAll): void
    {
        $user = $this->makeUser();
        $tokenA = $this->issueToken($user);
        $tokenB = $this->issueToken($user);

        $this->perform($change, $user, $tokenA);

        $this->withBearer($tokenB)->getJson('/api/user')->assertUnauthorized();
        $this->withBearer($tokenA)->getJson('/api/user')->assertStatus($revokesAll ? 401 : 200);
        $this->assertSame(
            $revokesAll ? 0 : 1,
            DB::table('personal_access_tokens')->where('tokenable_type', User::class)->where('tokenable_id', $user->id)->count(),
        );
    }

    /**
     * A sign-in that has passed the password and waits for the second factor is a session in the
     * making, and a credential change ends it too: the old challenge does not
     * turn into a token, even with a valid code. The account uses an authenticator app, so a
     * valid code is at hand.
     */
    #[DataProvider('credentialChanges')]
    public function test_credential_changes_end_open_two_factor_sign_ins(string $change, bool $revokesAll): void
    {
        $secret = Totp::generateSecret();
        $user = $this->makeUser([
            'two_factor_method' => TwoFactor::METHOD_TOTP,
            'two_factor_secret' => $secret,
            'two_factor_confirmed_at' => now(),
        ]);
        $token = $this->issueToken($user);
        $challenge = $this->postJson('/api/login', ['email' => $user->email, 'password' => self::TEST_PASSWORD])
            ->assertOk()
            ->json('two_factor.challenge');

        $this->perform($change, $user, $token);

        $this->postJson('/api/login/two-factor', ['challenge' => $challenge, 'code' => Totp::now($secret)])
            ->assertStatus(422)
            ->assertJsonPath('errors.challenge.0', TwoFactor::MSG_EXPIRED_LOGIN);
        $this->assertSame(0, DB::table('two_factor_challenges')->where('user_id', $user->id)->where('purpose', TwoFactor::PURPOSE_LOGIN)->count());
        $this->assertSame(
            $revokesAll ? 0 : 1,
            DB::table('personal_access_tokens')->where('tokenable_type', User::class)->where('tokenable_id', $user->id)->count(),
            'no token was issued for the old sign-in',
        );
    }

    private function perform(string $change, User $user, string $token): void
    {
        $newPassword = 'Fixture-New-Pass-8642';

        match ($change) {
            'password-change' => $this->withBearer($token)
                ->putJson('/api/user/password', ['current_password' => self::TEST_PASSWORD, 'password' => $newPassword])
                ->assertOk(),
            'password-reset' => (function () use ($user, $newPassword) {
                // The code the reset mail carries (signed out: no bearer token on these requests).
                Mail::fake();
                $this->postJson('/api/forgot-password', ['email' => $user->email])->assertOk();
                Mail::assertSent('App\\Mail\\PasswordResetCode');
                $this->postJson('/api/reset-password', [
                    'email' => $user->email,
                    'code' => (string) Mail::sent('App\\Mail\\PasswordResetCode')->last()->code,
                    'password' => $newPassword,
                ])->assertOk();
            })(),
        };
    }
}
