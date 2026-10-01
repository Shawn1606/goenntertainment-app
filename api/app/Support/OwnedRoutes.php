<?php

namespace App\Support;

use App\Http\Controllers\NodeFallbackController;
use Illuminate\Routing\Route;
use Illuminate\Routing\Router;
use WeakMap;

/**
 * The paths Laravel owns, read from Laravel's own route table at request time (F-01).
 *
 * There is no hand-kept list: a route added in routes/*.php is owned from the moment it exists.
 * Every route counts except the Node fallback itself (named FALLBACK_ROUTE), whatever its method,
 * prefix or domain: a path that leaves /api through dot segments and lands on /up or / is owned
 * too. Each route is matched with its own compiled pattern (so {parameters}, optional parts and
 * where() constraints apply), made case-insensitive, against the normalised path (ApiPath).
 */
final class OwnedRoutes
{
    public const FALLBACK_ROUTE = 'node.fallback';

    /** Case-insensitive pattern per route object, built once per route. */
    private static ?WeakMap $patterns = null;

    public function __construct(private readonly Router $router) {}

    /** The methods Laravel serves on this normalised path, or null when Laravel owns no route there. */
    public function methodsFor(string $normalised): ?array
    {
        $methods = null;
        foreach ($this->router->getRoutes()->getRoutes() as $route) {
            if (self::isFallback($route)) {
                continue;
            }
            if (preg_match(self::pattern($route), $normalised) === 1) {
                $methods = array_merge($methods ?? [], $route->methods());
            }
        }

        return $methods === null ? null : array_values(array_unique($methods));
    }

    /** Whether a route is the Node fallback (by name, or by its controller if the name were lost). */
    public static function isFallback(Route $route): bool
    {
        return $route->getName() === self::FALLBACK_ROUTE
            || $route->getControllerClass() === NodeFallbackController::class;
    }

    private static function pattern(Route $route): string
    {
        self::$patterns ??= new WeakMap;

        // Symfony's compiled pattern ('{^/api/login$}sDu') plus the i modifier.
        return self::$patterns[$route] ??= $route->toSymfonyRoute()->compile()->getRegex().'i';
    }
}
