<?php

namespace Tests\Feature;

use App\Http\Controllers\NodeFallbackController;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Tests\TestCase;

/**
 * One owner per path (F-01): Node serves no path Laravel owns.
 *
 * Reads Node's routing from its source (server/src/app.js: the mounted routers and app-level
 * routes; server/src/routes/*.js: every router.<method>('path')) and asks Laravel's own router
 * whether a route other than the Node fallback matches that path, for any method. Such a Node
 * route is a copy ("twin") that the fallback would never forward to, or worse, one that serves
 * the same path past Laravel's checks. A new Laravel route that takes over a Node path makes this
 * test fail until Node's copy is deleted.
 *
 * Denominator: the number of parsed endpoints must equal a second, independent count of
 * `router.<method>(` calls in the mounted files, and be above zero.
 */
class NodeTwinRoutesTest extends TestCase
{
    private const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

    private static function serverSource(string $relative): string
    {
        $path = dirname(__DIR__, 3).'/server/src/'.$relative;
        self::assertFileExists($path);

        return (string) file_get_contents($path);
    }

    /**
     * Node's endpoints as [method, full path] with ':param' as written.
     *
     * @return array{0: list<array{0: string, 1: string}>, 1: int}  endpoints and the independent count
     */
    private static function nodeEndpoints(): array
    {
        $app = self::serverSource('app.js');

        // import xRouter from './routes/x.js'   or   import { xRouter } from './routes/x.js'
        preg_match_all("/import\s+(?:\{\s*(\w+)\s*\}|(\w+))\s+from\s+'\.\/routes\/([\w-]+)\.js'/", $app, $imports, PREG_SET_ORDER);
        $files = [];
        foreach ($imports as $m) {
            $files[$m[1] !== '' ? $m[1] : $m[2]] = $m[3].'.js';
        }

        $endpoints = [];
        $independent = 0;

        // app.get('/path', ...) directly on the app
        preg_match_all("/\bapp\.(".implode('|', self::METHODS).")\(\s*'([^']+)'/", $app, $direct, PREG_SET_ORDER);
        foreach ($direct as $m) {
            $endpoints[] = [strtoupper($m[1]), $m[2]];
        }
        $independent += preg_match_all('/\bapp\.(?:'.implode('|', self::METHODS).')\(/', $app);

        // app.use('/prefix', xRouter) or app.use('/prefix', xRouter({ ... }))
        preg_match_all("/\bapp\.use\(\s*'([^']+)'\s*,\s*(\w+)\s*[,(\)]/", $app, $mounts, PREG_SET_ORDER);
        foreach ($mounts as $m) {
            [$prefix, $name] = [$m[1], $m[2]];
            if (! isset($files[$name])) {
                continue;   // a middleware or a handler, not a router file
            }
            $source = self::serverSource('routes/'.$files[$name]);
            preg_match_all("/\brouter\.(".implode('|', self::METHODS).")\(\s*'([^']+)'/", $source, $routes, PREG_SET_ORDER);
            foreach ($routes as $r) {
                $endpoints[] = [strtoupper($r[1]), rtrim($prefix, '/').($r[2] === '/' ? '' : $r[2])];
            }
            $independent += preg_match_all('/\brouter\.(?:'.implode('|', self::METHODS).')\(/', $source);
        }

        return [$endpoints, $independent];
    }

    /** The Laravel route other than the fallback that takes this path with this method, or null. */
    private function laravelRouteFor(string $method, string $path): ?string
    {
        try {
            $route = Route::getRoutes()->match(Request::create($path, $method));
        } catch (HttpException) {
            return null;    // no route at all (404) or not for this method (405)
        }

        return $route->getControllerClass() === NodeFallbackController::class
            ? null
            : implode('|', $route->methods()).' '.$route->uri();
    }

    public function test_node_serves_no_laravel_owned_path(): void
    {
        [$endpoints, $independent] = self::nodeEndpoints();

        $this->assertGreaterThan(0, count($endpoints), 'no Node endpoint parsed: the check would prove nothing');
        $this->assertSame($independent, count($endpoints), 'the endpoint parser missed route registrations');

        $twins = [];
        foreach ($endpoints as [$method, $path]) {
            // ':id', ':id(\\d+)' -> a digit, which satisfies the parameter constraints in use.
            $concrete = preg_replace('/:\w+(\([^)]*\))?/', '1', $path);
            foreach (['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as $laravelMethod) {
                $owner = $this->laravelRouteFor($laravelMethod, $concrete);
                if ($owner !== null) {
                    $twins[] = "Node {$method} {$path} = Laravel {$owner}";
                    break;
                }
            }
        }

        $this->assertSame([], $twins, count($endpoints).' Node endpoints checked; '.count($twins).' are Laravel paths');
    }
}
