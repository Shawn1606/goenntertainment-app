<?php

namespace App\Support;

use Closure;
use Illuminate\Support\Facades\Log;

/**
 * Die Passwortregel - fuer Registrieren, Zuruecksetzen und Aendern.
 *
 * ## Die Regel, in dieser Reihenfolge
 *
 *   1. mindestens 8 Zeichen, Buchstaben UND Zahlen. Das ist die alte Regel, und
 *      ihr Text bleibt Wort fuer Wort derselbe: Die App zeigt ihn seit Monaten,
 *      und aeltere App-Fassungen pruefen ihn schon vor dem Absenden.
 *   2. nicht in `shared/common-passwords.json`. Verglichen wird das GANZE
 *      Passwort, kleingeschrieben: „geheim" ist verboten, „geheim1234" nicht.
 *      Ein Teilstring-Vergleich klaenge strenger, waere aber willkuerlich - er
 *      verboete jedes Passwort, in dem irgendwo „hallo" oder „love" steckt.
 *   3. enthaelt weder den Benutzernamen noch den Teil der E-Mail vor dem @ -
 *      ohne Ruecksicht auf Gross/klein, und erst ab 4 Zeichen. Bei „max" oder
 *      „al" traefe es sonst halbe Woerterbuecher; ab vier Zeichen ist es ein
 *      echter Hinweis darauf, dass jemand sein Passwort aus dem Namen baut -
 *      und genau damit probiert es ein Angreifer als Erstes.
 *
 * Die erste verletzte Regel gewinnt. `message` ist in der App die EINE Meldung,
 * die angezeigt wird (siehe bootstrap/app.php), mehrere haelfen niemandem.
 *
 * ## Wo es sie noch gibt
 *
 * In server/src/password-policy.js - gleiche Regel, gleiche Texte. Node hat
 * eigene Wege zum Registrieren und Zuruecksetzen, und das Server-Abbild in
 * deploy/ startet sogar nur Node. Die App liest dieselbe Liste fuer ihre
 * Staerkeanzeige. Wer hier etwas aendert, aendert es an allen drei Stellen.
 */
final class PasswordPolicy
{
    public const MSG_BASIC = 'Das Passwort muss mindestens 8 Zeichen mit Buchstaben und Zahlen haben.';

    public const MSG_COMMON = 'Dieses Passwort ist zu leicht zu erraten – nimm ein anderes.';

    public const MSG_PERSONAL = 'Das Passwort darf deinen Benutzernamen oder deine E-Mail-Adresse nicht enthalten.';

    /** Ab dieser Laenge zaehlt ein Name/E-Mail-Teil als „im Passwort enthalten". */
    private const MIN_PERSONAL_LENGTH = 4;

    /** Die Liste als Schluessel-Menge (Nachschlagen in O(1)); einmal je Prozess geladen. */
    private static ?array $common = null;

    /**
     * Die erste verletzte Regel als Meldung - oder null, wenn das Passwort taugt.
     *
     * `$username`/`$email` duerfen fehlen; dann entfaellt nur die dritte
     * Pruefung fuer das fehlende Stueck.
     */
    public static function problem(mixed $password, ?string $username = null, ?string $email = null): ?string
    {
        $s = is_scalar($password) ? (string) $password : '';

        if ($s === '' || mb_strlen($s) < 8
            || preg_match('/[a-zA-Z]/', $s) !== 1
            || preg_match('/\d/', $s) !== 1) {
            return self::MSG_BASIC;
        }

        $lower = mb_strtolower($s);

        if (isset(self::commonPasswords()[$lower])) {
            return self::MSG_COMMON;
        }

        foreach ([$username, self::emailLocalPart($email)] as $part) {
            if (is_string($part) && mb_strlen($part) >= self::MIN_PERSONAL_LENGTH
                && str_contains($lower, mb_strtolower($part))) {
                return self::MSG_PERSONAL;
            }
        }

        return null;
    }

    /** Als Laravel-Validierungsregel (Closure), wie die uebrigen Regeln der Controller. */
    public static function rule(?string $username = null, ?string $email = null): Closure
    {
        return static function (string $attribute, mixed $value, Closure $fail) use ($username, $email): void {
            $problem = self::problem($value, $username, $email);

            if ($problem !== null) {
                $fail($problem);
            }
        };
    }

    /** Stimmt das Passwort mit der Liste ueberein? (fuer Tests und die Staerke-Frage) */
    public static function isCommon(string $password): bool
    {
        return isset(self::commonPasswords()[mb_strtolower($password)]);
    }

    /**
     * Pfad der gemeinsamen Liste.
     *
     * Ueber `__DIR__` statt `base_path()`: So bleibt die Klasse ohne gestartetes
     * Framework benutzbar (die Unit-Tests brauchen keine App). Der Ort ist
     * derselbe - api/app/Support -> drei Ebenen hoch -> Repo-Wurzel.
     */
    public static function listPath(): string
    {
        return dirname(__DIR__, 3).'/shared/common-passwords.json';
    }

    /**
     * Die Liste, einmal geladen.
     *
     * Fehlt die Datei oder ist sie kaputt, laeuft die Anmeldung weiter - mit
     * Grundregel und Namens-Pruefung, aber ohne Liste, und mit einem Eintrag im
     * Log. Ein Registrieren, das wegen einer fehlenden JSON-Datei mit 500
     * scheitert, waere der groessere Schaden.
     */
    private static function commonPasswords(): array
    {
        if (self::$common !== null) {
            return self::$common;
        }

        $raw = @file_get_contents(self::listPath());
        $list = is_string($raw) ? json_decode($raw, true) : null;

        if (! is_array($list)) {
            try {
                Log::warning('[password-policy] Liste haeufiger Passwoerter nicht lesbar: '.self::listPath());
            } catch (\Throwable) {
                // Ohne gestartetes Framework (Unit-Test) gibt es kein Log - egal.
            }

            return self::$common = [];
        }

        $set = [];
        foreach ($list as $entry) {
            if (is_string($entry) && $entry !== '') {
                $set[mb_strtolower($entry)] = true;
            }
        }

        return self::$common = $set;
    }

    private static function emailLocalPart(?string $email): ?string
    {
        if (! is_string($email)) {
            return null;
        }

        $at = strpos($email, '@');

        return ($at !== false && $at > 0) ? substr($email, 0, $at) : null;
    }
}
