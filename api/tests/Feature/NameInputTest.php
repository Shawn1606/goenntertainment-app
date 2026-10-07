<?php

namespace Tests\Feature;

use Illuminate\Log\Events\MessageLogged;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Testing\TestResponse;
use Tests\AppFeatureTestCase;

/**
 * Names are capped at 255 characters before the word filter (F-02), on both routes that take
 * one: sign-up and PATCH /user. 255 is users.name VARCHAR(255) in server/schema.sql; without the
 * cap a longer name reached the database and ended in a 500 (strict mode refuses the value), and
 * one over the word filter's own input cap got the blocked-word message.
 *
 * Long names arrive two ways: in a JSON body up to its 32 kB limit (a bigger body is refused
 * before validation, RequestBodyLimitTest), and in a multipart form, which PHP parses itself and
 * which therefore still carries a 100,000-character value to the validator. PATCH /user receives a
 * form as a POST with `_method=PATCH`, because PHP parses multipart only for POST.
 */
class NameInputTest extends AppFeatureTestCase
{
    private const MSG_TOO_LONG = 'Der Name fasst hoechstens 255 Zeichen.';

    private const FORM = [
        'CONTENT_TYPE' => 'multipart/form-data; boundary=----fixture-boundary',
        'HTTP_ACCEPT' => 'application/json',
    ];

    /** @var list<string> */
    private array $logged = [];

    protected function setUp(): void
    {
        parent::setUp();
        config(['logging.default' => 'null']);
        Event::listen(MessageLogged::class, function (MessageLogged $event) {
            $this->logged[] = $event->message;
        });
    }

    /** A sign-up that is valid apart from the name, as JSON or as a multipart form. */
    private function register(string $name, bool $asForm = false): TestResponse
    {
        $username = self::freeUsername('name');
        $data = [
            'name' => $name,
            'username' => $username,
            'email' => $username.'@example.invalid',
            'password' => self::TEST_PASSWORD,
            'account_type' => 'standard',
            ...self::consent(),
        ];

        return $asForm
            ? $this->call('POST', '/api/register', $data, [], [], self::FORM)
            : $this->postJson('/api/register', $data);
    }

    private function assertNothingLogged(): void
    {
        $this->assertSame([], $this->logged, 'a refused name must not reach the database (no "Database query failed")');
    }

    public function test_sign_up_accepts_a_name_of_255_characters_counted_as_characters(): void
    {
        foreach (['a', 'ä'] as $letter) {
            $name = str_repeat($letter, 255);

            $this->register($name)->assertCreated();

            $this->assertTrue(DB::table('users')->where('name', $name)->exists(), "255 x {$letter}");
        }
    }

    public function test_sign_up_refuses_a_name_of_256_characters(): void
    {
        foreach (['a', 'ä'] as $letter) {
            $name = str_repeat($letter, 256);

            $this->register($name)
                ->assertStatus(422)
                ->assertJsonPath('errors.name', [self::MSG_TOO_LONG])
                ->assertJsonPath('message', self::MSG_TOO_LONG);

            $this->assertFalse(DB::table('users')->where('name', $name)->exists());
        }
        $this->assertNothingLogged();
    }

    /** As long as a JSON body may be, and longer in a form: the cap answers, fast. */
    public function test_sign_up_refuses_long_names_fast(): void
    {
        $cases = [
            'JSON, 30,000 characters' => [str_repeat('a', 30000), false],
            'form, 100,000 characters' => [str_repeat('a', 100000), true],
        ];

        foreach ($cases as $label => [$name, $asForm]) {
            $start = hrtime(true);
            $response = $this->register($name, $asForm);
            $seconds = (hrtime(true) - $start) / 1e9;

            $response->assertStatus(422)->assertJsonPath('errors.name', [self::MSG_TOO_LONG]);
            // Generous: the cap is a length check; the bound only catches work done on the whole value.
            $this->assertLessThan(2.0, $seconds, "{$label}: {$seconds} s");
        }
        $this->assertNothingLogged();
    }

    public function test_profile_change_accepts_255_and_refuses_256_characters(): void
    {
        $user = $this->makeUser();
        $token = $this->issueToken($user);

        $this->withBearer($token)
            ->patchJson('/api/user', ['name' => str_repeat('ä', 255)])
            ->assertOk()
            ->assertJsonPath('user.name', str_repeat('ä', 255));

        $this->withBearer($token)
            ->patchJson('/api/user', ['name' => str_repeat('a', 256)])
            ->assertStatus(422)
            ->assertJsonPath('errors.name', [self::MSG_TOO_LONG])
            ->assertJsonPath('message', self::MSG_TOO_LONG);

        $this->assertSame(str_repeat('ä', 255), DB::table('users')->where('id', $user->id)->value('name'));
        $this->assertNothingLogged();
    }

    public function test_profile_change_refuses_long_names_fast(): void
    {
        $user = $this->makeUser();
        $token = $this->issueToken($user);

        $requests = [
            'JSON, 30,000 characters' => fn () => $this->withBearer($token)
                ->patchJson('/api/user', ['name' => str_repeat('a', 30000)]),
            // call() sends no default headers, so the token goes into the server variables.
            'form, 100,000 characters' => fn () => $this->withBearer($token)
                ->call('POST', '/api/user', ['_method' => 'PATCH', 'name' => str_repeat('a', 100000)], [], [], self::FORM + [
                    'HTTP_AUTHORIZATION' => 'Bearer '.$token,
                ]),
        ];

        foreach ($requests as $label => $send) {
            $start = hrtime(true);
            $response = $send();
            $seconds = (hrtime(true) - $start) / 1e9;

            $response->assertStatus(422)->assertJsonPath('errors.name', [self::MSG_TOO_LONG]);
            $this->assertLessThan(2.0, $seconds, "{$label}: {$seconds} s");
        }
        $this->assertSame('Feature Test', DB::table('users')->where('id', $user->id)->value('name'));
        $this->assertNothingLogged();
    }
}
