<?php

namespace Tests\Feature;

use App\Http\Controllers\NodeFallbackController;
use App\Http\Middleware\ThrottleRequestsExactly;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Routing\Route as RoutingRoute;
use Illuminate\Support\Facades\Route;
use Tests\TestCase;

/**
 * Every route Laravel serves is either rate-limited by its named limiter or exempt with a reason
 * (AGENTS.md: every route needs a rate limit; F-01/F-19 review: every auth route has one). The
 * whole route table is checked, not a sample: a new route fails this test until it is listed
 * here, and an auth route without its limiter fails it too. The table below is the one in the
 * PR text (config/ratelimits.php has the numbers).
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
    ];

    /** Route signature => why it has no limiter. */
    private const EXEMPT = [
        'GET|HEAD api/health' => 'container health probe; one constant query, nothing user-specific',
        'GET|HEAD api/interests' => 'public read of the category list; reads are not limited yet (backlog)',
        'GET|HEAD api/user' => 'signed-in read of the own account; reads are not limited yet (backlog)',
        'GET|HEAD api/me/progress' => 'signed-in read; reads are not limited yet (backlog)',
        'GET|HEAD api/leaderboard' => 'signed-in read; reads are not limited yet (backlog)',
        'POST api/logout' => 'deletes only the token it is sent with; nothing to guess or to flood',
        'GET|HEAD /' => 'static web page of the framework skeleton',
        'GET|HEAD up' => 'framework health route',
        'GET|HEAD sanctum/csrf-cookie' => 'Sanctum sets a CSRF cookie; the app signs in with tokens and never calls it',
    ];

    /** The fallback forwards to Node; Node limits its own writes. */
    private const FALLBACK_REASON = 'forwards to the Node backend, whose own limits apply there';

    /** The Node fallback, by its controller (as App\Support\OwnedRoutes::isFallback also does). */
    private static function isFallback(RoutingRoute $route): bool
    {
        return $route->getControllerClass() === NodeFallbackController::class;
    }

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

    public function test_every_route_is_limited_or_exempt_with_a_reason(): void
    {
        $seen = [];
        $problems = [];
        $fallbacks = 0;

        foreach (Route::getRoutes()->getRoutes() as $route) {
            $signature = self::signature($route);
            $throttles = self::throttles($route);

            if (self::isFallback($route)) {
                $fallbacks++;
                if ($throttles !== []) {
                    $problems[] = "{$signature}: the Node fallback carries a Laravel limiter (".implode(', ', $throttles).')';
                }

                continue;
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
            '%d routes checked: %d limited, %d exempt, %d fallback (%s)',
            count($seen) + $fallbacks,
            count(self::LIMITED),
            count(self::EXEMPT),
            $fallbacks,
            self::FALLBACK_REASON,
        );
        fwrite(STDERR, "\n[route throttles] {$denominator}\n");

        $this->assertSame(1, $fallbacks, 'exactly one Node fallback route');
        $this->assertGreaterThan(0, count($seen));
        $this->assertSame([], $problems, $denominator);
    }

    /** Auth routes by their path: whatever else changes, none of these may lose its limiter. */
    public function test_every_auth_route_has_a_limiter(): void
    {
        $checked = 0;
        $unlimited = [];
        foreach (Route::getRoutes()->getRoutes() as $route) {
            if (self::isFallback($route)) {
                continue;
            }
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
