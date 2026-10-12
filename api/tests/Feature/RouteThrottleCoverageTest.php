<?php

namespace Tests\Feature;

use App\Http\Middleware\ThrottleRequestsExactly;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Routing\Route as RoutingRoute;
use Illuminate\Support\Facades\Route;
use Tests\TestCase;

/**
 * Every route Laravel serves is either rate-limited by its named limiter or exempt with a reason
 * (AGENTS.md: every route needs a rate limit; F-01/F-19 review: every auth route has one). The
 * whole route table is checked, not a sample: a new route fails this test until it is listed
 * here, and an auth route without its limiter fails it too. config/ratelimits.php has the numbers.
 *
 * Laravel serves every path itself: there is no catch-all route that hands unknown paths to
 * another backend (the former Node fallback is gone), so an unlisted path answers 404.
 */
class RouteThrottleCoverageTest extends TestCase
{
    /** Route signature => its one throttle middleware. */
    private const LIMITED = [
        'POST api/register' => 'throttle:register',
        'POST api/login' => 'throttle:login',
        'POST api/forgot-password' => 'throttle:password-forgot',
        'POST api/reset-password' => 'throttle:password-reset',
        'POST api/login/two-factor' => 'throttle:two-factor',
        'POST api/login/two-factor/resend' => 'throttle:two-factor-resend',
        'PATCH api/user' => 'throttle:profile',
        'POST api/user/avatar' => 'throttle:avatar',
        'DELETE api/user/avatar' => 'throttle:profile',
        'PUT api/user/password' => 'throttle:account-sensitive',
        'POST api/user/password/code' => 'throttle:account-sensitive',
        'PUT api/user/email' => 'throttle:account-sensitive',
        'POST api/user/email/confirm' => 'throttle:account-sensitive',
        'DELETE api/me' => 'throttle:account-sensitive',
        'POST api/user/two-factor/email' => 'throttle:two-factor-setup',
        'POST api/user/two-factor/email/confirm' => 'throttle:two-factor-setup',
        'POST api/user/two-factor/totp' => 'throttle:two-factor-setup',
        'POST api/user/two-factor/totp/confirm' => 'throttle:two-factor-setup',
        'POST api/user/two-factor/code' => 'throttle:two-factor-setup',
        'POST api/user/two-factor/recovery-codes' => 'throttle:two-factor-setup',
        'DELETE api/user/two-factor' => 'throttle:two-factor-setup',

        // Money and credits
        'POST api/bookings' => 'throttle:payments',
        'POST api/bookings/{id}/cancel' => 'throttle:payments',
        'POST api/bookings/{id}/feedback' => 'throttle:payments',
        'POST api/club/subscribe' => 'throttle:payments',
        'POST api/club/cancel' => 'throttle:payments',
        'POST api/wallet/purchase' => 'throttle:payments',
        'POST api/bingo/claim' => 'throttle:payments',
        // Codes that could be guessed: vouchers and group invitations
        'POST api/wallet/redeem' => 'throttle:voucher-redeem',
        'POST api/groups/join' => 'throttle:voucher-redeem',
        'GET|HEAD api/groups/invite/{code}' => 'throttle:voucher-redeem',
        // Check-ins and the sticker
        'POST api/checkins' => 'throttle:checkin',
        'POST api/bookings/{id}/redeem' => 'throttle:checkin',
        'POST api/partner/checkins' => 'throttle:checkin',
        'POST api/partner/bookings/{id}/redeem' => 'throttle:checkin',
        // Groups and their chat
        'POST api/groups' => 'throttle:write-content',
        'PATCH api/groups/{id}' => 'throttle:write-content',
        'DELETE api/groups/{id}' => 'throttle:write-content',
        'POST api/groups/{id}/invite-code' => 'throttle:write-content',
        'DELETE api/groups/{id}/members/{userId}' => 'throttle:write-content',
        'POST api/groups/{id}/messages' => 'throttle:chat-send',
        'POST api/groups/{id}/read' => 'throttle:write-state',
        'DELETE api/messages/{id}' => 'throttle:write-content',
        // Reports and blocks
        'POST api/reports' => 'throttle:write-report',
        'POST api/blocks' => 'throttle:write-block',
        'DELETE api/blocks/{userId}' => 'throttle:write-block',

        // Reads without a token: per client address
        'GET|HEAD api/interests' => 'throttle:read-public',
        'GET|HEAD api/bookings/{id}/calendar.ics' => 'throttle:read-public',
        // Signed-in reads, and the price quote (computes, writes nothing): per account
        'GET|HEAD api/user' => 'throttle:read',
        'GET|HEAD api/offers' => 'throttle:read',
        'GET|HEAD api/offers/{offer}' => 'throttle:read',
        'POST api/offers/{offer}/quote' => 'throttle:read',
        'GET|HEAD api/offers/{offer}/availability' => 'throttle:read',
        'GET|HEAD api/partners' => 'throttle:read',
        'GET|HEAD api/partners/{partner}' => 'throttle:read',
        'GET|HEAD api/bookings' => 'throttle:read',
        'GET|HEAD api/bookings/{id}' => 'throttle:read',
        'GET|HEAD api/badges' => 'throttle:read',
        'GET|HEAD api/club' => 'throttle:read',
        'GET|HEAD api/wallet' => 'throttle:read',
        'GET|HEAD api/features' => 'throttle:read',
        'GET|HEAD api/bingo' => 'throttle:read',
        'GET|HEAD api/stamps' => 'throttle:read',
        'GET|HEAD api/pass' => 'throttle:read',
        'GET|HEAD api/partner/me' => 'throttle:read',
        'GET|HEAD api/partner/bookings' => 'throttle:read',
        'GET|HEAD api/groups' => 'throttle:read',
        'GET|HEAD api/groups/{id}' => 'throttle:read',
        'GET|HEAD api/groups/{id}/messages' => 'throttle:read',
        'GET|HEAD api/blocks' => 'throttle:read',

        // Admin reads, and the voucher codes (each worth credits) with a tighter limit of their own
        'GET|HEAD api/admin/stats' => 'throttle:read-admin',
        'GET|HEAD api/admin/bookings' => 'throttle:read-admin',
        'GET|HEAD api/admin/reports' => 'throttle:read-admin',
        'GET|HEAD api/admin/users' => 'throttle:read-admin',
        'GET|HEAD api/admin/users/{id}' => 'throttle:read-admin',
        'GET|HEAD api/admin/evidence' => 'throttle:read-admin',
        'GET|HEAD api/admin/evidence-files/{file}' => 'throttle:read-admin',
        'GET|HEAD api/admin/partners' => 'throttle:read-admin',
        'GET|HEAD api/admin/partners/{partner}' => 'throttle:read-admin',
        'GET|HEAD api/admin/offers' => 'throttle:read-admin',
        'GET|HEAD api/admin/voucher-batches' => 'throttle:read-admin',
        'GET|HEAD api/admin/features' => 'throttle:read-admin',
        'GET|HEAD api/admin/testphase' => 'throttle:read-admin',
        'GET|HEAD api/admin/voucher-batches/{batch}/codes.csv' => 'throttle:admin-export',

        // Admin writes
        'PATCH api/admin/reports/{id}' => 'throttle:write-admin',
        'DELETE api/admin/messages/{id}' => 'throttle:write-admin',
        'PATCH api/admin/groups/{id}' => 'throttle:write-admin',
        'DELETE api/admin/groups/{id}' => 'throttle:write-admin',
        'POST api/admin/users/{id}/clear-profile' => 'throttle:write-admin',
        'PATCH api/admin/users/{id}' => 'throttle:write-admin',
        'POST api/admin/users/{id}/ban' => 'throttle:write-admin',
        'POST api/admin/users/{id}/timeout' => 'throttle:write-admin',
        'POST api/admin/users/{id}/unban' => 'throttle:write-admin',
        'POST api/admin/users/{id}/credits' => 'throttle:write-admin',
        'POST api/admin/users/{id}/stamps' => 'throttle:write-admin',
        'DELETE api/admin/users/{id}' => 'throttle:write-admin',
        'POST api/admin/partners' => 'throttle:write-admin',
        'PATCH api/admin/partners/{partner}' => 'throttle:write-admin',
        'DELETE api/admin/partners/{partner}' => 'throttle:write-admin',
        'POST api/admin/partners/{partner}/image' => 'throttle:write-admin',
        'POST api/admin/partners/{partner}/rotate-token' => 'throttle:write-admin',
        'POST api/admin/partners/{partner}/staff' => 'throttle:write-admin',
        'DELETE api/admin/partners/{partner}/staff/{userId}' => 'throttle:write-admin',
        'POST api/admin/offers' => 'throttle:write-admin',
        'PATCH api/admin/offers/{offer}' => 'throttle:write-admin',
        'DELETE api/admin/offers/{offer}' => 'throttle:write-admin',
        'POST api/admin/offers/{offer}/image' => 'throttle:write-admin',
        'POST api/admin/voucher-batches' => 'throttle:write-admin',
        'POST api/admin/vouchers/disable' => 'throttle:write-admin',
        'PUT api/admin/features/{key}' => 'throttle:write-admin',
        'PUT api/admin/features/{key}/preview' => 'throttle:write-admin',
        'POST api/admin/testphase/claim' => 'throttle:write-admin',
        'POST api/admin/testphase/challenges' => 'throttle:write-admin',
        'DELETE api/admin/testphase/challenges/{id}' => 'throttle:write-admin',
        'POST api/admin/testphase/examples' => 'throttle:write-admin',
        'POST api/admin/testphase/choose' => 'throttle:write-admin',
        'POST api/admin/testphase/wishes' => 'throttle:write-admin',
        'POST api/admin/testphase/wishes/{id}/vote' => 'throttle:write-admin',
        'DELETE api/admin/testphase/wishes/{id}' => 'throttle:write-admin',
        'POST api/admin/testphase/shares' => 'throttle:write-admin',
        'POST api/admin/testphase/shares/{id}/pay' => 'throttle:write-admin',
        'POST api/admin/testphase/shares/{id}/decline' => 'throttle:write-admin',
        'POST api/admin/testphase/polls' => 'throttle:write-admin',
        'POST api/admin/testphase/polls/{id}/vote' => 'throttle:write-admin',
        'POST api/admin/testphase/polls/{id}/close' => 'throttle:write-admin',
    ];

