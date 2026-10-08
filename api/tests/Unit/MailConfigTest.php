<?php

namespace Tests\Unit;

use PHPUnit\Framework\TestCase;

/**
 * Mail never falls back to the log transport: mails carry 2FA and reset codes, and a code must
 * never land in a log. Development mail goes to the local mail catcher instead.
 *
 * Plain PHPUnit: config/mail.php is read as a file; env() reads the process environment live.
 */
class MailConfigTest extends TestCase
{
    private static function apiPath(string $file): string
    {
        return dirname(__DIR__, 2).'/'.$file;
    }

    /** config/mail.php with MAIL_MAILER removed from the environment, restored afterwards. */
    private static function mailConfigWithoutMailer(): array
    {
        $saved = [$_ENV['MAIL_MAILER'] ?? null, $_SERVER['MAIL_MAILER'] ?? null, getenv('MAIL_MAILER')];
        unset($_ENV['MAIL_MAILER'], $_SERVER['MAIL_MAILER']);
        putenv('MAIL_MAILER');
        try {
            return require self::apiPath('config/mail.php');
        } finally {
            if ($saved[0] !== null) {
                $_ENV['MAIL_MAILER'] = $saved[0];
            }
            if ($saved[1] !== null) {
                $_SERVER['MAIL_MAILER'] = $saved[1];
            }
            if ($saved[2] !== false) {
                putenv('MAIL_MAILER='.$saved[2]);
            }
        }
    }

    public function test_default_mailer_is_smtp_when_nothing_is_configured(): void
    {
        $this->assertSame('smtp', self::mailConfigWithoutMailer()['default']);
    }

    public function test_no_mailer_chain_falls_back_to_log(): void
    {
        $chains = array_filter(
            self::mailConfigWithoutMailer()['mailers'],
            fn (array $mailer) => isset($mailer['mailers']),
        );
        $this->assertNotEmpty($chains, 'no failover or round-robin mailer found - the config changed?');

        foreach ($chains as $name => $mailer) {
            $this->assertNotContains('log', $mailer['mailers'], "mailer '{$name}' falls back to the log");
        }
    }

    public function test_env_example_sends_development_mail_to_the_local_catcher(): void
    {
        $values = [];
        foreach (file(self::apiPath('.env.example'), FILE_IGNORE_NEW_LINES) as $line) {
            if (preg_match('/^([A-Z0-9_]+)=(.*)$/', trim($line), $m) === 1) {
                $this->assertArrayNotHasKey($m[1], $values, "{$m[1]} is set twice in .env.example");
                $values[$m[1]] = trim($m[2], '"');
            }
        }

        $this->assertSame('smtp', $values['MAIL_MAILER'] ?? null);
        $this->assertSame('127.0.0.1', $values['MAIL_HOST'] ?? null);
        $this->assertSame('1025', $values['MAIL_PORT'] ?? null);
    }
}
