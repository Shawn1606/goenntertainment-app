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
 */
class NameInputTest extends AppFeatureTestCase
{
    private const MSG_TOO_LONG = 'Der Name fasst hoechstens 255 Zeichen.';

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

    private function register(string $name): TestResponse
    {
        $username = self::freeUsername('name');

        return $this->postJson('/api/register', [
            'name' => $name,
            'username' => $username,
            'email' => $username.'@example.invalid',
            'password' => self::TEST_PASSWORD,
            'account_type' => 'standard',
        ]);
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

    public function test_sign_up_refuses_a_100000_character_name_fast(): void
    {
        $start = hrtime(true);
        $response = $this->register(str_repeat('a', 100000));
        $seconds = (hrtime(true) - $start) / 1e9;

        $response->assertStatus(422)->assertJsonPath('errors.name', [self::MSG_TOO_LONG]);
        // Generous: the cap is a length check; the bound only catches work done on the whole value.
        $this->assertLessThan(2.0, $seconds, "{$seconds} s");
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

    public function test_profile_change_refuses_a_100000_character_name_fast(): void
    {
        $user = $this->makeUser();

        $start = hrtime(true);
        $response = $this->withBearer($this->issueToken($user))
            ->patchJson('/api/user', ['name' => str_repeat('a', 100000)]);
        $seconds = (hrtime(true) - $start) / 1e9;

        $response->assertStatus(422)->assertJsonPath('errors.name', [self::MSG_TOO_LONG]);
        $this->assertLessThan(2.0, $seconds, "{$seconds} s");
        $this->assertSame('Feature Test', DB::table('users')->where('id', $user->id)->value('name'));
        $this->assertNothingLogged();
    }
}
