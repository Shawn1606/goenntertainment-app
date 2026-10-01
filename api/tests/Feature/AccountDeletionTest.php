<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Support\Facades\Http;
use Tests\AppFeatureTestCase;

/**
 * DELETE /api/me: Laravel checks (password or confirmation word, last admin, 2FA code), Node
 * deletes (server/src/account-deletion.js holds the file paths).
 *
 * The checks were also tested on Node's copy of the route (server/test/account.test.js); that
 * copy is deleted (F-01, one owner per path), and those tests moved here with the same
 * assertions. Node is faked: a call nobody faked fails the test.
 */
class AccountDeletionTest extends AppFeatureTestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        config(['services.node_fallback.url' => 'http://node.test']);
        Http::preventStrayRequests();
        Http::fake(['node.test/*' => Http::response(['message' => 'Dein Konto wurde gelöscht.'], 200)]);
    }

    public function test_delete_me_requires_the_password(): void
    {
        $user = $this->makeUser();
        $token = $this->issueToken($user);

        $this->withBearer($token)->deleteJson('/api/me', [])
            ->assertStatus(422)
            ->assertJsonPath('message', 'Bitte gib dein Passwort ein.');

        $this->withBearer($token)->deleteJson('/api/me', ['password' => 'falsch12345'])
            ->assertStatus(422)
            ->assertJsonPath('errors.password', ['Das Passwort stimmt nicht.']);

        $this->assertTrue(User::whereKey($user->id)->exists());
        Http::assertNothingSent();
    }

    public function test_passwordless_account_confirms_with_the_word(): void
    {
        $user = $this->makeUser(['password' => null]);
        $token = $this->issueToken($user);

        $missing = $this->withBearer($token)->deleteJson('/api/me', [])->assertStatus(422);
        $this->assertNotEmpty($missing->json('errors.confirm'));

        $this->withBearer($token)->deleteJson('/api/me', ['confirm' => 'ja'])->assertStatus(422);
        Http::assertNothingSent();

        // Case, spaces and the spelling without umlaut do not matter; then Node deletes.
        $this->withBearer($token)->deleteJson('/api/me', ['confirm' => ' löschen '])
            ->assertOk()
            ->assertJsonPath('message', 'Dein Konto wurde gelöscht.');
        Http::assertSentCount(1);
    }
}
