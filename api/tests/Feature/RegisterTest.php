<?php

namespace Tests\Feature;

use App\Support\BlockedTerms;
use App\Support\PasswordPolicy;
use Illuminate\Testing\TestResponse;
use Tests\AppFeatureTestCase;

/**
 * POST /api/register: password rule and the word filter. (The account tiers and their sign-up
 * checks are gone with the marketplace.)
 *
 * Sign-up belongs to Laravel; Node's copy of this route is deleted (F-01, one owner per path).
 * These tests were Node tests of that copy and moved here with the same assertions:
 * server/test/account.test.js (password rule) and server/test/blocked-terms-routes.test.js (word
 * filter).
 */
class RegisterTest extends AppFeatureTestCase
{
    /** A sign-up with a fresh identity; $overrides replace single fields. */
    private function register(string $prefix, array $overrides = []): TestResponse
    {
        $username = self::freeUsername($prefix);

        return $this->postJson('/api/register', array_merge([
            'name' => $prefix.' Test',
            'username' => $username,
            'email' => $username.'@example.invalid',
            'password' => self::TEST_PASSWORD,
            'device_name' => 'test',
        ], self::consent(), $overrides));
    }

    public function test_common_passwords_are_rejected_case_insensitively(): void
    {
        foreach (['Passwort1', 'schalke04', 'QWERTZ123'] as $password) {
            $this->register('regcommon', ['password' => $password])
                ->assertStatus(422)
                ->assertJsonPath('message', PasswordPolicy::MSG_COMMON)
                ->assertJsonPath('errors.password', [PasswordPolicy::MSG_COMMON]);
        }
    }

    public function test_password_containing_username_or_mail_part_is_rejected(): void
    {
        $username = substr(self::freeUsername('regname'), 0, 20);
        $this->register('regname', ['username' => $username, 'password' => strtoupper($username).'9'])
            ->assertStatus(422)
            ->assertJsonPath('message', PasswordPolicy::MSG_PERSONAL);

        // Digits after the word, so the password passes the basic rule and fails only this one.
        $local = 'mailteil'.random_int(10_000_000, 99_999_999);
        $this->register('regmail', ['email' => $local.'@example.invalid', 'password' => 'x'.$local])
            ->assertStatus(422)
            ->assertJsonPath('message', PasswordPolicy::MSG_PERSONAL);
    }

    public function test_basic_password_rule_message_is_unchanged(): void
    {
        $this->register('regbasic', ['password' => 'nurbuchstaben'])
            ->assertStatus(422)
            ->assertJsonPath('message', 'Das Passwort muss mindestens 8 Zeichen mit Buchstaben und Zahlen haben.');
    }

    public function test_blocked_username_and_name_are_rejected(): void
    {
        $terms = BlockedTerms::default();

        $this->register('blockterm', ['username' => 'xXhurensohnXx'])
            ->assertStatus(422)
            ->assertJsonPath('errors.username', [$terms->message('username')]);

        $this->register('blockterm', ['name' => 'Adolf Hitler'])
            ->assertStatus(422)
            ->assertJsonPath('message', $terms->message('name'));

        // A real surname in the name field passes.
        $this->register('blockterm', ['name' => 'Adolf Fick'])->assertCreated();
    }
}
