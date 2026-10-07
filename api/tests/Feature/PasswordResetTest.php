<?php

namespace Tests\Feature;

use App\Support\PasswordPolicy;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Tests\AppFeatureTestCase;

/**
 * POST /api/reset-password applies the password rule; the username part only after a valid code.
 *
 * The route belongs to Laravel; Node's copy is deleted (F-01, one owner per path). This test was
 * a Node test of that copy (server/test/account.test.js) and moved here with the same assertions.
 * Since the reset works by a mailed code instead of a link (F-09), the valid token is a code from
 * the reset mail and the wrong one a wrong code; the neutral answer to it is the code message.
 */
class PasswordResetTest extends AppFeatureTestCase
{
    public function test_reset_applies_the_password_rule_and_checks_the_username_only_after_a_valid_code(): void
    {
        Mail::fake();

        $this->postJson('/api/reset-password', ['code' => '123456', 'email' => 'niemand@example.invalid', 'password' => 'hallo123'])
            ->assertStatus(422)
            ->assertJsonPath('message', PasswordPolicy::MSG_COMMON);

        // The address must not carry the username as its local part: then the (public) e-mail
        // check would already fire, and the test would no longer show that the username check
        // comes only after the code.
        $user = $this->makeUser();
        $email = 'resetpost'.random_int(10_000_000, 99_999_999).'@example.invalid';
        DB::table('users')->where('id', $user->id)->update(['email' => $email]);
        $password = $user->username.'77';

        $this->postJson('/api/forgot-password', ['email' => $email])->assertOk();
        Mail::assertSent('App\\Mail\\PasswordResetCode');
        $code = (string) Mail::sent('App\\Mail\\PasswordResetCode')->last()->code;
        $wrong = sprintf('%06d', ((int) $code + 1) % 1000000);

        // Wrong code: the neutral answer, no hint at the username.
        $this->postJson('/api/reset-password', ['code' => $wrong, 'email' => $email, 'password' => $password])
            ->assertStatus(422)
            ->assertJsonPath('message', 'Der Code ist ungültig oder abgelaufen. Fordere bei Bedarf einen neuen an.');

        $this->postJson('/api/reset-password', ['code' => $code, 'email' => $email, 'password' => $password])
            ->assertStatus(422)
            ->assertJsonPath('message', PasswordPolicy::MSG_PERSONAL);
    }
}
