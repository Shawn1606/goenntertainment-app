<?php

namespace Tests\Feature;

use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Foundation\Http\Events\RequestHandled;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Mail;
use Illuminate\Testing\TestResponse;
use Tests\AppFeatureTestCase;

/**
 * POST /forgot-password must not tell by its timing whether an address has an account (F-09,
 * F-21), on the server setup that ships: PHP inside Apache (php:8.4-apache, mod_php), where the
 * request ends only after its deferred work.
 *
 * Two things make the timing the same, and each is pinned here:
 *
 *   1. Up to the answer, a known and an unknown address cost the same: the same statements, no
 *      mail. Making the code (a transaction on the account) and mailing it come after the answer
 *      (PasswordReset::issue, deferred). Before, a known address ran the transaction first.
 *   2. The answer is complete for the client before that deferred work runs: it states its exact
 *      length and closes the connection (LengthDelimitedJsonResponse). Under mod_php the request
 *      ends only after the deferred mail; without a length the client waited for its end.
 *
 * What only the container can show: that Apache and Caddy end the client's response at the
 * stated length, which is their HTTP/1.1 behaviour for a response with a Content-Length. PHP's
 * built-in web server, which like mod_php has no fastcgi_finish_request(), shows the effect
 * outside the container: with a mail server that takes two seconds, a known address answered
 * two seconds later than an unknown one before this change, and as fast after it.
 */
class ForgotPasswordTimingTest extends AppFeatureTestCase
{
    private const CODE_MAIL = 'App\\Mail\\PasswordResetCode';

    /** Statements and mails, split at the moment the answer was ready (RequestHandled). */
    private object $record;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();

        // The database lock store deletes expired locks on a random 2 % of its locks; that
        // housekeeping is unrelated to the address and would make the two lists differ by chance.
        config(['cache.stores.database.lock_lottery' => [0, 100]]);
        $this->app['cache']->forgetDriver('database');

        $this->record = (object) ['answered' => false, 'before' => [], 'after' => [], 'mailsBefore' => 0];
        DB::listen(function (QueryExecuted $query): void {
            $this->record->{$this->record->answered ? 'after' : 'before'}[] = $query->sql;
        });
        Event::listen(RequestHandled::class, function (): void {
            $this->record->answered = true;
            $this->record->mailsBefore = Mail::sent(self::CODE_MAIL)->count();
        });
    }

    /** POST /forgot-password; returns the answer and what ran before and after it. */
    private function forgot(string $email): array
    {
        $this->record->answered = false;
        $this->record->before = [];
        $this->record->after = [];
        $mailsBefore = Mail::sent(self::CODE_MAIL)->count();

        $response = $this->postJson('/api/forgot-password', ['email' => $email])->assertOk();

        $this->assertTrue($this->record->answered, 'the request was not handled');

        return [
            'response' => $response,
            'before' => $this->record->before,
            'after' => $this->record->after,
            'mailedBeforeTheAnswer' => $this->record->mailsBefore - $mailsBefore,
            'mailedInAll' => Mail::sent(self::CODE_MAIL)->count() - $mailsBefore,
        ];
    }

    public function test_a_known_and_an_unknown_address_cost_the_same_up_to_the_answer(): void
    {
        $user = $this->makeUser();
        // The address-wide counters exist from here on, as they do for any later request: the
        // two requests below then meet the same counter state (the IP's counter used once, their
        // own address's counter new).
        $this->forgot(self::freeUsername('warmup').'@example.invalid');

        $known = $this->forgot($user->email);
        $unknown = $this->forgot(self::freeUsername('nobody').'@example.invalid');

        $this->assertNotEmpty($known['before'], 'no statements were recorded');
        $this->assertSame($unknown['before'], $known['before'], 'a known address runs other statements before the answer');
        $this->assertSame(0, $known['mailedBeforeTheAnswer'], 'the code mail went out before the answer');
        $this->assertSame($unknown['response']->getContent(), $known['response']->getContent());

        // The work still happens, after the answer: one code mail and one open code.
        $this->assertSame(1, $known['mailedInAll']);
        $this->assertSame(0, $unknown['mailedInAll']);
        $this->assertSame(1, DB::table('two_factor_challenges')->where('user_id', $user->id)->where('purpose', 'reset')->count());
        $this->assertNotEmpty(array_filter($known['after'], fn (string $sql): bool => str_contains($sql, 'two_factor_challenges')), 'the code was not made after the answer');
    }

    public function test_the_answer_states_its_length_and_closes_the_connection(): void
    {
        $user = $this->makeUser();

        foreach (['known' => $user->email, 'unknown' => self::freeUsername('nobody').'@example.invalid'] as $case => $email) {
            $sent = $this->send($this->forgot($email)['response']);

            $this->assertSame((string) strlen($sent['body']), $sent['headers']->get('Content-Length'), "{$case}: the answer does not state its exact length");
            $this->assertSame('close', $sent['headers']->get('Connection'), "{$case}: the answer leaves the connection open");
            $this->assertFalse($sent['headers']->has('Transfer-Encoding'), "{$case}: the answer is chunked");
            $this->assertSame(['status' => 'sent'], array_intersect_key((array) json_decode($sent['body'], true), ['status' => true]));
        }
    }

    /** Sends the response as public/index.php does (send()), catching the body. */
    private function send(TestResponse $response): array
    {
        $base = $response->baseResponse;
        ob_start();
        try {
            $base->send();
        } finally {
            $body = (string) ob_get_clean();
        }

        return ['body' => $body, 'headers' => $base->headers];
    }
}
