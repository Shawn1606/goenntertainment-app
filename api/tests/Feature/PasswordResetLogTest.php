<?php

namespace Tests\Feature;

use Illuminate\Log\Events\MessageLogged;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Mail;
use Throwable;
use Tests\AppFeatureTestCase;

/**
 * The password reset never writes its code to a log: whoever can read the log could reset the
 * password and take over the account (F-09). Nor the address it was requested for.
 *
 * Since the reset works by a mailed code instead of a link, the secret to look for is the code
 * from the reset mail (formerly the link token, read back as a hash from password_reset_tokens,
 * which is no longer written). The whole flow runs: the request, a wrong code, the right code.
 */
class PasswordResetLogTest extends AppFeatureTestCase
{
    public function test_the_reset_flow_never_logs_the_code_or_the_address(): void
    {
        Mail::fake();
        $email = $this->makeUser()->email;

        // Every log call still raises MessageLogged; the null channel only keeps a leaked test
        // code out of storage/logs when this test fails.
        config(['logging.default' => 'null']);
        $logged = [];
        Event::listen(MessageLogged::class, function (MessageLogged $event) use (&$logged) {
            $logged[] = $event->message.' '.self::flatten($event->context);
        });

        $this->postJson('/api/forgot-password', ['email' => $email])
            ->assertOk()
            ->assertJson(['status' => 'sent']);

        // Denominator: a code was issued (it is in the mail), so there was one to leak.
        Mail::assertSent('App\\Mail\\PasswordResetCode');
        $code = (string) Mail::sent('App\\Mail\\PasswordResetCode')->last()->code;
        $this->assertMatchesRegularExpression('/^\d{6}$/', $code);

        $wrong = sprintf('%06d', ((int) $code + 1) % 1000000);
        $this->postJson('/api/reset-password', ['email' => $email, 'code' => $wrong, 'password' => 'Fixture-New-Pass-8642'])->assertStatus(422);
        $this->postJson('/api/reset-password', ['email' => $email, 'code' => $code, 'password' => 'Fixture-New-Pass-8642'])->assertOk();

        foreach ($logged as $message) {
            $this->assertStringNotContainsString($code, $message, 'the reset code was written to the log');
            $this->assertStringNotContainsString($wrong, $message, 'a typed code was written to the log');
            $this->assertStringNotContainsString($email, $message, 'the reset request was logged with the address');
        }
    }

    /** Context as text, with every exception's class and message. */
    private static function flatten(mixed $value): string
    {
        if ($value instanceof Throwable) {
            return $value::class.': '.$value->getMessage().' '.self::flatten($value->getPrevious());
        }
        if (is_array($value)) {
            return implode(' ', array_map(fn ($v, $k) => $k.'='.self::flatten($v), $value, array_keys($value)));
        }

        return is_scalar($value) ? (string) $value : json_encode($value);
    }
}
