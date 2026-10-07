<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\BlockedTerms;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Tests\AppFeatureTestCase;

/**
 * GET and PATCH /api/user: the own account.
 *
 * Both belong to Laravel; Node's copies are deleted (F-01, one owner per path). These tests were
 * Node tests of those copies and moved here with the same assertions: server/test/account.test.js
 * (2FA fields), server/test/api.test.js (tiers, image addresses) and
 * server/test/blocked-terms-routes.test.js (word filter).
 */
class UserProfileTest extends AppFeatureTestCase
{
    private function patchUser(string $token, array $body): TestResponse
    {
        return $this->withBearer($token)->patchJson('/api/user', $body);
    }

    /** An admin account (is_admin is never mass-assignable) and its token. */
    private function admin(): array
    {
        $user = $this->makeUser();
        $user->forceFill(['is_admin' => true])->save();

        return [$user, $this->issueToken($user)];
    }

    public function test_user_payload_exposes_only_the_two_factor_method(): void
    {
        $user = $this->makeUser();
        DB::table('users')->where('id', $user->id)->update([
            'two_factor_method' => 'totp',
            'two_factor_secret' => 'verschluesselt',
            'two_factor_recovery_codes' => 'codes',
            'two_factor_confirmed_at' => DB::raw('NOW()'),
            'two_factor_last_step' => 1,
        ]);

        $response = $this->withBearer($this->issueToken($user))->getJson('/api/user')
            ->assertOk()
            ->assertJsonPath('user.two_factor_method', 'totp');

        foreach (['two_factor_secret', 'two_factor_recovery_codes', 'two_factor_confirmed_at', 'two_factor_last_step', 'password'] as $key) {
            $this->assertArrayNotHasKey($key, $response->json('user'), "{$key} must not be in the answer");
        }
    }

    public function test_admin_switches_tier_and_back(): void
    {
        [, $token] = $this->admin();

        $this->patchUser($token, ['account_type' => 'business'])
            ->assertOk()
            ->assertJsonPath('user.account_type', 'business');

        $this->patchUser($token, ['account_type' => 'standard'])
            ->assertOk()
            ->assertJsonPath('user.account_type', 'standard');
    }

    public function test_admin_reaches_all_four_tiers(): void
    {
        [, $token] = $this->admin();

        foreach (['standard', 'creator', 'business', 'business_plus'] as $type) {
            $this->patchUser($token, ['account_type' => $type])
                ->assertOk()
                ->assertJsonPath('user.account_type', $type);
        }
    }

    public function test_legacy_personal_is_stored_as_standard(): void
    {
        // Older app versions still send 'personal'; that must not fail.
        [, $token] = $this->admin();

        $this->patchUser($token, ['account_type' => 'personal'])
            ->assertOk()
            ->assertJsonPath('user.account_type', 'standard');
    }

    public function test_non_admin_cannot_change_tier(): void
    {
        $user = $this->makeUser(['account_type' => 'standard']);
        $token = $this->issueToken($user);

        $this->patchUser($token, ['account_type' => 'business'])->assertForbidden();

        $this->withBearer($token)->getJson('/api/user')
            ->assertOk()
            ->assertJsonPath('user.account_type', 'standard');
    }

    public function test_unknown_tier_is_rejected(): void
    {
        [, $token] = $this->admin();

        $response = $this->patchUser($token, ['account_type' => 'enterprise'])->assertStatus(422);
        $this->assertNotEmpty($response->json('errors.account_type'), 'field error for account_type expected');
    }

    public function test_other_fields_stay_editable_for_everyone(): void
    {
        $token = $this->issueToken($this->makeUser(['account_type' => 'creator']));

        $this->patchUser($token, ['name' => 'Neuer Name'])
            ->assertOk()
            ->assertJsonPath('user.name', 'Neuer Name');
    }

    public function test_user_payload_has_avatar_and_banner_urls(): void
    {
        $user = $this->makeUser(['account_type' => 'creator']);
        DB::table('users')->where('id', $user->id)->update([
            'avatar' => 'avatars/fixture-avatar.png',
            'banner' => 'user-banners/fixture-banner.png',
        ]);

        $response = $this->withBearer($this->issueToken($user))->getJson('/api/user')->assertOk();

        $this->assertMatchesRegularExpression('#/storage/avatars/#', (string) $response->json('user.avatar'));
        $this->assertMatchesRegularExpression('#/storage/user-banners/#', (string) $response->json('user.banner'));
    }

    public function test_new_blocked_value_is_rejected_old_value_blocks_nothing(): void
    {
        $terms = BlockedTerms::default();
        $user = $this->makeUser();
        $token = $this->issueToken($user);

        $this->patchUser($token, ['username' => 'sieg_heil'])
            ->assertStatus(422)
            ->assertJsonPath('message', $terms->message('username'))
            ->assertJsonPath('errors.username', [$terms->message('username')]);

        $this->patchUser($token, ['name' => 'Du Fotze'])
            ->assertStatus(422)
            ->assertJsonPath('message', $terms->message('name'))
            ->assertJsonPath('errors.name', [$terms->message('name')]);

        // An old name the list would catch today stays when other fields are saved; otherwise
        // not even the interests could be changed any more.
        User::whereKey($user->id)->update(['name' => 'Schlampe']);
        $this->patchUser($token, ['name' => 'Schlampe', 'interests' => []])->assertOk();
    }
}
