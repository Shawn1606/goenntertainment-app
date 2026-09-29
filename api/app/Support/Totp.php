<?php

namespace App\Support;

use InvalidArgumentException;

/**
 * Einmal-Codes fuer Authenticator-Apps (RFC 6238, TOTP) - von Hand.
 *
 * ## Warum keine Bibliothek
 *
 * `pragmarx/google2fa` taete es auch. Aber das Verfahren ist klein und seit 2011
 * unveraendert: HMAC-SHA1 ueber einen Zaehler, vier Bytes herausschneiden, die
 * letzten sechs Ziffern nehmen. Das sind dreissig Zeilen, die sich gegen die
 * Testvektoren der RFC pruefen lassen (tests/Unit/TotpTest.php) - und eine
 * Abhaengigkeit weniger in einem Teil, in dem jede Abhaengigkeit ein Stueck
 * Anmeldung ist, das jemand anderes in der Hand hat.
 *
 * ## Die Einstellungen - und warum genau diese
 *
 * SHA1, 30 Sekunden, 6 Stellen. Nicht, weil SHA1 heute die beste Wahl waere,
 * sondern weil es die EINZIGE ist, die jede Authenticator-App versteht: Google
 * Authenticator ignorierte `algorithm=SHA256` jahrelang stillschweigend und
 * erzeugte dann Codes, die nie passten. Fuer HMAC ist SHA1 nicht gebrochen - die
 * bekannten Kollisionsangriffe treffen hier nicht.
 *
 * Toleriert wird ein Zeitfenster davor und danach (+/-30 s). Handy-Uhren gehen
 * nach, und wer den Code bei 29 Sekunden abtippt, schickt ihn im naechsten
 * Fenster ab. Mehr Toleranz hiesse mehr gueltige Codes zur selben Zeit - also
 * mehr Treffer fuer jemanden, der raet.
 */
final class Totp
{
    public const DIGITS = 6;

    public const PERIOD = 30;

    /** Wie viele Fenster vor und nach dem aktuellen noch gelten. */
    public const WINDOW = 1;

    private const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

    /**
     * Neues Secret, Base32 - so, wie Authenticator-Apps es erwarten.
     *
     * 20 Bytes = 160 Bit, die Laenge, die RFC 4226 fuer SHA1 empfiehlt (so lang
     * wie der Hash selbst). Ergibt 32 Zeichen ohne Fuellzeichen.
     */
    public static function generateSecret(int $bytes = 20): string
    {
        return self::base32Encode(random_bytes($bytes));
    }

    /** Base32 nach RFC 4648, ohne `=`-Auffuellung (die Apps wollen es so). */
    public static function base32Encode(string $binary): string
    {
        $bits = '';
        foreach (str_split($binary) as $char) {
            if ($char === '') {
                continue;
            }
            $bits .= str_pad(decbin(ord($char)), 8, '0', STR_PAD_LEFT);
        }

        $out = '';
        foreach ($bits === '' ? [] : str_split($bits, 5) as $chunk) {
            $out .= self::BASE32_ALPHABET[bindec(str_pad($chunk, 5, '0', STR_PAD_RIGHT))];
        }

        return $out;
    }

    /**
     * Base32 zurueck in Bytes.
     *
     * Grosszuegig bei der Form (klein geschrieben, Leerzeichen, Bindestriche,
     * Fuellzeichen - so tippen Menschen ein Secret ab), streng beim Inhalt: Ein
     * Zeichen ausserhalb des Alphabets ist ein Fehler und kein stilles
     * Ueberspringen, sonst entstuende aus einem Tippfehler ein anderes Secret.
     */
    public static function base32Decode(string $encoded): string
    {
        $clean = strtoupper((string) preg_replace('/[\s=-]/', '', $encoded));

        if ($clean !== '' && preg_match('/[^A-Z2-7]/', $clean) === 1) {
            throw new InvalidArgumentException('Das Secret ist kein gueltiges Base32.');
        }

        $bits = '';
        foreach ($clean === '' ? [] : str_split($clean) as $char) {
            $bits .= str_pad(decbin(strpos(self::BASE32_ALPHABET, $char)), 5, '0', STR_PAD_LEFT);
        }

        $out = '';
        foreach ($bits === '' ? [] : str_split($bits, 8) as $byte) {
            // Ein unvollstaendiges letztes Byte ist Auffuellung, kein Inhalt.
            if (strlen($byte) === 8) {
                $out .= chr(bindec($byte));
            }
        }

        return $out;
    }

