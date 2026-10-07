<?php

namespace App\Support;

/**
 * The e-mail address check of every route that takes an address (F-02).
 *
 * It accepts exactly what the former pattern '/^[^\s@]+@[^\s@]+\.[^\s@]+$/' accepted, up to
 * MAX_LENGTH characters, and rejects anything longer before looking at it. The former pattern
 * backtracks quadratically on long inputs; this check reads the string a fixed number of times,
 * so a 100,000-character value costs microseconds.
 *
 * Accepted: no whitespace (" \t\n\v\f\r", what \s means without the u modifier), exactly one '@'
 * that is not the first character, and after it a '.' that is neither the first nor the last
 * character of the domain part. One intended difference: the former pattern's '$' also matched
 * before a trailing newline; this check rejects that newline (requests never carry it: Laravel's
 * TrimStrings middleware removes it first).
 *
 * Mirror: src/domain/email.ts (the app). JavaScript counts the length in UTF-16 units and its \s
 * also covers Unicode spaces; both were already so with the former patterns.
 */
final class EmailAddress
{
    /** RFC 5321 path limit minus the angle brackets; users.email holds 255. */
    public const MAX_LENGTH = 254;

    public static function isValid(mixed $value): bool
    {
        if (! is_string($value) || $value === '' || mb_strlen($value, 'UTF-8') > self::MAX_LENGTH) {
            return false;
        }

        if (strpbrk($value, " \t\n\v\f\r") !== false) {
            return false;
        }

        $at = strpos($value, '@');
        if ($at === false || $at === 0 || $at !== strrpos($value, '@')) {
            return false;
        }

        $domain = substr($value, $at + 1);
        if (strlen($domain) < 3) {
            return false;
        }

        $dot = strpos($domain, '.', 1);

        return $dot !== false && $dot < strlen($domain) - 1;
    }
}
