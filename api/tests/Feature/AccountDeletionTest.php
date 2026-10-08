<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Tests\AppFeatureTestCase;

/**
 * DELETE /api/me: Laravel checks (password or confirmation word, last admin, 2FA code) and deletes
 * (App\Support\AccountDeletion, the same deletion the admin area uses). No other backend is
 * called: every outgoing HTTP request fails the test.
 *
 * The checks were also tested on Node's copy of the route (server/test/account.test.js); that
 * copy is deleted (F-01, one owner per path), and those tests moved here with the same
 * assertions. The deletion's own rules come from server/src/account-deletion.js and its tests.
 */
class AccountDeletionTest extends AppFeatureTestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        Http::preventStrayRequests();
        Storage::fake('public');
        Storage::fake('private');
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
        $this->assertTrue(User::whereKey($user->id)->exists());

        // Case, spaces and the spelling without umlaut do not matter; then the account is gone.
        $this->withBearer($token)->deleteJson('/api/me', ['confirm' => ' löschen '])
            ->assertOk()
            ->assertJsonPath('message', 'Dein Konto wurde gelöscht.');
        $this->assertFalse(User::whereKey($user->id)->exists());
        Http::assertNothingSent();
    }

    public function test_delete_me_deletes_the_account_and_only_its_own_tokens(): void
    {
        $user = $this->makeUser();
        $other = $this->makeUser();
        $token = $this->issueToken($user);
        $this->issueToken($user);
        $this->issueToken($other);
        DB::table('password_reset_tokens')->insert(['email' => $user->email, 'token' => 'fixture-not-a-secret', 'created_at' => now()]);

        $this->withBearer($token)->deleteJson('/api/me', ['password' => self::TEST_PASSWORD])
            ->assertOk()
            ->assertJsonPath('message', 'Dein Konto wurde gelöscht.');

        $this->assertFalse(User::whereKey($user->id)->exists());
        $this->assertSame(0, DB::table('personal_access_tokens')->where('tokenable_id', $user->id)->count());
        $this->assertSame(0, DB::table('password_reset_tokens')->where('email', $user->email)->count());
        $this->assertSame(1, DB::table('personal_access_tokens')->where('tokenable_id', $other->id)->count());
        $this->assertTrue(User::whereKey($other->id)->exists());
        Http::assertNothingSent();
    }

    public function test_delete_me_refuses_the_last_admin(): void
    {
        // Other admins in the test database would make this account not the last one.
        User::where('is_admin', true)->update(['is_admin' => false]);
        $admin = $this->makeUser(['is_admin' => true]);

        $this->withBearer($this->issueToken($admin))->deleteJson('/api/me', ['password' => self::TEST_PASSWORD])
            ->assertStatus(409)
            ->assertJsonPath('message', 'Du bist der letzte Admin – ernenne erst jemand anderen, bevor du dein Konto löschst.');

        $this->assertTrue(User::whereKey($admin->id)->exists());
    }

    /**
     * MySQL 8.4: an account with its own events and their history is deleted (its events first,
     * see App\Support\AccountDeletion), and a participant's history keeps the event's title and
     * loses only the picture.
     */
    public function test_an_account_with_own_events_and_history_is_deleted(): void
    {
        $host = $this->makeUser();
        $guest = $this->makeUser();
        $banner = 'banners/'.str_repeat('ab', 20).'.jpg';
        Storage::disk('public')->put($banner, 'fixture');

        $event = DB::table('activities')->insertGetId([
            'user_id' => $host->id, 'title' => 'Fixture event', 'description' => 'Fixture', 'location' => 'Fixture place',
            'starts_at' => now()->addDay(), 'banner_path' => $banner, 'created_at' => now(), 'updated_at' => now(),
        ]);
        foreach ([[$host->id, 'host'], [$guest->id, 'participant']] as [$userId, $role]) {
            DB::table('activity_history')->insert([
                'user_id' => $userId, 'activity_id' => $event, 'role' => $role, 'title' => 'Fixture event',
                'location' => 'Fixture place', 'starts_at' => now()->addDay(), 'banner_path' => $banner,
                'created_at' => now(), 'updated_at' => now(),
            ]);
        }

        $this->withBearer($this->issueToken($host))->deleteJson('/api/me', ['password' => self::TEST_PASSWORD])->assertOk();

        $this->assertFalse(User::whereKey($host->id)->exists());
        $this->assertFalse(DB::table('activities')->where('id', $event)->exists());
        $kept = DB::table('activity_history')->where('user_id', $guest->id)->first();
        $this->assertNotNull($kept, "the participant's history row stays");
        $this->assertSame('Fixture event', $kept->title);
        $this->assertNull($kept->activity_id);
        $this->assertNull($kept->banner_path);
        $this->assertNotNull($kept->removed_at);
        Storage::disk('public')->assertMissing($banner);
    }

    public function test_the_moderation_log_and_every_own_file_go_with_the_account(): void
    {
        $user = $this->makeUser();
        $admin = $this->makeUser(['is_admin' => true]);
        $avatar = 'avatars/'.str_repeat('a1', 20).'.jpg';
        $evidence = 'evidence/'.str_repeat('e2', 20).'.png';
        $shared = 'avatars/'.str_repeat('c3', 20).'.webp';
        Storage::disk('public')->put($avatar, 'fixture');
        Storage::disk('public')->put($shared, 'fixture');
        Storage::disk('private')->put($evidence, 'fixture');
        $user->forceFill(['avatar' => $avatar, 'banner' => $shared])->save();
        // Another account still shows the shared file: it stays.
        $admin->forceFill(['avatar' => $shared])->save();
        DB::table('ban_evidence')->insert([
            'user_id' => $user->id, 'admin_id' => $admin->id, 'source' => 'admin', 'action' => 'timeout',
            'reason' => 'Fixture reason', 'image_path' => $evidence, 'created_at' => now(),
        ]);
        DB::table('moderation_reports')->insert([
            'user_id' => $user->id, 'context' => 'activity', 'verdict' => 'block', 'severity' => 2,
            'action' => 'block', 'body' => 'Fixture text', 'image_path' => $evidence, 'created_at' => now(),
        ]);

        $this->withBearer($this->issueToken($user))->deleteJson('/api/me', ['password' => self::TEST_PASSWORD])->assertOk();

        $this->assertSame(0, DB::table('moderation_reports')->where('body', 'Fixture text')->count());
        $this->assertSame(0, DB::table('ban_evidence')->where('user_id', $user->id)->count());
        Storage::disk('public')->assertMissing($avatar);
        Storage::disk('private')->assertMissing($evidence);
        Storage::disk('public')->assertExists($shared);
    }
}
