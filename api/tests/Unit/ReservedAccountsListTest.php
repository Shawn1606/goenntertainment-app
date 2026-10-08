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

    /** The domain and its dot-suffixes, which the database compares with the reserved domains. */
    public function test_domain_suffixes(): void
    {
        $this->assertSame(['a.b.c', 'b.c', 'c'], ReservedAccounts::domainSuffixes('x@a.b.c'));
        $this->assertSame(['a.b.c', 'b.c', 'c'], ReservedAccounts::domainSuffixes(' "x@y"@a.b.c.. '));
        $this->assertSame(['.b..c', 'b..c', '.c', 'c'], ReservedAccounts::domainSuffixes('x@.b..c'));
        $this->assertSame(["loc\u{00E1}l"], ReservedAccounts::domainSuffixes("x@loc\u{00E1}l"));
        $this->assertSame([], ReservedAccounts::domainSuffixes('x@'));
        $this->assertSame([], ReservedAccounts::domainSuffixes('x@...'));
        $this->assertSame([], ReservedAccounts::domainSuffixes('no-at-sign'));
        $this->assertSame([], ReservedAccounts::domainSuffixes(null));
    }

    /** The suffixes after every character that may be a dot to the database, with that character. */
    public function test_separated_suffixes(): void
    {
        $this->assertSame([['.', 'a.b'], ['.', 'b']], ReservedAccounts::separatedSuffixes('a.b'));
        $this->assertSame(
            [['.', "a\u{FF0E}b.c"], ["\u{FF0E}", 'b.c'], ['.', 'c']],
            ReservedAccounts::separatedSuffixes("a\u{FF0E}b.c"),
        );
        $this->assertSame(
            [['.', "x\u{00E1}y"], ["\u{00E1}", 'y']],
            ReservedAccounts::separatedSuffixes("x\u{00E1}y"),
        );
        $this->assertSame([['.', 'abc']], ReservedAccounts::separatedSuffixes('abc'));
        $this->assertSame([['.', 'a.']], ReservedAccounts::separatedSuffixes('a.'));
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
