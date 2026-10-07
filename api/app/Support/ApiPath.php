<?php

namespace App\Support;

/**
 * One spelling per request path (F-01).
 *
 * Laravel matches its routes case-sensitively against the path decoded once. While a Node backend
 * sat behind Laravel, its routers matched case-insensitively, and the fallback forwarded the path
 * as the client wrote it: a path Laravel owns could reach Node's copy under another spelling
 * (other case, doubled or trailing slashes, dot segments, percent-encoding), past Laravel's
 * throttles. normalise() maps all those spellings onto one. The fallback is gone with Node;
 * LimitRequestBody still uses it, so every spelling of the webhook path gets the same body limit.
 */
final class ApiPath
{
    /** More decoding rounds than any honest path needs; a path still changing after that is refused. */
    public const MAX_DECODE_ROUNDS = 8;

    /**
     * The normalised path ('/api/...'), or null when the path must be refused.
     *
     * 1. Percent-decode until the result no longer changes ('+' stays a plus, as in a path).
     * 2. Refuse invalid UTF-8 and control characters (NUL included).
     * 3. A backslash counts as a slash.
     * 4. Lower-case.
     * 5. Resolve '.' and '..' segments (RFC 3986 remove_dot_segments) and drop empty segments,
     *    which removes repeated and trailing slashes.
     */
    public static function normalise(string $rawPath): ?string
    {
        $path = $rawPath;
        for ($round = 0; ; $round++) {
            $decoded = rawurldecode($path);
            if ($decoded === $path) {
                break;
            }
            if ($round === self::MAX_DECODE_ROUNDS) {
                return null;
            }
            $path = $decoded;
        }

        if (! mb_check_encoding($path, 'UTF-8') || preg_match('/[\x00-\x1F\x7F]/', $path) === 1) {
            return null;
        }

        $path = mb_strtolower(str_replace('\\', '/', $path), 'UTF-8');

        $segments = [];
        foreach (explode('/', $path) as $segment) {
            if ($segment === '' || $segment === '.') {
                continue;
            }
            if ($segment === '..') {
                array_pop($segments);

                continue;
            }
            $segments[] = $segment;
        }

        return '/'.implode('/', $segments);
    }

    /** The normalised path encoded per segment for the upstream URL ('?', '#', '%' stay inside their segment). */
    public static function encode(string $normalised): string
    {
        return implode('/', array_map('rawurlencode', explode('/', $normalised)));
    }

    /** Whether a normalised path lies under /api. */
    public static function isUnderApi(string $normalised): bool
    {
        return $normalised === '/api' || str_starts_with($normalised, '/api/');
    }
}
