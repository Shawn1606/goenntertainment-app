<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Tests\AppFeatureTestCase;

/**
 * F-14: a sign-up is recorded on the server with the confirmation that the person is at least the
 * minimum age and accepted the current terms version, each with a timestamp, and a sign-up without
 * that confirmation is refused. Both values come from shared/legal.json (App\Support\Legal).
 * Before, the age was only a checkbox in the app, and the server stored whatever terms version it
 * was sent, or none.
 *
 * The test reads shared/legal.json itself (the file the server reads), so a sign-up that leaves out
 * one confirmation sends the other with its current value.
 */
class RegisterConsentTest extends AppFeatureTestCase
{
    private const MSG_TERMS = 'Bitte stimme den aktuellen Nutzungsbedingungen zu.';

    /** shared/legal.json, or [] when it does not exist. */
    private static function legal(): array
    {
        $path = dirname(__DIR__, 3).'/shared/legal.json';
        $data = is_readable($path) ? json_decode((string) file_get_contents($path), true) : null;

        return is_array($data) ? $data : [];
    }

    private static function ageMessage(): string
    {
        return 'Bitte bestätige, dass du mindestens '.(self::legal()['min_age'] ?? '?').' Jahre alt bist.';
    }

    /**
     * A sign-up with the current consent values; $overrides replace a field, null leaves it out.
     * Returns the username and the response.
     */
    private function register(array $overrides = []): array
    {
        $username = self::freeUsername('consent');
        $legal = self::legal();
        $data = array_merge([
            'name' => 'Feature Test',
            'username' => $username,
            'email' => $username.'@example.invalid',
            'password' => self::TEST_PASSWORD,
            'terms_version' => $legal['terms_version'] ?? null,
            'confirmed_min_age' => $legal['min_age'] ?? null,
        ], $overrides);

        return [$username, $this->postJson('/api/register', array_filter($data, fn ($value) => $value !== null))];
    }

    private function assertRefused(TestResponse $response, string $username, string $field, string $message): void
    {
        $this->assertSame(422, $response->status(), "a sign-up without a valid {$field} was accepted");
        $response->assertJsonPath("errors.{$field}.0", $message);
        $this->assertFalse(DB::table('users')->where('username', $username)->exists(), 'the account was created');
    }

    public function test_a_sign_up_without_the_age_confirmation_is_refused(): void
    {
        [$username, $response] = $this->register(['confirmed_min_age' => null]);
        $this->assertRefused($response, $username, 'confirmed_min_age', self::ageMessage());
    }

    public function test_a_sign_up_with_another_minimum_age_is_refused(): void
    {
        foreach ([15, 'ja', true] as $age) {
            [$username, $response] = $this->register(['confirmed_min_age' => $age]);
            $this->assertRefused($response, $username, 'confirmed_min_age', self::ageMessage());
        }
    }

    public function test_a_sign_up_without_the_terms_version_is_refused(): void
    {
        [$username, $response] = $this->register(['terms_version' => null]);
        $this->assertRefused($response, $username, 'terms_version', self::MSG_TERMS);
    }

    public function test_a_sign_up_with_an_outdated_terms_version_is_refused(): void
    {
        foreach (['2020-01-01', 'ci', ['2026-09-29']] as $version) {
            [$username, $response] = $this->register(['terms_version' => $version]);
            $this->assertRefused($response, $username, 'terms_version', self::MSG_TERMS);
        }
    }

    public function test_the_consent_errors_come_after_the_errors_of_the_other_fields(): void
    {
        // The app shows the first message; an existing failure keeps its own message first.
        [, $response] = $this->register(['password' => 'nurbuchstaben', 'terms_version' => null, 'confirmed_min_age' => null]);
        $response->assertStatus(422)->assertJsonPath('message', 'Das Passwort muss mindestens 8 Zeichen mit Buchstaben und Zahlen haben.');
    }

    public function test_a_sign_up_records_the_terms_version_and_the_minimum_age_with_timestamps(): void
    {
        $legal = self::legal();
        $this->assertNotSame([], $legal, 'shared/legal.json is missing');

        [$username, $response] = $this->register();
        $response->assertCreated();

        $user = User::where('username', $username)->firstOrFail();
        $this->assertSame($legal['terms_version'], $user->terms_version);
        $this->assertSame($legal['min_age'], $user->min_age_confirmed);
        $this->assertNotNull($user->terms_accepted_at);
        $this->assertNotNull($user->min_age_confirmed_at);
    }
}
