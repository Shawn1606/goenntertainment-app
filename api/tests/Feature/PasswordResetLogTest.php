<?php

namespace Tests\Feature;

use Illuminate\Log\Events\MessageLogged;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Hash;
use Tests\AppFeatureTestCase;

/**
 * POST /api/forgot-password must never write the reset token to a log: whoever can read the log
 * could reset the password and take over the account.
 *
 * Runs against MySQL with the app schema (AppFeatureTestCase), so the controller's MySQL upsert of
 * the token runs for real; the test reads the stored hash back from password_reset_tokens.
 */
class PasswordResetLogTest extends AppFeatureTestCase
{
    public function test_forgot_password_never_logs_the_reset_token(): void
    {
        $email = $this->makeUser()->email;

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

        // Denominator: a token was issued (its hash is in the database), so there was one to leak.
        $hash = DB::table('password_reset_tokens')->where('email', $email)->value('token');
        $this->assertNotNull($hash, 'no reset token was issued');

        foreach ($logged as $message) {
            preg_match_all('/[A-Za-z0-9_-]{32,}/', $message, $candidates);
            foreach ($candidates[0] as $candidate) {
                $this->assertFalse(Hash::check($candidate, $hash), 'the reset token was written to the log');
            }
            $this->assertStringNotContainsString($email, $message, 'the reset request was logged with the address');
        }
    }
}
