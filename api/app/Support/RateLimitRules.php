<?php

namespace App\Support;

use Closure;
use Illuminate\Cache\RateLimiting\Limit;
use InvalidArgumentException;
use LogicException;

/**
 * Turns the rules of config/ratelimits.php into Laravel limits.
 *
 * A rule is "max/seconds"; a scope may list several, comma-separated. Every rule becomes its own
 * Limit, and the window is part of the Limit's key: ThrottleRequests counts by limiter name and
 * key, so two windows with the same key would share one counter.
 *
 * Malformed values throw instead of falling back to some default: a typo in an override must be
 * seen, not turn a limit off.
 */
final class RateLimitRules
{
    /**
     * @return list<array{max: int, seconds: int}>
     */
    public static function parse(mixed $spec): array
    {
        if (! is_string($spec) || trim($spec) === '') {
            throw new InvalidArgumentException('A rate limit needs at least one "max/seconds" rule.');
        }

        $rules = [];
        foreach (explode(',', $spec) as $part) {
            if (preg_match('/^\s*([1-9]\d{0,6})\s*\/\s*([1-9]\d{0,7})\s*$/', $part, $m) !== 1) {
                throw new InvalidArgumentException('Rate limit rules look like "10/60,30/3600" (max/seconds), got "'.$spec.'".');
            }
            $rules[] = ['max' => (int) $m[1], 'seconds' => (int) $m[2]];
        }

        return $rules;
    }

    /**
     * The limits of one named limiter for one request.
     *
     * @param  array<string, string>  $keys  one key per scope of config("ratelimits.$limiter")
     * @return list<Limit>
     */
    public static function limits(string $limiter, array $keys, Closure $response): array
    {
        $scopes = config("ratelimits.{$limiter}");
        if (! is_array($scopes) || $scopes === []) {
            throw new LogicException("config/ratelimits.php has no limits for '{$limiter}'.");
        }

        $missing = array_diff(array_keys($scopes), array_keys($keys));
        $unused = array_diff(array_keys($keys), array_keys($scopes));
        if ($missing !== [] || $unused !== []) {
            throw new LogicException("Limiter '{$limiter}': the scopes in config/ratelimits.php and the keys given differ.");
        }

        $limits = [];
        foreach ($scopes as $scope => $spec) {
            foreach (self::parse($spec) as $rule) {
                $limits[] = (new Limit("{$limiter}|{$scope}|{$keys[$scope]}|{$rule['seconds']}", $rule['max'], $rule['seconds']))
                    ->response($response);
            }
        }

        return $limits;
    }
}
