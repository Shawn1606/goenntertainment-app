<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Http\Client\Request as ClientRequest;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\AppFeatureTestCase;

/**
 * DELETE /api/me: Laravel checks (password or confirmation word, last admin, 2FA code), Node
 * deletes (server/src/account-deletion.js holds the file paths). Laravel calls Node's internal
 * route DELETE /internal/accounts/{id} with the shared secret and a one-time grant
 * (App\Support\NodeInternal); Node's side: server/test/account-deletion.test.js.
 *
 * The checks were also tested on Node's copy of the route (server/test/account.test.js); that
 * copy is deleted (F-01, one owner per path), and those tests moved here with the same
 * assertions. Node is faked: a call nobody faked fails the test.
 */
class AccountDeletionTest extends AppFeatureTestCase
{
    /** Test-only shared secret (32+ characters). */
    private const SECRET = 'test-only-internal-secret-not-a-secret-0000';

    protected function setUp(): void
    {
        parent::setUp();
        config([
            'services.node_fallback.url' => 'http://node.test',
            'services.node_fallback.internal_secret' => self::SECRET,
        ]);
        Http::preventStrayRequests();
    }

    private function fakeNode(int $status = 200, array $body = ['message' => 'Dein Konto wurde gelöscht.']): void
    {
        Http::fake(['node.test/*' => Http::response($body, $status)]);
    }

    public function test_delete_me_requires_the_password(): void
    {
        $this->fakeNode();
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
        $this->fakeNode();
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

    public function test_delete_me_calls_the_node_internal_route_with_secret_and_grant(): void
    {
        $this->fakeNode();
        $user = $this->makeUser();

        $this->withBearer($this->issueToken($user))->deleteJson('/api/me', ['password' => self::TEST_PASSWORD])
            ->assertOk()
            ->assertJsonPath('message', 'Dein Konto wurde gelöscht.');

        Http::assertSentCount(1);
        Http::assertSent(function (ClientRequest $request) use ($user) {
            $grant = $request->header('X-Account-Deletion-Grant')[0] ?? '';
            $grantRow = DB::table('two_factor_challenges')
                ->where('user_id', $user->id)
                ->where('purpose', 'delete')
                ->where('token_hash', hash('sha256', $grant))
                ->exists();

            return $request->method() === 'DELETE'
                && $request->url() === 'http://node.test/internal/accounts/'.$user->id
                && $request->header('X-Internal-Secret') === [self::SECRET]
                && $grant !== '' && $grantRow
                // Laravel's own call carries no user token: the secret and the grant are the proof.
                && ! $request->hasHeader('Authorization');
        });
        Http::assertNotSent(fn (ClientRequest $request) => str_contains($request->url(), '/api/'));
    }

    public function test_delete_me_fails_closed_without_internal_secret_or_node_address(): void
    {
        $this->fakeNode();
        $user = $this->makeUser();
        $token = $this->issueToken($user);

        $settings = [
            'no secret' => ['services.node_fallback.internal_secret' => ''],
            'too short a secret' => ['services.node_fallback.internal_secret' => substr(self::SECRET, 0, 31)],
            'no Node address' => ['services.node_fallback.url' => ''],
        ];
        foreach ($settings as $case => $setting) {
            config(['services.node_fallback.url' => 'http://node.test', 'services.node_fallback.internal_secret' => self::SECRET]);
            config($setting);

            $this->withBearer($token)->deleteJson('/api/me', ['password' => self::TEST_PASSWORD])
                ->assertStatus(503)
                ->assertJsonPath('message', 'Serverfehler.');
            $this->assertTrue(User::whereKey($user->id)->exists(), $case);
        }

        Http::assertNothingSent();
    }

    public function test_delete_me_passes_node_answers_through(): void
    {
        $user = $this->makeUser();
        $token = $this->issueToken($user);

        $answers = [
            409 => 'Du bist der letzte Admin – ernenne erst jemand anderen, bevor du dein Konto löschst.',
            403 => 'Die Bestätigung ist abgelaufen – bitte versuch es noch einmal.',
        ];
        $sequence = Http::sequence();
        foreach ($answers as $status => $message) {
            $sequence->push(['message' => $message], $status);
        }
        Http::fake(['node.test/*' => $sequence]);

        foreach ($answers as $status => $message) {
            $this->withBearer($token)->deleteJson('/api/me', ['password' => self::TEST_PASSWORD])
                ->assertStatus($status)
                ->assertJsonPath('message', $message);
        }
    }

    public function test_the_public_fallback_never_passes_the_internal_headers_on(): void
    {
        $this->fakeNode(200, ['data' => []]);

        $this->withHeaders([
            'X-Internal-Secret' => self::SECRET,
            'X-Account-Deletion-Grant' => 'fixture-grant-not-a-secret',
        ])->getJson('/api/activities')->assertOk();

        Http::assertSentCount(1);
        Http::assertSent(fn (ClientRequest $request) => ! $request->hasHeader('X-Internal-Secret')
            && ! $request->hasHeader('X-Account-Deletion-Grant'));
    }
}
