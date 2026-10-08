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
 * (2FA fields), server/test/api.test.js (image addresses) and
 * server/test/blocked-terms-routes.test.js (word filter). The account tiers and the profile banner
 * are gone with the marketplace.
 */
class UserProfileTest extends AppFeatureTestCase
{
    private function patchUser(string $token, array $body): TestResponse
    {
        return $this->withBearer($token)->patchJson('/api/user', $body);
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

    /**
     * The profile update takes name, username and interests only: what grants rights or is worth
     * money (admin flag, club plan, credits) is never set by the account itself.
     */
    public function test_the_profile_update_cannot_change_admin_plan_or_credits(): void
    {
        $user = $this->makeUser();
        $token = $this->issueToken($user);

        $this->patchUser($token, [
            'name' => 'Selbst Erhoben',
            'is_admin' => true,
            'club_plan' => 'platinum',
            'credits_balance' => 999999,
            'club_renews_at' => '2099-01-01 00:00:00',
        ])->assertOk()->assertJsonPath('user.name', 'Selbst Erhoben');

        $row = DB::table('users')->where('id', $user->id)->first();
        $this->assertSame(0, (int) $row->is_admin);
        $this->assertSame('free', $row->club_plan);
        $this->assertSame(0, (int) $row->credits_balance);
        $this->assertNull($row->club_renews_at);
    }

    public function test_other_fields_stay_editable_for_everyone(): void
    {
        $token = $this->issueToken($this->makeUser(['account_type' => 'creator']));

        $this->patchUser($token, ['name' => 'Neuer Name'])
            ->assertOk()
            ->assertJsonPath('user.name', 'Neuer Name');
    }

    /** The profile banner is gone with the old profile screens: the payload carries the avatar only. */
    public function test_user_payload_has_the_avatar_url_and_no_banner(): void
    {
        $user = $this->makeUser();
        DB::table('users')->where('id', $user->id)->update([
            'avatar' => 'avatars/fixture-avatar.png',
            'banner' => 'user-banners/fixture-banner.png',
        ]);

        $response = $this->withBearer($this->issueToken($user))->getJson('/api/user')->assertOk();

        $this->assertMatchesRegularExpression('#/storage/avatars/#', (string) $response->json('user.avatar'));
        $this->assertArrayNotHasKey('banner', $response->json('user'));
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
