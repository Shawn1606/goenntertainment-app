<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\OwnedRoutes;
use Illuminate\Http\Client\Request as ClientRequest;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Route;
use Tests\AppFeatureTestCase;

/**
 * Google sign-in is removed (F-03): Laravel has no route for it and calls Google for nothing,
 * and no answer carries `google_id` (the column stays, inert). Node's side:
 * server/test/google-sign-in-removed.test.js.
 *
 * Every outgoing HTTP call is faked; a call nobody faked fails the test.
 */
class GoogleSignInRemovedTest extends AppFeatureTestCase
{
    /** What Google would answer if anything still asked it: the profile of $user. */
    private function fakeGoogleProfileOf(User $user, array $more = []): void
    {
        Http::preventStrayRequests();
        Http::fake(array_merge([
            'www.googleapis.com/*' => Http::response(['sub' => 'fixture-google-sub-'.$user->id, 'email' => $user->email, 'name' => 'Fixture']),
        ], $more));
    }

    private function tokenCount(User $user): int
    {
        return DB::table('personal_access_tokens')
            ->where('tokenable_type', User::class)
            ->where('tokenable_id', $user->id)
            ->count();
    }

    public function test_laravel_does_not_serve_google_sign_in_and_forwards_nothing(): void
    {
        // Without a Node fallback Laravel answers every path itself.
        config(['services.node_fallback.url' => '']);
        $user = $this->makeUser();
        $this->fakeGoogleProfileOf($user);

        $this->postJson('/api/auth/google', ['access_token' => 'fake-not-a-token'])
            ->assertNotFound()
            ->assertExactJson(['message' => 'Nicht gefunden.']);

        Http::assertNothingSent();
        $this->assertSame(0, $this->tokenCount($user));
        $this->assertNull(DB::table('users')->where('id', $user->id)->value('google_id'));
    }

    public function test_with_the_node_fallback_on_the_answer_is_404_and_google_is_never_called(): void
    {
        // The deployed setup: what Laravel does not serve goes to Node, which has no such route
        // either (its 404 is faked here; the Node test checks the real one).
        config(['services.node_fallback.url' => 'http://node.test']);
        $user = $this->makeUser();
        $this->fakeGoogleProfileOf($user, [
            'node.test/*' => Http::response(['message' => 'Nicht gefunden.'], 404),
        ]);

        $this->postJson('/api/auth/google', ['access_token' => 'fake-not-a-token'])
            ->assertNotFound();

        Http::assertNotSent(fn (ClientRequest $request) => str_contains($request->url(), 'googleapis.com'));
        $this->assertSame(0, $this->tokenCount($user));
        $this->assertNull(DB::table('users')->where('id', $user->id)->value('google_id'));
    }

    /**
     * Every route except the Node fallback whose URI or controller names Google: a Google route
     * need not have 'google' in its path.
     *
     * The fallback is recognised the way App\Support\OwnedRoutes recognises it (by its name, or by
     * its controller class), and the test asserts that exactly that one route was left out, so the
     * exclusion cannot silently widen or stop matching.
     *
     * @return array{checked: int, skipped: int, google: list<string>}
     */
    private static function googleRoutes(): array
    {
        $checked = 0;
        $skipped = 0;
        $google = [];
        foreach (Route::getRoutes()->getRoutes() as $route) {
            if (OwnedRoutes::isFallback($route)) {
                $skipped++;

                continue;
            }
            $checked++;
            $names = strtolower($route->uri().' '.($route->getControllerClass() ?? '').' '.$route->getActionName());
            if (str_contains($names, 'google')) {
                $google[] = implode('|', $route->methods()).' '.$route->uri();
            }
        }

        return ['checked' => $checked, 'skipped' => $skipped, 'google' => $google];
    }

    public function test_the_route_table_has_no_google_route(): void
    {
        $routes = self::googleRoutes();

        $this->assertGreaterThan(0, $routes['checked']);
        $this->assertSame(1, $routes['skipped'], 'exactly one route, the Node fallback, is left out of the check');
        $this->assertSame([], $routes['google'], "{$routes['checked']} routes checked");
    }

    /** The check above fires: a Google route registered at runtime is found, by its URI or its controller. */
    public function test_the_route_check_finds_a_registered_google_route(): void
    {
        Route::post('/api/auth/google', fn () => response()->json([]));
        Route::post('/api/auth/provider', [GoogleProbeController::class, 'store']);

        $this->assertSame(
            ['POST api/auth/google', 'POST api/auth/provider'],
            self::googleRoutes()['google'],
        );
    }

    public function test_the_user_payload_never_contains_google_id(): void
    {
        // An account from before the removal still has the column set.
        $user = $this->makeUser(['google_id' => 'fixture-google-sub-legacy']);
        $this->assertNotNull(DB::table('users')->where('id', $user->id)->value('google_id'));

        $this->withBearer($this->issueToken($user))->getJson('/api/user')
            ->assertOk()
            ->assertJsonPath('user.id', $user->id)
            ->assertJsonMissingPath('user.google_id');

        $this->assertContains('google_id', $user->getHidden());
        $this->assertNotContains('google_id', $user->getFillable());
    }
}

/** A controller whose class name names Google; only used to prove that the route check fires. */
final class GoogleProbeController
{
    public function store(): array
    {
        return [];
    }
}
