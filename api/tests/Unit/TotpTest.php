<?php

namespace Tests\Unit;

use App\Support\Totp;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Das Verfahren gegen die Testvektoren der RFCs - die einzige Pruefung, die
 * wirklich zaehlt: Stimmen die, erzeugt jede Authenticator-App dieselben Codes.
 */
class TotpTest extends TestCase
{
    /** Der Schluessel aus RFC 6238, Anhang B (SHA1): ASCII "12345678901234567890". */
    private const RFC_KEY = '12345678901234567890';

    /** RFC 6238, Anhang B - SHA1, 8 Stellen, 30 Sekunden. */
    public static function rfc6238Vectors(): array
    {
        return [
            'T=59' => [59, '94287082'],
            'T=1111111109' => [1111111109, '07081804'],
            'T=1111111111' => [1111111111, '14050471'],
            'T=1234567890' => [1234567890, '89005924'],
            'T=2000000000' => [2000000000, '69279037'],
            'T=20000000000' => [20000000000, '65353130'],
        ];
    }

    #[DataProvider('rfc6238Vectors')]
    public function test_rfc6238_testvektoren(int $time, string $expected): void
    {
        $this->assertSame($expected, Totp::at(self::RFC_KEY, $time, 8));
    }

    /** RFC 4226, Anhang D - HOTP, 6 Stellen, Zaehler 0 bis 9. */
    public function test_rfc4226_hotp_testvektoren(): void
    {
        $expected = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];

        foreach ($expected as $counter => $code) {
            $this->assertSame($code, Totp::hotp(self::RFC_KEY, $counter), "Zaehler {$counter}");
        }
    }

    public function test_base32_hin_und_zurueck(): void
    {
        // RFC 4648, Abschnitt 10 - ohne Auffuellung.
        $this->assertSame('MZXW6YTBOI', Totp::base32Encode('foobar'));
        $this->assertSame('foobar', Totp::base32Decode('MZXW6YTBOI'));
        $this->assertSame('foobar', Totp::base32Decode('mzxw 6ytb-oi======'));

        $this->assertSame('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', Totp::base32Encode(self::RFC_KEY));

        $random = random_bytes(20);
        $this->assertSame($random, Totp::base32Decode(Totp::base32Encode($random)));
    }

    public function test_ungueltiges_base32_wirft(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        Totp::base32Decode('ABC1'); // 1 gibt es in Base32 nicht
    }

    public function test_secret_hat_32_zeichen_base32(): void
    {
        $secret = Totp::generateSecret();

        $this->assertMatchesRegularExpression('/^[A-Z2-7]{32}$/', $secret);
        $this->assertSame(20, strlen(Totp::base32Decode($secret)));
    }

    /** Die Base32-Form desselben RFC-Schluessels liefert dieselben Codes (6 Stellen = letzte 6 der 8). */
    public function test_verify_mit_base32_secret_und_rfc_zeit(): void
    {
        $secret = Totp::base32Encode(self::RFC_KEY);

        // 1111111111 -> 8 Stellen 14050471, 6 Stellen 050471
        $this->assertSame('050471', Totp::now($secret, 1111111111));
        $this->assertSame(Totp::timestep(1111111111), Totp::verify($secret, '050471', null, 1111111111));
    }

    public function test_ein_fenster_davor_und_danach_gilt_zwei_nicht(): void
    {
        $secret = Totp::generateSecret();
        $now = 1_700_000_000;
        $step = Totp::timestep($now);

        $this->assertSame($step - 1, Totp::verify($secret, Totp::now($secret, $now - 30), null, $now));
        $this->assertSame($step + 1, Totp::verify($secret, Totp::now($secret, $now + 30), null, $now));
        $this->assertNull(Totp::verify($secret, Totp::now($secret, $now - 60), null, $now));
        $this->assertNull(Totp::verify($secret, Totp::now($secret, $now + 60), null, $now));
    }

    public function test_replay_schutz_nimmt_nur_spaetere_fenster(): void
    {
        $secret = Totp::generateSecret();
        $now = 1_700_000_000;
        $code = Totp::now($secret, $now);
        $step = Totp::verify($secret, $code, null, $now);

        $this->assertNotNull($step);
        // Derselbe Code ein zweites Mal: abgelehnt.
        $this->assertNull(Totp::verify($secret, $code, $step, $now));
        // Der Code des naechsten Fensters: angenommen.
        $this->assertSame($step + 1, Totp::verify($secret, Totp::now($secret, $now + 30), $step, $now + 30));
    }

    public function test_falsche_formen_werden_abgelehnt(): void
    {
        $secret = Totp::generateSecret();
        $now = 1_700_000_000;
        $code = Totp::now($secret, $now);

        $this->assertNull(Totp::verify($secret, '', null, $now));
        $this->assertNull(Totp::verify($secret, '12345', null, $now));
        $this->assertNull(Totp::verify($secret, '1234567', null, $now));
        $this->assertNull(Totp::verify($secret, 'abcdef', null, $now));
        $this->assertNull(Totp::verify($secret, null, null, $now));
        $this->assertNull(Totp::verify($secret, ['123456'], null, $now));
        // Leerzeichen in der Mitte ("123 456") sind erlaubt.
        $this->assertNotNull(Totp::verify($secret, substr($code, 0, 3).' '.substr($code, 3), null, $now));
    }

    public function test_otpauth_adresse(): void
    {
        $url = Totp::otpauthUrl('JBSWY3DPEHPK3PXP', 'sam@example.com', 'GÖ4Fun');

        $this->assertStringStartsWith('otpauth://totp/G%C3%964Fun:sam%40example.com?', $url);
        parse_str((string) parse_url($url, PHP_URL_QUERY), $query);
        $this->assertSame([
            'secret' => 'JBSWY3DPEHPK3PXP',
            'issuer' => 'GÖ4Fun',
            'algorithm' => 'SHA1',
            'digits' => '6',
            'period' => '30',
        ], $query);
    }
}
