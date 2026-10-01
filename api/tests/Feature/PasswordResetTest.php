<?php

namespace Tests\Feature;

use App\Support\PasswordPolicy;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Tests\AppFeatureTestCase;

/**
 * POST /api/reset-password applies the password rule; the username part only after a valid token.
 *
 * The route belongs to Laravel; Node's copy is deleted (F-01, one owner per path). This test was
 * a Node test of that copy (server/test/account.test.js) and moved here with the same assertions.
 */
class PasswordResetTest extends AppFeatureTestCase
{
    public function test_reset_applies_the_password_rule_and_checks_the_username_only_after_a_valid_token(): void
    {
        $this->postJson('/api/reset-password', ['token' => 'x', 'email' => 'niemand@example.invalid', 'password' => 'hallo123'])
            ->assertStatus(422)
            ->assertJsonPath('message', PasswordPolicy::MSG_COMMON);

        // The address must not carry the username as its local part: then the (public) e-mail
        // check would already fire, and the test would no longer show that the username check
        // comes only after the token.
        $user = $this->makeUser();
        $email = 'resetpost'.random_int(10_000_000, 99_999_999).'@example.invalid';
        DB::table('users')->where('id', $user->id)->update(['email' => $email]);
        $password = $user->username.'77';

        // Wrong token: the neutral answer, no hint at the username.
        $this->postJson('/api/reset-password', ['token' => 'falsch', 'email' => $email, 'password' => $password])
            ->assertStatus(422)
            ->assertJsonPath('message', 'Dieser Link zum Zuruecksetzen ist ungueltig.');

        // Written with Laravel's clock, the one the controller compares with. (The test database
        // runs in UTC while APP_TIMEZONE defaults to Europe/Berlin; a NOW() from MySQL would make
        // the token look hours old here. Production sets APP_TIMEZONE=UTC.)
        DB::table('password_reset_tokens')->insert([
            'email' => $email,
            'token' => Hash::make('richtig'),
            'created_at' => now(),
        ]);

        $this->postJson('/api/reset-password', ['token' => 'richtig', 'email' => $email, 'password' => $password])
            ->assertStatus(422)
            ->assertJsonPath('message', PasswordPolicy::MSG_PERSONAL);
    }
}
