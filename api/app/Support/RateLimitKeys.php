<?php

namespace App\Support;

use App\Models\User;
use Illuminate\Http\Request;

/**
 * What the auth limiters count by (config/ratelimits.php explains the scopes).
 *
 * The account key makes a cap hold across addresses: whoever rotates client addresses still hits
 * the same counter for the same account. A rotating attacker can only spread over accounts, which
 * the per-address rules slow down.
 */
final class RateLimitKeys
{
    /**
     * The client address as Laravel trusts it (config/trustedproxy.php). IPv6 addresses are
     * grouped per /64, the block one subscriber usually gets: counting each of its 2^64 addresses
     * on its own would let one subscriber step around every per-address rule.
     */
    public static function ip(Request $request): string
    {
        $ip = (string) $request->ip();
        $packed = @inet_pton($ip);

        if ($packed !== false && strlen($packed) === 16) {
            return 'v6:'.bin2hex(substr($packed, 0, 8));
        }

        return $ip !== '' ? $ip : 'unknown';
    }

    /**
     * The account a sign-in, sign-up or password request is about, from the e-mail address it
     * names: 'user:<id>' when the address belongs to an account, else a hash of the normalised
     * address. The database decides who an address belongs to (its collation ignores case and
     * accents), so every spelling of a stored address shares one counter. Malformed or over-long
     * values are only hashed, without a query.
     */
    public static function account(mixed $email): string
    {
        if (! is_string($email)) {
            return 'none';
        }

        $normalised = mb_strtolower(trim($email), 'UTF-8');
        if (EmailAddress::isValid($normalised)) {
            $id = User::query()->where('email', $normalised)->value('id');
            if ($id !== null) {
                return 'user:'.$id;
            }
        }

        return 'email:'.hash('sha256', $normalised);
    }

    /**
     * The account of a two-factor sign-in in progress: 'user:<id>' for a known challenge, else a
     * hash of the token (an unknown token has nothing to protect but still counts).
     */
    public static function challengeAccount(mixed $token): string
    {
        $challenge = TwoFactor::findChallenge($token, TwoFactor::PURPOSE_LOGIN);
        if ($challenge !== null) {
            return 'user:'.$challenge->user_id;
        }

        return 'challenge:'.hash('sha256', is_scalar($token) ? (string) $token : '');
    }

    /** The signed-in account (or, without one, the address). */
    public static function user(Request $request): string
    {
        $id = $request->user()?->getAuthIdentifier();

        return $id !== null ? 'user:'.$id : 'ip:'.self::ip($request);
    }
}
