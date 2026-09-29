<?php

namespace Tests\Unit;

use App\Support\PasswordPolicy;
use PHPUnit\Framework\TestCase;

/**
 * Die Passwortregel - genau so, wie die App sie nachbaut (nicht strenger, nicht
 * lockerer). Server und App duerfen sich nie widersprechen: Zeigt die App
 * „wird angenommen", muss der Server es annehmen.
 */
class PasswordPolicyTest extends TestCase
{
    public function test_die_liste_ist_ein_json_array_kleiner_strings(): void
    {
        $list = json_decode((string) file_get_contents(PasswordPolicy::listPath()), true);

        $this->assertIsArray($list);
        $this->assertTrue(array_is_list($list));
        $this->assertGreaterThanOrEqual(300, count($list));
        $this->assertLessThanOrEqual(600, count($list));
        $this->assertSame(count($list), count(array_unique($list)), 'keine Dubletten');

        foreach ($list as $entry) {
            $this->assertIsString($entry);
            $this->assertSame(mb_strtolower($entry), $entry, "nicht kleingeschrieben: {$entry}");
        }

        foreach (['passwort', 'passwort1', 'hallo123', 'schalke04', 'bayern1', 'qwertz123', 'geheim', 'ichliebedich', 'schatz', 'fussball', '123456', 'password'] as $must) {
            $this->assertContains($must, $list);
        }

        // Die Bestandstests (server/test/api.test.js) registrieren damit.
        $this->assertNotContains('geheim1234', $list);
    }

    public function test_grundregel_mit_unveraenderter_meldung(): void
    {
        $this->assertSame(
            'Das Passwort muss mindestens 8 Zeichen mit Buchstaben und Zahlen haben.',
            PasswordPolicy::MSG_BASIC,
        );

        foreach (['', 'kurz1', 'nurbuchstaben', '1234567890', null, ['x'], 'a1a1a1a'] as $bad) {
            $this->assertSame(PasswordPolicy::MSG_BASIC, PasswordPolicy::problem($bad), var_export($bad, true));
        }

        $this->assertNull(PasswordPolicy::problem('Wolke7Kaffee'));
    }

    public function test_haeufige_passwoerter_als_ganzes_und_ohne_gross_klein(): void
    {
        $this->assertSame(PasswordPolicy::MSG_COMMON, PasswordPolicy::problem('passwort1'));
        $this->assertSame(PasswordPolicy::MSG_COMMON, PasswordPolicy::problem('Passwort1'));
        $this->assertSame(PasswordPolicy::MSG_COMMON, PasswordPolicy::problem('SCHALKE04'));
        $this->assertSame(PasswordPolicy::MSG_COMMON, PasswordPolicy::problem('qwertz123'));

        // Nur der GANZE Eintrag zaehlt - kein Wortstamm, kein Leetspeak.
        $this->assertNull(PasswordPolicy::problem('geheim1234'));
        $this->assertNull(PasswordPolicy::problem('passwort1x'));
        $this->assertNull(PasswordPolicy::problem('p4ssw0rt1'));
    }

    public function test_benutzername_und_email_teil_ab_vier_zeichen(): void
    {
        $this->assertSame(PasswordPolicy::MSG_PERSONAL, PasswordPolicy::problem('xxJonas99xx', 'jonas'));
        $this->assertSame(PasswordPolicy::MSG_PERSONAL, PasswordPolicy::problem('JONAS2024!', 'Jonas'));
        $this->assertSame(PasswordPolicy::MSG_PERSONAL, PasswordPolicy::problem('lena.k77abc', null, 'lena.k77@example.com'));

        // Unter vier Zeichen zaehlt es nicht.
        $this->assertNull(PasswordPolicy::problem('maxpower123', 'max'));
        $this->assertNull(PasswordPolicy::problem('alpenblick9', null, 'al@example.com'));

        // Nur der GANZE lokale Teil - keine Teilstuecke wie „max" aus „max.mustermann".
        $this->assertNull(PasswordPolicy::problem('mustermann77x', null, 'max.mustermann@example.com'));
        $this->assertSame(PasswordPolicy::MSG_PERSONAL, PasswordPolicy::problem('max.mustermann1', null, 'max.mustermann@example.com'));

        // Die Domain ist kein Name.
        $this->assertNull(PasswordPolicy::problem('example123', null, 'lena@example.com'));
    }

    /** Reihenfolge: Grundregel vor Liste vor Name - die erste verletzte gewinnt. */
    public function test_reihenfolge_der_meldungen(): void
    {
        $this->assertSame(PasswordPolicy::MSG_BASIC, PasswordPolicy::problem('jonas', 'jonas'));
        $this->assertSame(PasswordPolicy::MSG_COMMON, PasswordPolicy::problem('bayern123', 'bayern'));
    }

    public function test_als_validierungsregel(): void
    {
        $rule = PasswordPolicy::rule('jonas', 'jonas@example.com');
        $failed = null;
        $rule('password', 'jonas2024x', function (string $message) use (&$failed) {
            $failed = $message;
        });

        $this->assertSame(PasswordPolicy::MSG_PERSONAL, $failed);

        $failed = null;
        $rule('password', 'Wolke7Kaffee', function (string $message) use (&$failed) {
            $failed = $message;
        });
        $this->assertNull($failed);
    }
}
