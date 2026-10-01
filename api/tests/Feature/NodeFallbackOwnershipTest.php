<?php

namespace Tests\Feature;

use App\Http\Controllers\NodeFallbackController;
use Illuminate\Contracts\Http\Kernel as HttpKernel;
use Illuminate\Http\Client\Request as ClientRequest;
use Illuminate\Http\Request;
use Illuminate\Routing\Route as LaravelRoute;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Route;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\DataProvider;
use Symfony\Component\HttpFoundation\Request as SymfonyRequest;
use Tests\AppFeatureTestCase;

/**
 * One owner per path (F-01): the Node fallback never forwards a request whose normalised path is
 * a path Laravel owns, for any method and in any spelling; it forwards the normalised path only.
 *
 * Node is faked (node.test); a call nobody faked fails the test. Requests are sent with their
 * path exactly as written (raw()): Laravel's test helpers would trim a trailing slash.
 *
 * Some spellings never reach the fallback: Laravel itself routes '/api/login/', an encoded slash
 * and a lower-case percent-encoding to its own controller, and '/API/LOGIN' to no route at all.
 * They are kept as regression guards: what matters is that nothing reaches Node.
 */
class NodeFallbackOwnershipTest extends AppFeatureTestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        config(['services.node_fallback.url' => 'http://node.test']);
        Http::preventStrayRequests();
    }

    /** Node answers every path with an empty list (a test that needs another answer fakes its own). */
    private function fakeNode(): void
    {
        Http::fake(['node.test/*' => Http::response(['data' => []], 200)]);
    }

    /** Sends a request with exactly this path (and query), JSON body $body. */
    private function raw(string $method, string $pathAndQuery, array $headers = [], string $body = '{}'): TestResponse
    {
        $server = ['CONTENT_TYPE' => 'application/json', 'HTTP_ACCEPT' => 'application/json'];
        foreach ($headers as $name => $value) {
            $server['HTTP_'.strtoupper(str_replace('-', '_', $name))] = $value;
        }
        $request = Request::createFromBase(
            SymfonyRequest::create('http://localhost'.$pathAndQuery, $method, [], [], [], $server, $body),
        );
        $this->app['auth']->forgetGuards();
        $kernel = $this->app->make(HttpKernel::class);
        $response = $kernel->handle($request);
        $kernel->terminate($request, $response);

        return TestResponse::fromBaseResponse($response, $request);
    }

    private function assertNotForwarded(TestResponse $response, string $label): void
    {
        $this->assertSame([], Http::recorded()->all(), "{$label}: reached Node");
        $this->assertFalse($response->headers->has('X-Goenn-Backend'), "{$label}: marked as answered by Node");
    }

    /** [path, true when the fallback answers it; false when Laravel's router does (regression guard)] */
    public static function loginSpellings(): array
    {
        return [
            'mixed case' => ['/api/Login', true],
            'upper case' => ['/API/LOGIN', false],
            'double slash' => ['/api//login', true],
            'trailing slash' => ['/api/login/', false],
            'dot segment' => ['/api/./login', true],
            'dot-dot segment' => ['/api/x/../login', true],
            'single-encoded, upper-case letter' => ['/api/%4Cogin', true],
            'single-encoded, lower-case letter' => ['/api/%6Cogin', false],
            'double-encoded letter' => ['/api/%254Cogin', true],
            'triple-encoded letter' => ['/api/%25254Cogin', true],
            'double-encoded dot segment' => ['/api/%252e/login', true],
            'encoded slash' => ['/api%2Flogin', false],
            'encoded trailing slash' => ['/api/login%2F', true],
            'encoded backslash' => ['/api/%5Clogin', true],
        ];
    }

    #[DataProvider('loginSpellings')]
    public function test_login_spellings_never_reach_node(string $path, bool $viaFallback): void
    {
        $this->fakeNode();
        $response = $this->raw('POST', $path);

        $this->assertNotForwarded($response, $path);
        if ($viaFallback) {
            $response->assertNotFound()->assertExactJson(['message' => 'Nicht gefunden.']);
        }
    }

    public function test_node_owned_path_still_forwards(): void
    {
        $this->fakeNode();
        $response = $this->raw('GET', '/api/activities?limit=5', ['Authorization' => 'Bearer fixture-token-not-a-secret']);

        $response->assertOk()->assertExactJson(['data' => []]);
        $this->assertSame('node-fallback', $response->headers->get('X-Goenn-Backend'));
        Http::assertSentCount(1);
        Http::assertSent(fn (ClientRequest $request) => $request->method() === 'GET'
            && $request->url() === 'http://node.test/api/activities?limit=5'
            && $request->header('Authorization') === ['Bearer fixture-token-not-a-secret']);
    }

    public function test_forwarded_path_is_the_normalised_path(): void
    {
        $this->fakeNode();
        $this->raw('GET', '/api//Activities/./History/')->assertOk();

        Http::assertSentCount(1);
        Http::assertSent(fn (ClientRequest $request) => $request->url() === 'http://node.test/api/activities/history');
    }

    public function test_paths_escaping_api_are_never_forwarded(): void
    {
        $this->fakeNode();
        foreach ([
            ['GET', '/api/../internal/health'],
            ['DELETE', '/api/%2e%2e/internal/accounts/1'],
            ['DELETE', '/api/%252e%252e/internal/accounts/1'],
            ['GET', '/api/x/../../up'],
        ] as [$method, $path]) {
            $response = $this->raw($method, $path);
            $this->assertNotForwarded($response, $path);
            $response->assertNotFound();
        }
    }

    public function test_refused_paths_are_never_forwarded(): void
    {
        $this->fakeNode();
        // Laravel itself answers a path that is not UTF-8 with 400 before any route runs; its
        // debug error page is slow to build for such a path, and production has no debug page.
        config(['app.debug' => false]);
        foreach ([
            '/api/activities%00' => 404,
            '/api/%'.str_repeat('25', 8).'41ctivities' => 404,
            '/api/activ%C3%28ities' => 400,
        ] as $path => $status) {
            $response = $this->raw('GET', $path);
            $this->assertNotForwarded($response, $path);
            $response->assertStatus($status);
        }
    }

    public function test_exact_owned_path_with_another_method_is_405(): void
    {
        $this->fakeNode();
        $response = $this->raw('GET', '/api/login');

        $this->assertNotForwarded($response, 'GET /api/login');
        $response->assertStatus(405)->assertJsonPath('message', 'Diese Methode ist hier nicht erlaubt.');
        $this->assertSame('POST', $response->headers->get('Allow'));
    }

    public function test_upstream_redirects_are_not_followed(): void
    {
        $options = [];
        Http::fake(function (ClientRequest $request, array $requestOptions) use (&$options) {
            $options[] = $requestOptions;

            return Http::response('', 302, ['Location' => 'http://node.test/api/elsewhere']);
        });

        $response = $this->raw('GET', '/api/activities');

        $response->assertStatus(302)->assertHeader('Location', 'http://node.test/api/elsewhere');
        $this->assertCount(1, $options);
        $this->assertFalse($options[0]['allow_redirects'] ?? true, 'the fallback must not follow redirects');
    }

    public function test_owned_route_with_parameters_is_never_forwarded(): void
    {
        // A route that exists only in this test, registered after the fallback, with a parameter
        // and a constraint: the owned set comes from the live route table, not from a list.
        Route::get('api/_owned/{id}', fn () => response()->json(['owner' => 'laravel']))->where('id', '[0-9]+');
        $this->fakeNode();

        foreach (['/api/_OWNED/12', '/api/_owned//12/', '/api/_owned/%312', '/api/_owned/12'] as $path) {
            $response = $this->raw('GET', $path);
            $this->assertNotForwarded($response, $path);
            $response->assertNotFound();
        }

        $post = $this->raw('POST', '/api/_owned/12');
        $this->assertNotForwarded($post, 'POST /api/_owned/12');
        $post->assertStatus(405);
        $this->assertSame('GET, HEAD', $post->headers->get('Allow'));

        // The constraint is part of the match: a non-numeric id is not Laravel's path.
        $this->raw('GET', '/api/_owned/abc')->assertOk();
        Http::assertSent(fn (ClientRequest $request) => $request->url() === 'http://node.test/api/_owned/abc');
    }

    /**
     * Every owned /api route of the live route table, in twelve spellings each, plus its exact path
     * with a method Laravel does not serve there: nothing reaches Node.
     */
    public function test_every_owned_route_refuses_every_spelling(): void
    {
        $routes = array_values(array_filter(
            Route::getRoutes()->getRoutes(),
            fn (LaravelRoute $route) => $route->getControllerClass() !== NodeFallbackController::class
                && str_starts_with($route->uri(), 'api/'),
        ));
        $this->assertGreaterThan(0, count($routes), 'no owned /api route found: the check would prove nothing');

        $this->fakeNode();
        $allMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
        $checked = 0;
        $leaks = [];
        foreach ($routes as $route) {
            $path = '/'.preg_replace('/\{[^}]+\}/', '1', $route->uri());
            $method = array_values(array_diff($route->methods(), ['HEAD']))[0];
            $served = $this->methodsServedAt($path);
            $other = array_values(array_diff($allMethods, $served))[0];

            $requests = array_map(fn (string $p) => [$method, $p], self::spellingsOf($path));
            $requests[] = [$other, $path];

            foreach ($requests as [$m, $p]) {
                $before = count(Http::recorded()->all());
                $response = $this->raw($m, $p);
                $checked++;
                if (count(Http::recorded()->all()) !== $before || $response->headers->has('X-Goenn-Backend')) {
                    $leaks[] = "{$m} {$p}";
                }
            }
        }

        $this->assertSame(count($routes) * 13, $checked);
        $this->assertSame([], $leaks, "checked {$checked} requests over ".count($routes).' owned routes');
    }

    /** Twelve other spellings of an owned path. */
    private static function spellingsOf(string $path): array
    {
        $segments = explode('/', ltrim($path, '/'));
        $last = array_pop($segments);
        $parent = '/'.implode('/', $segments);
        $first = $last[0];
        $rest = substr($last, 1);
        $hexUpper = sprintf('%%%02X', ord(strtoupper($first)));
        $hexLower = sprintf('%%%02X', ord(strtolower($first)));

        return [
            strtoupper($path),
            $parent.'/'.ucfirst($last),
            '/api//'.substr($path, strlen('/api/')),
            $parent.'//'.$last,
            $path.'/',
            '/api/.'.substr($path, strlen('/api')),
            '/api/x/..'.substr($path, strlen('/api')),
            $parent.'/'.$hexUpper.$rest,
            $parent.'/'.$hexLower.$rest,
            $parent.'/%25'.substr($hexUpper, 1).$rest,
            $parent.'%5C'.$last,
            $path.'%2F',
        ];
    }

    /** Every method Laravel serves on this exact path (all owned routes, any of them). */
    private function methodsServedAt(string $path): array
    {
        $methods = [];
        foreach (Route::getRoutes()->getRoutes() as $route) {
            if ($route->getControllerClass() === NodeFallbackController::class) {
                continue;
            }
            if ('/'.preg_replace('/\{[^}]+\}/', '1', $route->uri()) === $path) {
                $methods = array_merge($methods, $route->methods());
            }
        }

        return $methods;
    }
}