    /**
     * HOTP nach RFC 4226: der Code zu einem Zaehlerstand.
     *
     * `pack('J')` = 64 Bit, big-endian - genau das Format, das die RFC fuer den
     * Zaehler vorschreibt. Die „dynamische Kuerzung" nimmt vier Bytes ab der
     * Stelle, die das letzte Halbbyte des Hashes angibt, und loescht das
     * oberste Bit (damit das Ergebnis auf jeder Plattform positiv ist).
     */
    public static function hotp(string $key, int $counter, int $digits = self::DIGITS): string
    {
        $hash = hash_hmac('sha1', pack('J', $counter), $key, true);
        $offset = ord($hash[19]) & 0x0F;

        $binary = ((ord($hash[$offset]) & 0x7F) << 24)
            | (ord($hash[$offset + 1]) << 16)
            | (ord($hash[$offset + 2]) << 8)
            | ord($hash[$offset + 3]);

        return str_pad((string) ($binary % (10 ** $digits)), $digits, '0', STR_PAD_LEFT);
    }

    /** Das Zeitfenster zu einem Unix-Zeitpunkt. */
    public static function timestep(int $timestamp, int $period = self::PERIOD): int
    {
        return intdiv($timestamp, $period);
    }

    /** TOTP: der Code zu einem Zeitpunkt, mit ROHEM Schluessel (fuer die RFC-Testvektoren). */
    public static function at(string $key, int $timestamp, int $digits = self::DIGITS, int $period = self::PERIOD): string
    {
        return self::hotp($key, self::timestep($timestamp, $period), $digits);
    }

    /** Der aktuelle Code zu einem Base32-Secret. */
    public static function now(string $secret, ?int $timestamp = null): string
    {
        return self::at(self::base32Decode($secret), $timestamp ?? time());
    }

    /**
     * Passt der Code? Liefert das Zeitfenster, in dem er passt - sonst null.
     *
     * `$afterStep` ist der Replay-Schutz: Nur Fenster NACH dem zuletzt
     * angenommenen zaehlen. Ohne ihn waere ein abgefangener Code noch bis zu
     * 90 Sekunden lang ein zweites Mal gut - lang genug fuer jemanden, der
     * ueber die Schulter schaut. Der Aufrufer merkt sich das gelieferte Fenster
     * (users.two_factor_last_step).
     *
     * Alle Fenster werden gerechnet und mit `hash_equals` verglichen, auch
     * nach einem Treffer: Die Antwortzeit verraet so nicht, WELCHES Fenster
     * gepasst hat oder wie nah ein Versuch war. Bei zwei Treffern (Zufall, eins
     * zu einer Million) gewinnt das spaetere Fenster - der Replay-Schutz ist
     * damit eher strenger als lockerer.
     */
    public static function verify(string $secret, mixed $code, ?int $afterStep = null, ?int $timestamp = null): ?int
    {
        if (! is_string($code) && ! is_int($code)) {
            return null;
        }

        $code = (string) preg_replace('/\s+/', '', (string) $code);
        if (preg_match('/^\d{'.self::DIGITS.'}$/', $code) !== 1) {
            return null;
        }

        try {
            $key = self::base32Decode($secret);
        } catch (InvalidArgumentException) {
            return null;
        }

        $current = self::timestep($timestamp ?? time());
        $matched = null;

        for ($step = $current - self::WINDOW; $step <= $current + self::WINDOW; $step++) {
            $fits = hash_equals(self::hotp($key, $step), $code);

            if ($fits && ($afterStep === null || $step > $afterStep)) {
                $matched = $step;
            }
        }

        return $matched;
    }

    /**
     * Adresse fuer den QR-Code (Key-URI-Format von Google Authenticator).
     *
     * Aussteller steht ZWEIMAL darin - als Praefix des Labels und als
     * `issuer`-Parameter. Das ist Absicht: Aeltere Apps lesen nur das eine,
     * neuere nur das andere. Beides URL-kodiert, das Ö in „GÖ4Fun" inklusive.
     */
    public static function otpauthUrl(string $secret, string $account, string $issuer): string
    {
        $query = http_build_query([
            'secret' => $secret,
            'issuer' => $issuer,
            'algorithm' => 'SHA1',
            'digits' => self::DIGITS,
            'period' => self::PERIOD,
        ], '', '&', PHP_QUERY_RFC3986);

        return 'otpauth://totp/'.rawurlencode($issuer).':'.rawurlencode($account).'?'.$query;
    }
}
