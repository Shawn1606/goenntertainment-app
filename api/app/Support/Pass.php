<?php

namespace App\Support;

use App\Models\User;

/**
 * Der Kunden-Pass: ein QR-Code in der App, den der Partner scannt.
 *
 * Er traegt die Konto-ID, ein Ablaufdatum und eine Unterschrift (HMAC mit
 * APP_KEY). Ein Screenshot taugt deshalb nur zwei Minuten, und eine erfundene ID
 * faellt an der Unterschrift durch. Die App holt alle 60 Sekunden einen frischen.
 *
 *   GP1.<user-id>.<ablauf-unix>.<unterschrift>
 */
final class Pass
{
    private const PREFIX = 'GP1';

    /** @return array{token: string, expires_at: string} */
    public static function issue(User $user): array
    {
        $expires = now()->addSeconds((int) config('club.pass_ttl_seconds', 120))->getTimestamp();
        $payload = self::PREFIX.'.'.$user->getKey().'.'.$expires;

        return [
            'token' => $payload.'.'.self::sign($payload),
            'expires_at' => date(DATE_ATOM, $expires),
        ];
    }

    /** Die Konto-ID aus einem gueltigen Pass - oder null (abgelaufen, gefaelscht, Unsinn). */
    public static function verify(string $token): ?int
    {
        $parts = explode('.', trim($token));
        if (count($parts) !== 4 || $parts[0] !== self::PREFIX) {
            return null;
        }

        [$prefix, $userId, $expires, $signature] = $parts;
        if (! ctype_digit($userId) || ! ctype_digit($expires)) {
            return null;
        }
        if (! hash_equals(self::sign("{$prefix}.{$userId}.{$expires}"), $signature)) {
            return null;
        }
        if ((int) $expires < now()->getTimestamp()) {
            return null;
        }

        return (int) $userId;
    }

    private static function sign(string $payload): string
    {
        return substr(hash_hmac('sha256', $payload, (string) config('app.key')), 0, 24);
    }
}
