<?php

namespace Tests\Feature;

use App\Models\User;
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
        // Laravel answers every path itself; there is no fallback to another backend.
        $user = $this->makeUser();
        $this->fakeGoogleProfileOf($user);

        $this->postJson('/api/auth/google', ['access_token' => 'fake-not-a-token'])
            ->assertNotFound()
            ->assertExactJson(['message' => 'Nicht gefunden.']);

        Http::assertNothingSent();
        $this->assertSame(0, $this->tokenCount($user));
        $this->assertNull(DB::table('users')->where('id', $user->id)->value('google_id'));
    }

    /**
     * Every route whose URI or controller names Google: a Google route need not have 'google' in
     * its path. Every route is checked; none is left out (there is no fallback route any more).
     *
     * @return array{checked: int, google: list<string>}
     */
    private static function googleRoutes(): array
    {
        $checked = 0;
        $google = [];
        foreach (Route::getRoutes()->getRoutes() as $route) {
            $checked++;
            $names = strtolower($route->uri().' '.($route->getControllerClass() ?? '').' '.$route->getActionName());
            if (str_contains($names, 'google')) {
                $google[] = implode('|', $route->methods()).' '.$route->uri();
            }
        }

        return ['checked' => $checked, 'google' => $google];
    }

    public function test_the_route_table_has_no_google_route(): void
    {
        $routes = self::googleRoutes();

        $this->assertGreaterThan(0, $routes['checked']);
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
