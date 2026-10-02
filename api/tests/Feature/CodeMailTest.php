<?php

namespace Tests\Feature;

use App\Support\TwoFactor;
use Illuminate\Log\Events\MessageLogged;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use RuntimeException;
use Tests\AppFeatureTestCase;

/**
 * Mails with a code (password reset, two-factor) never go through the log transport, not even
 * when MAIL_MAILER names it or a failover chain contains it: the log would hold the code
 * (F-09; App\Support\CodeMail). The mail is refused like a failed one: the reset answers neutrally
 * and keeps no code, the two-factor route answers 503, and the log names the exception class.
 *
 * The real mail manager runs here (no Mail::fake), so the transport that would send is the one
 * the configuration picks.
 */
class CodeMailTest extends AppFeatureTestCase
{
    /** @var list<array{level: string, text: string}> */
    private array $logged = [];

    protected function setUp(): void
    {
        parent::setUp();
        // The null channel keeps a leaked test code out of storage/logs if a test fails; every
        // log call still raises MessageLogged, the log transport's included.
        config(['logging.default' => 'null', 'mail.mailers.log.channel' => 'null']);
        Event::listen(MessageLogged::class, function (MessageLogged $event) {
            $this->logged[] = ['level' => $event->level, 'text' => $event->message.' '.json_encode($event->context)];
        });
    }

    /** No mail was written to the log (a mail in the log carries its headers). */
    private function assertNoMailInTheLog(): void
    {
        foreach ($this->logged as $record) {
            $this->assertStringNotContainsString('Subject:', $record['text'], 'a mail was written to the log');
        }
    }

    /** The refusal was logged as an error, by exception class. */
    private function assertRefusalLogged(string $prefix): void
    {
        $errors = array_filter($this->logged, fn (array $r) => $r['level'] === 'error' && str_contains($r['text'], $prefix));
        $this->assertCount(1, $errors, "no '{$prefix}' error was logged");
        $this->assertStringContainsString(json_encode(RuntimeException::class), (string) array_values($errors)[0]['text']);
    }

    public function test_a_reset_code_mail_goes_out_on_a_real_transport(): void
    {
        // The positive control: phpunit.xml's array mailer is not the log, so the code is sent.
        $user = $this->makeUser();

        $this->postJson('/api/forgot-password', ['email' => $user->email])->assertOk();

        $sent = app('mail.manager')->mailer('array')->getSymfonyTransport()->messages();
        $this->assertCount(1, $sent);
        $this->assertSame($user->email, $sent->first()->getEnvelope()->getRecipients()[0]->getAddress());
        $this->assertSame(1, DB::table('two_factor_challenges')->where('user_id', $user->id)->where('purpose', 'reset')->count());
    }

    public function test_reset_code_mails_are_refused_on_the_log_mailer(): void
    {
        config(['mail.default' => 'log']);
        $user = $this->makeUser();

        $this->postJson('/api/forgot-password', ['email' => $user->email])
            ->assertOk()
            ->assertJsonPath('status', 'sent');

        $this->assertNoMailInTheLog();
        $this->assertRefusalLogged('[password-reset] code mail not sent');
        // A code nobody received is useless: it is gone, and a new request may mail at once.
        $this->assertSame(0, DB::table('two_factor_challenges')->where('user_id', $user->id)->where('purpose', 'reset')->count());
    }

    public function test_two_factor_code_mails_are_refused_on_the_log_mailer(): void
    {
        config(['mail.default' => 'log']);
        $user = $this->makeUser(['two_factor_method' => TwoFactor::METHOD_EMAIL, 'two_factor_confirmed_at' => now()]);

        $this->withBearer($this->issueToken($user))
            ->postJson('/api/user/two-factor/code')
            ->assertStatus(503)
            ->assertJsonPath('message', TwoFactor::MSG_MAIL_FAILED);

        $this->assertNoMailInTheLog();
        $this->assertRefusalLogged('[two-factor] Code-Mail nicht versendet');
    }

    public function test_a_failover_chain_with_the_log_mailer_is_refused_too(): void
    {
        // The array mailer would take the mail first; the chain is refused all the same, because
        // the log is one of its members.
        config(['mail.mailers.failover.mailers' => ['array', 'log'], 'mail.default' => 'failover']);
        $user = $this->makeUser(['two_factor_method' => TwoFactor::METHOD_EMAIL, 'two_factor_confirmed_at' => now()]);

        $this->withBearer($this->issueToken($user))
            ->postJson('/api/user/two-factor/code')
            ->assertStatus(503);

        $this->assertNoMailInTheLog();
        $this->assertRefusalLogged('[two-factor] Code-Mail nicht versendet');
        $this->assertCount(0, app('mail.manager')->mailer('array')->getSymfonyTransport()->messages());
    }
}
