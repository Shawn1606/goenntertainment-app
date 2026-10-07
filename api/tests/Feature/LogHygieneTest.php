<?php

namespace Tests\Feature;

use Illuminate\Database\QueryException;
use Illuminate\Log\Events\MessageLogged;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Mail;
use PDOException;
use Symfony\Component\Mailer\Exception\TransportException;
use Symfony\Component\Mailer\SentMessage;
use Symfony\Component\Mailer\Transport\AbstractTransport;
use Tests\AppFeatureTestCase;
use Throwable;

/**
 * Logs carry no request data (F-38): a failed query is reported without its bound
 * values, its statement or the driver's message; a code mail that could not be sent (two-factor,
 * reset, a new e-mail address) logs the exception class only (its message carries the recipient).
 *
 * Every log call is captured as text, exceptions included with their messages, so whatever a log
 * formatter could print is checked. Each test first proves that something was logged at all.
 */
class LogHygieneTest extends AppFeatureTestCase
{
    private const CANARY = 'canary-7f3a-not-a-secret';

    /** @var list<string> */
    private array $logged = [];

    protected function setUp(): void
    {
        parent::setUp();
        // The null channel keeps a leaked canary out of storage/logs if a test fails.
        config(['logging.default' => 'null']);
        Event::listen(MessageLogged::class, function (MessageLogged $event) {
            $this->logged[] = $event->message.' '.self::flatten($event->context);
        });
    }

    /** Context as text, with every exception's class, message and previous exceptions. */
    private static function flatten(mixed $value): string
    {
        if ($value instanceof Throwable) {
            return $value::class.': '.$value->getMessage().' '.self::flatten($value->getPrevious());
        }
        if (is_array($value)) {
            return implode(' ', array_map(fn ($v, $k) => $k.'='.self::flatten($v), $value, array_keys($value)));
        }

        return is_scalar($value) ? (string) $value : '';
    }

    private function assertLoggedWithoutCanary(): void
    {
        $this->assertNotSame([], $this->logged, 'nothing was logged, so nothing was checked');
        foreach ($this->logged as $line) {
            $this->assertStringNotContainsString(self::CANARY, $line);
        }
    }

    public function test_a_failed_query_is_reported_without_values_statement_or_driver_message(): void
    {
        report(new QueryException(
            'mysql',
            'select * from users where email = ? and secret_column_'.self::CANARY.' = 1',
            ['someone-'.self::CANARY.'@example.invalid'],
            new PDOException('fixture driver message '.self::CANARY),
        ));

        $this->assertLoggedWithoutCanary();
        $this->assertStringContainsString(QueryException::class, implode("\n", $this->logged));
    }

    public function test_a_code_mail_that_cannot_be_sent_logs_the_exception_class_only(): void
    {
        Mail::extend('failing-for-test', fn () => new class extends AbstractTransport
        {
            protected function doSend(SentMessage $message): void
            {
                throw new TransportException('fixture transport failure for '.LogHygieneTest::canary());
            }

            public function __toString(): string
            {
                return 'failing-for-test';
            }
        });
        config(['mail.mailers.failing-for-test' => ['transport' => 'failing-for-test'], 'mail.default' => 'failing-for-test']);
        $user = $this->makeUser(['two_factor_method' => 'email', 'two_factor_confirmed_at' => now()]);

        $this->withBearer($this->issueToken($user))->postJson('/api/user/two-factor/code')->assertStatus(503);

        $this->assertLoggedWithoutCanary();
    }

    /**
     * The password reset code mail (F-09) the same way: the request is answered neutrally, the
     * failure is logged with the exception class and the user id, never the transport's message
     * or the address.
     */
    public function test_a_reset_code_mail_that_cannot_be_sent_logs_the_exception_class_only(): void
    {
        Mail::extend('failing-for-test', fn () => new class extends AbstractTransport
        {
            protected function doSend(SentMessage $message): void
            {
                throw new TransportException('fixture transport failure for '.LogHygieneTest::canary());
            }

            public function __toString(): string
            {
                return 'failing-for-test';
            }
        });
        config(['mail.mailers.failing-for-test' => ['transport' => 'failing-for-test'], 'mail.default' => 'failing-for-test']);
        $user = $this->makeUser();

        $this->postJson('/api/forgot-password', ['email' => $user->email])->assertOk()->assertJsonPath('status', 'sent');

        $this->assertLoggedWithoutCanary();
        foreach ($this->logged as $line) {
            $this->assertStringNotContainsString($user->email, $line);
        }
        $this->assertStringContainsString(TransportException::class, implode("\n", $this->logged));
    }

    /**
     * The code mail to a new e-mail address (F-04) the same way: 503, and the failure logged with
     * the exception class and the user id, never the transport's message or either address.
     */
    public function test_an_e_mail_change_code_mail_that_cannot_be_sent_logs_the_exception_class_only(): void
    {
        Mail::extend('failing-for-test', fn () => new class extends AbstractTransport
        {
            protected function doSend(SentMessage $message): void
            {
                throw new TransportException('fixture transport failure for '.LogHygieneTest::canary());
            }

            public function __toString(): string
            {
                return 'failing-for-test';
            }
        });
        config(['mail.mailers.failing-for-test' => ['transport' => 'failing-for-test'], 'mail.default' => 'failing-for-test']);
        $user = $this->makeUser();
        $new = 'moved-'.$user->username.'@example.invalid';

        $this->withBearer($this->issueToken($user))
            ->putJson('/api/user/email', ['email' => $new, 'current_password' => self::TEST_PASSWORD])
            ->assertStatus(503);

        $this->assertLoggedWithoutCanary();
        foreach ($this->logged as $line) {
            $this->assertStringNotContainsString($user->email, $line);
            $this->assertStringNotContainsString($new, $line);
        }
        $this->assertStringContainsString(TransportException::class, implode("\n", $this->logged));
    }

    public static function canary(): string
    {
        return self::CANARY;
    }
}
