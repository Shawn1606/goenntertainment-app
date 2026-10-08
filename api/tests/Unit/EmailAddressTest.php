<?php

namespace Tests\Unit;

use App\Support\EmailAddress;
use PHPUnit\Framework\TestCase;

/**
 * The linear e-mail check (F-02) accepts what the former pattern accepted, caps the length at 254
 * characters and answers fast on huge inputs. Mirror: src/domain/email.test.ts.
 */
class EmailAddressTest extends TestCase
{
    /**
     * The former pattern, with D so that '$' means the end of the string: the one intended
     * difference (see EmailAddress) is a trailing newline, which requests never carry.
     */
    private const FORMER = '/^[^\s@]+@[^\s@]+\.[^\s@]+$/D';

    public function test_it_agrees_with_the_former_pattern_on_short_strings(): void
    {
        $alphabet = ['a', 'b', 'x', '@', '.', ' ', "\t", "\n", "\v", "\f", "\r", "\u{00A0}", "\u{0085}", 'ü', '-'];
        $letters = ['a', 'b', 'x', 'ü', '-'];
        $pick = static fn (array $from): string => $from[mt_rand(0, count($from) - 1)];
        $word = static function (int $min, int $max) use ($letters, $pick): string {
            $s = '';
            for ($n = mt_rand($min, $max); $n > 0; $n--) {
                $s .= $pick($letters);
            }

            return $s;
        };
        mt_srand(20261002);

        $checked = 0;
        $accepted = 0;
        for ($i = 0; $i < 20000; $i++) {
            if ($i % 2 === 0) {
                // Random strings over the whole alphabet (mostly rejected).
                $s = '';
                for ($j = mt_rand(0, 16); $j > 0; $j--) {
                    $s .= $pick($alphabet);
                }
            } else {
                // Address-shaped strings with up to two random edits (accepted and near misses).
                $s = $word(0, 4).'@'.$word(0, 4).'.'.$word(0, 3);
                for ($edits = mt_rand(0, 2); $edits > 0; $edits--) {
                    $at = mt_rand(0, strlen($s));
                    $s = substr($s, 0, $at).$pick($alphabet).substr($s, $at + mt_rand(0, 1));
                }
            }

            $expected = preg_match(self::FORMER, $s) === 1;
            $this->assertSame($expected, EmailAddress::isValid($s), 'disagrees on '.json_encode($s));
            $checked++;
            $accepted += $expected ? 1 : 0;
        }

        // Denominator: the sample must contain both outcomes, or it proves nothing.
        $this->assertSame(20000, $checked);
        $this->assertGreaterThan(100, $accepted);
        $this->assertLessThan($checked - 100, $accepted);
    }

    public function test_known_cases(): void
    {
        foreach (['a@b.c', 'first.last@example.invalid', 'a.b@c.d.e', 'ü@ü.example.invalid', 'a@b..c', 'a@.b.c'] as $ok) {
            $this->assertTrue(EmailAddress::isValid($ok), $ok);
        }
        foreach (['', 'a', '@b.c', 'a@', 'a@b', 'a@b.', 'a@.b', 'a@@b.c', 'a@b@c.d', 'a b@c.d', "a@b.c\n", "a\t@b.c", null, 42, ['a@b.c']] as $bad) {
            $this->assertFalse(EmailAddress::isValid($bad), json_encode($bad));
        }
    }

    public function test_the_length_cap_is_254_characters(): void
    {
        $address = static fn (int $total): string => str_repeat('a', $total - strlen('@example.invalid')).'@example.invalid';

        $this->assertSame(254, mb_strlen($address(254)));
        $this->assertTrue(EmailAddress::isValid($address(254)));
        $this->assertFalse(EmailAddress::isValid($address(255)));
        $this->assertSame(1, preg_match(self::FORMER, $address(255)), 'the former pattern had no cap');

        // Characters, not bytes: 254 two-byte letters are still 254 characters.
        $wide = str_repeat('ü', 254 - strlen('@example.invalid')).'@example.invalid';
        $this->assertTrue(EmailAddress::isValid($wide));
        $this->assertFalse(EmailAddress::isValid('ü'.$wide));
    }

    public function test_100000_character_inputs_are_rejected_fast(): void
    {
        $inputs = [
            'long local part' => str_repeat('a', 100000).'@example.invalid',
            'many dots in the domain, trailing blank' => 'a@'.str_repeat('b.', 50000).' ',
            'only at signs' => str_repeat('@', 100000),
            'no at sign' => str_repeat('x', 100000),
        ];

        foreach ($inputs as $shape => $input) {
            $start = hrtime(true);
            $valid = EmailAddress::isValid($input);
            $ms = (hrtime(true) - $start) / 1e6;

            $this->assertFalse($valid, $shape);
            // Generous bound (the check takes well under a millisecond): a slow runner never flakes.
            $this->assertLessThan(200, $ms, "{$shape}: {$ms} ms");
        }
    }
}