    /** Route signature => why it has no limiter. No route of the app's own is waiting for one. */
    private const EXEMPT = [
        'GET|HEAD api/health' => 'container health probe; one constant query, nothing user-specific',
        'POST api/logout' => 'deletes only the token it is sent with; nothing to guess or to flood, and a refused sign-out would keep the token',
        'GET|HEAD /' => 'static web page of the framework skeleton',
        'GET|HEAD c/{token}' => 'static page that opens the app for a sticker link; no database',
        'GET|HEAD g/{code}' => 'static page that opens the app for an invitation link; no database',
        'GET|HEAD up' => 'framework health route',
        'GET|HEAD sanctum/csrf-cookie' => 'Sanctum sets a CSRF cookie; the app signs in with tokens and never calls it',
    ];

    private static function signature(RoutingRoute $route): string
    {
        return implode('|', $route->methods()).' '.$route->uri();
    }

    /** @return list<string> the throttle middleware of a route, as 'throttle:<name>' */
    private static function throttles(RoutingRoute $route): array
    {
        $found = [];
        foreach ($route->gatherMiddleware() as $middleware) {
            if (! is_string($middleware)) {
                continue;
            }
            if (str_starts_with($middleware, 'throttle:')) {
                $found[] = $middleware;
            } elseif (str_starts_with($middleware, ThrottleRequests::class.':')) {
                $found[] = 'throttle:'.substr($middleware, strlen(ThrottleRequests::class) + 1);
            }
        }

        return $found;
    }

