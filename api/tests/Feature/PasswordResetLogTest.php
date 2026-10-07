<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Log\Events\MessageLogged;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * POST /api/forgot-password must never write the reset token to a log: whoever can read the log
 * could reset the password and take over the account.
 *
 * Runs on the test suite's sqlite database. The controller stores the token with a MySQL-only
 * upsert, so that one statement is captured instead of executed; everything else runs for real.
 */
class PasswordResetLogTest extends TestCase
{
    use RefreshDatabase;

    public function test_forgot_password_never_logs_the_reset_token(): void
    {
        $email = 'reset-log-test@example.invalid';
        DB::table('users')->insert([
            'name' => 'Reset Log Test',
            'email' => $email,
            'password' => Hash::make('Fixture-Only-Pass-2468'),
        ]);

        $stored = [];
        DB::partialMock()
            ->shouldReceive('statement')
            ->andReturnUsing(function (string $query, array $bindings = []) use (&$stored) {
                $stored[] = $bindings;

                return true;
            });

        // Every log call still raises MessageLogged; the null channel only keeps a leaked test
        // token out of storage/logs when this test fails.
        config(['logging.default' => 'null']);
        $logged = [];
        Event::listen(MessageLogged::class, function (MessageLogged $event) use (&$logged) {
            $logged[] = $event->message.' '.json_encode($event->context);
        });

        $this->postJson('/api/forgot-password', ['email' => $email])
            ->assertOk()
            ->assertJson(['status' => 'sent']);

        // Denominator: a token was issued (its hash went to the database), so there was one to leak.
        $this->assertCount(1, $stored, 'no reset token was issued');
        [$storedEmail, $hash] = $stored[0];
        $this->assertSame($email, $storedEmail);

        foreach ($logged as $message) {
            preg_match_all('/[A-Za-z0-9_-]{32,}/', $message, $candidates);
            foreach ($candidates[0] as $candidate) {
                $this->assertFalse(Hash::check($candidate, $hash), 'the reset token was written to the log');
            }
            $this->assertStringNotContainsString($email, $message, 'the reset request was logged with the address');
        }
    }
}
