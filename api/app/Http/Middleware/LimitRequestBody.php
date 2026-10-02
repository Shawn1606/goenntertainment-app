<?php

namespace App\Http\Middleware;

use App\Support\ApiPath;
use Closure;
use Illuminate\Http\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Request bodies over a small limit are refused before anything parses them (F-02).
 *
 * Every /api request passes Laravel first, and Laravel reads a body completely before routing and
 * before any rate limit: Request::capture() (public/index.php) json-decodes a JSON body while it
 * builds the request, and the global TrimStrings and ConvertEmptyStringsToNull middleware rebuild
 * the decoded data twice more. Caddy lets 9 MB through and PHP 10 MB (post_max_size), so one
 * request without any throttle could cost hundreds of megabytes and seconds of CPU. Node refused
 * such a body only after Laravel had done all that.
 *
 * So Laravel applies Node's limits itself, first:
 * - public/index.php checks before Request::capture(), so an oversized body is never decoded;
 * - this middleware, first in the global stack (bootstrap/app.php), checks every request that
 *   reaches the kernel another way (the tests, any other entry point).
 *
 * The limits are named mirrors of server/src/app.js (scripts/ci/check-mirrors.mjs compares them):
 * WEBHOOK_JSON_LIMIT_KB for the RevenueCat webhook path (in its normalised spelling, the one the
 * fallback forwards), URLENCODED_LIMIT_KB for application/x-www-form-urlencoded, JSON_LIMIT_KB for
 * every other body. 1 kB is 1024 bytes, as for Node's body parsers; a body of exactly the limit
 * passes. The Content-Length is checked first; a body without one (chunked transfer) is read up to
 * one byte over the limit and refused when that byte is there.
 *
 * Not limited here: a multipart POST. PHP parses it before any code runs (files into temporary
 * files; fields bounded by max_input_vars, max_input_nesting_level and post_max_size) and leaves no
 * raw body behind; uploads are bounded per route by Node. PHP parses multipart only for POST, so a
 * multipart body with any other method stays raw and gets the general limit (the app sends every
 * upload as a POST).
 *
 * The answer is a 413 with the same German message as Node's (server/src/client-errors.js). It is
 * built without the container, because public/index.php sends it before Laravel boots.
 */
final class LimitRequestBody
{
    /** Largest JSON (and any other non-form) body; Node: JSON_LIMIT. */
    public const JSON_LIMIT_KB = 32;

    /** Largest body of the RevenueCat webhook; Node: WEBHOOK_JSON_LIMIT. */
    public const WEBHOOK_JSON_LIMIT_KB = 128;

    /** Largest urlencoded body; Node: URLENCODED_LIMIT. */
    public const URLENCODED_LIMIT_KB = 16;

    /** The webhook path, normalised (App\Support\ApiPath); Node mounts its larger parser there. */
    public const WEBHOOK_PATH = '/api/webhooks/revenuecat';

    /** Node: MSG_TOO_LARGE. */
    public const MSG_TOO_LARGE = 'Die Anfrage ist zu groß.';

    public function handle(Request $request, Closure $next): Response
    {
        return self::exceedsLimit($request) ? self::tooLarge() : $next($request);
    }

    /** The limit in bytes for this request, or null for a multipart POST (PHP has parsed it). */
    public static function limitFor(Request $request): ?int
    {
        $type = strtolower(trim((string) $request->headers->get('Content-Type', '')));
        if (str_starts_with($type, 'multipart/form-data') && $request->getRealMethod() === 'POST') {
            return null;
        }
        if (ApiPath::normalise($request->getPathInfo()) === self::WEBHOOK_PATH) {
            return self::WEBHOOK_JSON_LIMIT_KB * 1024;
        }
        if (str_starts_with($type, 'application/x-www-form-urlencoded')) {
            return self::URLENCODED_LIMIT_KB * 1024;
        }

        return self::JSON_LIMIT_KB * 1024;
    }

    /** Whether the request's body is over its limit. Reads at most limit + 1 bytes of it. */
    public static function exceedsLimit(Request $request): bool
    {
        $limit = self::limitFor($request);
        if ($limit === null) {
            return false;
        }

        $length = $request->server->get('CONTENT_LENGTH');
        if (is_int($length)) {
            $length = (string) $length;
        }
        if (is_string($length) && $length !== '' && ctype_digit($length)) {
            $digits = ltrim($length, '0');
            if (strlen($digits) > 18 || (int) $digits > $limit) {
                return true;
            }
        }

        // No length (chunked), or one within the limit: count what is really there.
        return self::bodyLength($request, $limit + 1) > $limit;
    }

    /** The 413 answer, the same text as Node's. */
    public static function tooLarge(): JsonResponse
    {
        return new JsonResponse(
            ['message' => self::MSG_TOO_LARGE],
            413,
            [],
            JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES,
        );
    }

    /** The length of the body, counted up to $max bytes. */
    private static function bodyLength(Request $request, int $max): int
    {
        $body = $request->getContent(true);
        if (! is_resource($body)) {
            return 0;
        }

        $read = 0;
        while ($read < $max && ! feof($body)) {
            $chunk = fread($body, min(8192, $max - $read));
            if ($chunk === false || $chunk === '') {
                break;
            }
            $read += strlen($chunk);
        }

        return $read;
    }
}