    /**
     * A route that takes any path below it: a parameter that may hold a slash (a `where` pattern
     * that matches one), or Laravel's own fallback route.
     */
    private static function isCatchAll(RoutingRoute $route): bool
    {
        if ($route->isFallback) {
            return true;
        }
        foreach ($route->wheres as $pattern) {
            if (preg_match('#^(?:'.$pattern.')$#u', 'a/b') === 1) {
                return true;
            }
        }

        return false;
    }

    public function test_every_route_is_limited_or_exempt_with_a_reason(): void
    {
        $seen = [];
        $problems = [];

        foreach (Route::getRoutes()->getRoutes() as $route) {
            $signature = self::signature($route);
            $throttles = self::throttles($route);

            if (self::isCatchAll($route)) {
                $problems[] = "{$signature}: a catch-all route; Laravel serves every path itself";
            }

            $seen[] = $signature;
            if (array_key_exists($signature, self::LIMITED)) {
                if ($throttles !== [self::LIMITED[$signature]]) {
                    $problems[] = "{$signature}: expected exactly ".self::LIMITED[$signature].', found ['.implode(', ', $throttles).']';
                }
            } elseif (array_key_exists($signature, self::EXEMPT)) {
                if ($throttles !== []) {
                    $problems[] = "{$signature}: listed as exempt but limited by ".implode(', ', $throttles);
                }
            } else {
                $problems[] = "{$signature}: not in the table - give it a limiter or an exemption with a reason";
            }
        }

        $listed = array_merge(array_keys(self::LIMITED), array_keys(self::EXEMPT));
        foreach (array_diff($listed, $seen) as $gone) {
            $problems[] = "{$gone}: listed here but not in the route table";
        }

        $denominator = sprintf(
            '%d routes checked: %d limited, %d exempt',
            count($seen),
            count(self::LIMITED),
            count(self::EXEMPT),
        );
        fwrite(STDERR, "\n[route throttles] {$denominator}\n");

        $this->assertGreaterThan(0, count($seen));
        $this->assertSame([], $problems, $denominator);
    }

