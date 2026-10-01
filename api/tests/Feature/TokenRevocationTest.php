<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\AppFeatureTestCase;

/**
 * Credential changes end the other sessions (F-20). The account has two tokens: A, the one the
 * change is made with, and B, another device. After a change made while signed in, B is refused
 * and A still works; after a password reset, where nobody is signed in, both are refused.
 *
 * Denominator: every action that changes a credential is a row of credentialChanges() (the
 * e-mail change and the two-factor changes have their own rows in EmailChangeTest and
 * TwoFactorHardeningTest, next to their other checks).
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

    private function perform(string $change, User $user, string $token): void
    {
        $newPassword = 'Fixture-New-Pass-8642';

        match ($change) {
            'password-change' => $this->withBearer($token)
                ->putJson('/api/user/password', ['current_password' => self::TEST_PASSWORD, 'password' => $newPassword])
                ->assertOk(),
            'password-reset' => (function () use ($user, $newPassword) {
                // The reset row the mail would point to (written with Laravel's clock, like the
                // other reset tests: the test MySQL runs in UTC, APP_TIMEZONE may not).
                DB::table('password_reset_tokens')->insert([
                    'email' => $user->email,
                    'token' => Hash::make('fixture-reset-token-not-a-secret'),
                    'created_at' => now(),
                ]);
                $this->postJson('/api/reset-password', [
                    'token' => 'fixture-reset-token-not-a-secret',
                    'email' => $user->email,
                    'password' => $newPassword,
                ])->assertOk();
            })(),
        };
    }
}
