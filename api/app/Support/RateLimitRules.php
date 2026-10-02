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
     * The override of one limit from the environment, for config/ratelimits.php only (it runs
     * while the configuration loads, like env()). Unset or empty gives the default in code: the
     * production compose passes every variable as `${NAME:-}`, so an override that is not set
     * there arrives as an empty string. Any other value is returned unchanged, so a malformed
     * one ('0', 'abc') is still refused by parse(), never replaced by the default.
     */
    public static function env(string $name, string $default): mixed
    {
        $value = \env($name);

        return $value === null || $value === '' ? $default : $value;
    }

    /**
     * Parses every rule of config/ratelimits.php. Called while the application boots
     * (AppServiceProvider), so a malformed override stops it there: in the api container the
     * entrypoint's `php artisan config:cache` fails and the container does not start, instead of
     * the sign-in routes answering 500. The message names the limiter and the scope.
     */
    public static function assertValid(mixed $config): void
    {
        if (! is_array($config) || $config === []) {
            throw new LogicException('config/ratelimits.php has no limits.');
        }

        foreach ($config as $limiter => $scopes) {
            if (! is_array($scopes) || $scopes === []) {
                throw new LogicException("config/ratelimits.php has no scopes for '{$limiter}'.");
            }
            foreach ($scopes as $scope => $spec) {
                try {
                    self::parse($spec);
                } catch (InvalidArgumentException $e) {
                    throw new InvalidArgumentException("config/ratelimits.php {$limiter}.{$scope}: ".$e->getMessage(), 0, $e);
                }
            }
        }
    }

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
