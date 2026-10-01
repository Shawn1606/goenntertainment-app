<?php

namespace Tests\Feature;

use App\Mail\TwoFactorCode;
use App\Models\User;
use Carbon\CarbonImmutable;
use DateTimeImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Testing\TestResponse;
use Tests\AppFeatureTestCase;

/**
 * Access tokens expire (F-20): Sanctum has a lifetime (30 days unless SANCTUM_EXPIRATION says
 * otherwise), every route that issues a token writes its expiry date, and a token that is too
 * old, past its date or has no date at all is refused. Node applies the same expiry rule
 * (server/test/token-expiry.test.js).
 */
class TokenLifetimeTest extends AppFeatureTestCase
{
    /** The newest token row of $user. */
    private function latestToken(User $user): object
    {
        return DB::table('personal_access_tokens')
            ->where('tokenable_type', User::class)
            ->where('tokenable_id', $user->id)
            ->orderByDesc('id')
            ->first();
    }

    private function assertExpiresAfterTheLifetime(TestResponse $response, User $user): void
    {
        $response->assertSuccessful()->assertJsonStructure(['token']);
        $row = $this->latestToken($user);

        $this->assertNotNull($row->expires_at, 'the token has no expiry date');
        $expected = CarbonImmutable::now()->addMinutes((int) config('sanctum.expiration'));
        $this->assertLessThanOrEqual(120, abs(CarbonImmutable::parse($row->expires_at)->diffInSeconds($expected)));
    }

    public function test_the_token_lifetime_is_configured(): void
    {
        $minutes = config('sanctum.expiration');

        $this->assertIsInt($minutes);
        $this->assertSame(43200, $minutes, 'default: 30 days');
    }

    public function test_sign_up_issues_a_token_with_an_expiry_date(): void
    {
        $username = self::freeUsername('expiry');
        $response = $this->postJson('/api/register', [
            'name' => 'Feature Test',
            'username' => $username,
            'email' => $username.'@example.invalid',
            'password' => self::TEST_PASSWORD,
            'account_type' => 'standard',
        ]);

        $this->assertExpiresAfterTheLifetime($response, User::where('username', $username)->firstOrFail());
    }

    public function test_sign_in_issues_a_token_with_an_expiry_date(): void
    {
        $user = $this->makeUser();

        $response = $this->postJson('/api/login', ['email' => $user->email, 'password' => self::TEST_PASSWORD]);

        $this->assertExpiresAfterTheLifetime($response, $user);
    }

    public function test_two_factor_sign_in_issues_a_token_with_an_expiry_date(): void
    {
        Mail::fake();
        $user = $this->makeUser(['two_factor_method' => 'email']);

        $challenge = $this->postJson('/api/login', ['email' => $user->email, 'password' => self::TEST_PASSWORD])
            ->assertOk()
            ->json('two_factor.challenge');
        $code = Mail::sent(TwoFactorCode::class)->last()->code;

        $response = $this->postJson('/api/login/two-factor', ['challenge' => $challenge, 'code' => $code]);

        $this->assertExpiresAfterTheLifetime($response, $user);
    }

    public function test_a_valid_token_works(): void
    {
        $this->withBearer($this->issueToken($this->makeUser()))->getJson('/api/user')->assertOk();
    }

    public function test_a_token_without_an_expiry_date_is_refused(): void
    {
        $this->withBearer($this->issueToken($this->makeUser(), null))->getJson('/api/user')->assertUnauthorized();
    }

    public function test_a_token_past_its_expiry_date_is_refused(): void
    {
        $token = $this->issueToken($this->makeUser(), new DateTimeImmutable('-1 minute'));

        $this->withBearer($token)->getJson('/api/user')->assertUnauthorized();
    }

    public function test_a_token_older_than_the_lifetime_is_refused_even_with_a_later_date(): void
    {
        $user = $this->makeUser();
        $token = $this->issueToken($user, new DateTimeImmutable('+1 day'));
        DB::table('personal_access_tokens')->where('id', (int) strtok($token, '|'))->update([
            'created_at' => CarbonImmutable::now()->subMinutes((int) (config('sanctum.expiration') ?? 43200) + 1),
        ]);

        $this->withBearer($token)->getJson('/api/user')->assertUnauthorized();
    }
}
