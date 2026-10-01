<?php

namespace Tests\Unit;

use App\Support\ReservedAccounts;
use PHPUnit\Framework\TestCase;
use RuntimeException;

/**
 * App\Support\ReservedAccounts: case-insensitive matching, subdomains of a reserved domain, and no
 * list means no start (an exception, never an empty list).
 */
class ReservedAccountsListTest extends TestCase
{
    private function write(string $json): string
    {
        $path = tempnam(sys_get_temp_dir(), 'reserved-');
        file_put_contents($path, $json);

        return $path;
    }

    public function test_the_project_list_matches_without_regard_to_case(): void
    {
        $list = ReservedAccounts::default();

        $this->assertTrue($list->isReservedUsername('admin'));
        $this->assertTrue($list->isReservedUsername('ADMIN'));
        $this->assertTrue($list->isReservedUsername(' Bowling-Goettingen '));
        $this->assertFalse($list->isReservedUsername('administrator'));
        $this->assertFalse($list->isReservedUsername('admin2'));
        $this->assertFalse($list->isReservedUsername(null));
    }

    public function test_reserved_domains_and_their_subdomains(): void
    {
        $list = ReservedAccounts::default();

        $this->assertTrue($list->isReservedEmail('x@goenntertainment.local'));
        $this->assertTrue($list->isReservedEmail('x@GoennTertainment.LOCAL'));
        $this->assertTrue($list->isReservedEmail('x@import.goenntertainment.local'));
        $this->assertFalse($list->isReservedEmail('x@notgoenntertainment.local'));
        $this->assertFalse($list->isReservedEmail('x@example.invalid'));
        $this->assertFalse($list->isReservedEmail('no-at-sign'));
        $this->assertFalse($list->isReservedEmail(42));
    }

    public function test_a_missing_or_incomplete_list_throws(): void
    {
        foreach ([
            sys_get_temp_dir().'/does-not-exist-'.bin2hex(random_bytes(4)).'.json',
            $this->write('not json'),
            $this->write('{"usernames": [], "email_domains": ["x.invalid"]}'),
            $this->write('{"usernames": ["admin"]}'),
            $this->write('{"usernames": ["admin", ""], "email_domains": ["x.invalid"]}'),
        ] as $path) {
            try {
                ReservedAccounts::fromFile($path);
                $this->fail('accepted '.basename($path));
            } catch (RuntimeException) {
                $this->addToAssertionCount(1);
            } finally {
                if (is_file($path)) {
                    unlink($path);
                }
            }
        }
    }
}
