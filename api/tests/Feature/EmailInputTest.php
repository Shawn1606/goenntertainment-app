<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Tests\AppFeatureTestCase;

/**
 * Every route that takes an e-mail address refuses one longer than 254 characters with the
 * e-mail message, and answers a 100,000-character value fast (F-02): in a multipart form with the
 * e-mail message, as JSON with the body limit's 413. The check itself:
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

    /**
     * The four public routes that read an e-mail address, with an otherwise valid body, sent as
     * JSON or as a multipart form. A JSON body over 32 kB is refused before validation (413,
     * RequestBodyLimitTest); a multipart POST is parsed by PHP and is the one way a 100,000-character
     * value still reaches the e-mail check.
     */
    private function send(string $route, string $email, bool $asForm = false): TestResponse
    {
        $password = 'Fixture-Only-Pass-'.random_int(1000, 9999).'x';

        [$uri, $data] = match ($route) {
            'register' => ['/api/register', [
                'name' => 'Feature Test',
                'username' => self::freeUsername('mail'),
                'email' => $email,
                'password' => $password,
                'account_type' => 'standard',
                ...self::consent(),
            ]],
            'login' => ['/api/login', ['email' => $email, 'password' => $password]],
            'forgot' => ['/api/forgot-password', ['email' => $email]],
            // The code flow (F-09): a well-formed code, so only the address can be wrong.
            'reset' => ['/api/reset-password', [
                'code' => '123456',
                'email' => $email,
                'password' => $password,
            ]],
        };

        return $asForm
            ? $this->call('POST', $uri, $data, [], [], [
                'CONTENT_TYPE' => 'multipart/form-data; boundary=----fixture-boundary',
                'HTTP_ACCEPT' => 'application/json',
            ])
            : $this->postJson($uri, $data);
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
                // As a form the value reaches the e-mail check, which must refuse it fast.
                $start = hrtime(true);
                $response = $this->send($route, $email, asForm: true);
                $seconds = (hrtime(true) - $start) / 1e9;

                $response->assertStatus(422)->assertJsonPath('errors.email.0', self::MSG_EMAIL);
                // Generous: the check takes microseconds; the bound only catches a slow pattern.
                $this->assertLessThan(2.0, $seconds, "{$route}, {$shape}, form: {$seconds} s");

                // As JSON the body is over 32 kB and refused before anything parses it.
                $start = hrtime(true);
                $response = $this->send($route, $email);
                $seconds = (hrtime(true) - $start) / 1e9;

                $response->assertStatus(413)->assertJsonPath('message', 'Die Anfrage ist zu groß.');
                $this->assertLessThan(2.0, $seconds, "{$route}, {$shape}, JSON: {$seconds} s");
                $checked++;
            }
        }

        $this->assertSame(8, $checked);
    }
}