    /** The catch-all check fires on the shapes a forwarding route takes. */
    public function test_the_catch_all_check_recognises_a_forwarding_route(): void
    {
        $any = (new RoutingRoute(['GET', 'POST'], 'api/{path?}', fn () => null))->where('path', '.*');
        $fallback = (new RoutingRoute(['GET'], '{fallbackPlaceholder}', fn () => null))->where('fallbackPlaceholder', '.*')->fallback();
        $number = (new RoutingRoute(['GET'], 'api/groups/{id}', fn () => null))->whereNumber('id');
        $file = (new RoutingRoute(['GET'], 'api/admin/evidence-files/{file}', fn () => null))->where('file', '[0-9a-f]{40}\.(jpg|png|webp)');

        $this->assertTrue(self::isCatchAll($any));
        $this->assertTrue(self::isCatchAll($fallback));
        $this->assertFalse(self::isCatchAll($number));
        $this->assertFalse(self::isCatchAll($file));
    }

    /** Auth routes by their path: whatever else changes, none of these may lose its limiter. */
    public function test_every_auth_route_has_a_limiter(): void
    {
        $checked = 0;
        $unlimited = [];
        foreach (Route::getRoutes()->getRoutes() as $route) {
            $isAuth = preg_match('#^api/(register|login|logout|forgot-password|reset-password|user|me)(/|$)#', $route->uri()) === 1;
            $writes = array_diff($route->methods(), ['GET', 'HEAD', 'OPTIONS']) !== [];
            if (! $isAuth || ! $writes || self::signature($route) === 'POST api/logout') {
                continue;
            }
            $checked++;
            if (self::throttles($route) === []) {
                $unlimited[] = self::signature($route);
            }
        }

        $this->assertGreaterThanOrEqual(15, $checked, "only {$checked} auth write routes found");
        $this->assertSame([], $unlimited, "{$checked} auth write routes checked");
    }

    /** Every read route of the API, by its method: none may go without a limiter either. */
    public function test_every_api_read_route_has_a_limiter(): void
    {
        $checked = 0;
        $unlimited = [];
        foreach (Route::getRoutes()->getRoutes() as $route) {
            $reads = array_diff($route->methods(), ['GET', 'HEAD', 'OPTIONS']) === [];
            // The container's health probe (EXEMPT says why).
            if (! $reads || ! str_starts_with($route->uri(), 'api/') || $route->uri() === 'api/health') {
                continue;
            }
            $checked++;
            if (self::throttles($route) === []) {
                $unlimited[] = self::signature($route);
            }
        }

        $this->assertGreaterThanOrEqual(35, $checked, "only {$checked} API read routes found");
        $this->assertSame([], $unlimited, "{$checked} API read routes checked");
    }

    /** Every write route, by its method: none may go without a limiter, whatever the table says. */
    public function test_every_write_route_has_a_limiter(): void
    {
        $checked = 0;
        $unlimited = [];
        foreach (Route::getRoutes()->getRoutes() as $route) {
            $writes = array_diff($route->methods(), ['GET', 'HEAD', 'OPTIONS']) !== [];
            $signature = self::signature($route);
            // The sign-out of the token in use (EXEMPT says why).
            if (! $writes || $signature === 'POST api/logout') {
                continue;
            }
            $checked++;
            if (self::throttles($route) === []) {
                $unlimited[] = $signature;
            }
        }

        $this->assertGreaterThanOrEqual(80, $checked, "only {$checked} write routes found");
        $this->assertSame([], $unlimited, "{$checked} write routes checked");
    }

    /**
     * `throttle` is the variant that checks and counts each counter as one step (the
     * stock middleware lets a burst past a per-account cap), and no route names the stock
     * class directly, which would step around the alias.
     */
    public function test_every_limiter_checks_and_counts_as_one_step(): void
    {
        $this->assertSame(ThrottleRequestsExactly::class, app('router')->getMiddleware()['throttle'] ?? null);

        $aliased = 0;
        $stock = [];
        foreach (Route::getRoutes()->getRoutes() as $route) {
            foreach ($route->gatherMiddleware() as $middleware) {
                if (! is_string($middleware)) {
                    continue;
                }
                if (str_starts_with($middleware, 'throttle:')) {
                    $aliased++;
                } elseif (str_starts_with($middleware, ThrottleRequests::class)) {
                    $stock[] = self::signature($route);
                }
            }
        }

        $this->assertSame(count(self::LIMITED), $aliased, 'every limited route uses the throttle alias');
        $this->assertSame([], $stock, 'routes that name the stock throttle class');
    }
}
