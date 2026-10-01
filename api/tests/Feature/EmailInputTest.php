<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Tests\AppFeatureTestCase;

/**
 * Every route that takes an e-mail address refuses one longer than 254 characters with the
 * e-mail message, and answers a 100,000-character value fast (F-02). The check itself:
 * tests/Unit/EmailAddressTest.php.
 */
class EmailInputTest extends AppFeatureTestCase
{
    /** The text the app shows for a bad address (App\Rules\ValidEmail::MESSAGE). */
    private const MSG_EMAIL = 'Bitte eine gueltige E-Mail-Adresse angeben.';

    /** A well-formed address of exactly $length characters. */
    private static function addressOfLength(int $length): string
    {
        $domain = '@example.invalid';

        return str_repeat('a', $length - strlen($domain)).$domain;
    }

    /** The four public routes that read an e-mail address, with an otherwise valid body. */
    private function send(string $route, string $email): TestResponse
    {
        $password = 'Fixture-Only-Pass-'.random_int(1000, 9999).'x';

        return match ($route) {
            'register' => $this->postJson('/api/register', [
                'name' => 'Feature Test',
                'username' => self::freeUsername('mail'),
                'email' => $email,
                'password' => $password,
                'account_type' => 'standard',
            ]),
            'login' => $this->postJson('/api/login', ['email' => $email, 'password' => $password]),
            'forgot' => $this->postJson('/api/forgot-password', ['email' => $email]),
            'reset' => $this->postJson('/api/reset-password', [
                'token' => 'fixture-reset-token-not-a-secret',
                'email' => $email,
                'password' => $password,
            ]),
        };
    }

    public function test_register_refuses_an_address_over_254_characters(): void
    {
        $email = self::addressOfLength(255);

        $this->send('register', $email)
            ->assertStatus(422)
            ->assertJsonPath('errors.email.0', self::MSG_EMAIL);

        $this->assertFalse(DB::table('users')->where('email', $email)->exists());
    }

    public function test_register_accepts_an_address_of_254_characters(): void
    {
        $email = self::addressOfLength(254);

        $this->send('register', $email)->assertCreated();

        $this->assertTrue(DB::table('users')->where('email', $email)->exists());
    }

    public function test_sign_in_and_password_routes_refuse_an_address_over_254_characters(): void
    {
        foreach (['login', 'forgot', 'reset'] as $route) {
            $this->send($route, self::addressOfLength(255))
                ->assertStatus(422)
                ->assertJsonPath('errors.email.0', self::MSG_EMAIL);
        }
    }

    public function test_100000_character_addresses_are_answered_fast_on_every_route(): void
    {
        $shapes = [
            'long local part' => str_repeat('a', 100000).'@example.invalid',
            'many dots in the domain' => 'a@'.str_repeat('b.', 50000).'c',
        ];

        $checked = 0;
        foreach (['register', 'login', 'forgot', 'reset'] as $route) {
            foreach ($shapes as $shape => $email) {
                $start = hrtime(true);
                $response = $this->send($route, $email);
                $seconds = (hrtime(true) - $start) / 1e9;

                $response->assertStatus(422)->assertJsonPath('errors.email.0', self::MSG_EMAIL);
                // Generous: the check takes microseconds; the bound only catches a slow pattern.
                $this->assertLessThan(2.0, $seconds, "{$route}, {$shape}: {$seconds} s");
                $checked++;
            }
        }

        $this->assertSame(8, $checked);
    }
}
