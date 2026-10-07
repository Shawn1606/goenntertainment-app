<?php

namespace Tests\Feature;

use App\Support\ReservedAccounts;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\AppFeatureTestCase;

/**
 * Nobody can register or take the usernames and the e-mail domain the system creates accounts
 * with (F-05, shared/reserved-accounts.json): otherwise someone could register the admin's name
 * or a host's address before the seed runs and be adopted by it. Node's half (admin rename, list
 * completeness): server/test/reserved-accounts.test.js and admin-rename-reserved.test.js.
 */
class ReservedAccountsTest extends AppFeatureTestCase
{
    private const MSG_USERNAME = 'Dieser Benutzername ist reserviert – bitte wähle einen anderen.';

    private const MSG_EMAIL = 'Diese E-Mail-Adresse kann nicht verwendet werden.';

    /** The reserved usernames (test_the_list_is_the_shared_file keeps it equal to the file). */
    private const RESERVED = ['admin', 'bowling-goettingen', 'house-of-jumpers', 'freibad-goettingen', 'noergelbuff'];

    /** Every reserved username, plus spellings in other cases. */
    public static function reservedUsernames(): array
    {
        $rows = [];
        foreach ([...self::RESERVED, 'ADMIN', 'Noergelbuff'] as $name) {
            $rows[$name] = [$name];
        }

        return $rows;
    }

    public function test_the_list_is_the_shared_file(): void
    {
        $file = json_decode((string) file_get_contents(dirname(__DIR__, 3).'/shared/reserved-accounts.json'), true);

        $this->assertSame(self::RESERVED, $file['usernames'] ?? null);
        $this->assertSame(['goenntertainment.local'], $file['email_domains'] ?? null);
    }

    /** @return array<string, mixed> a sign-up body that is valid apart from what the test sets */
    private static function signUp(array $overrides = []): array
    {
        $username = self::freeUsername('signup');

        return array_merge([
            'name' => 'Feature Test',
            'username' => $username,
            'email' => $username.'@example.invalid',
            'password' => self::TEST_PASSWORD,
            'account_type' => 'standard',
        ], $overrides);
    }

    #[DataProvider('reservedUsernames')]
    public function test_sign_up_refuses_a_reserved_username(string $username): void
    {
        // The slot is free: the refusal is about the name, not about an existing account.
        DB::table('users')->whereRaw('LOWER(username) = ?', [strtolower($username)])->delete();

        $this->postJson('/api/register', self::signUp(['username' => $username]))
            ->assertStatus(422)
            ->assertJsonPath('errors.username.0', self::MSG_USERNAME);

        $this->assertFalse(DB::table('users')->whereRaw('LOWER(username) = ?', [strtolower($username)])->exists());
    }

    public function test_sign_up_refuses_the_system_email_domain(): void
    {
        foreach (['someone@goenntertainment.local', 'Someone@GOENNTERTAINMENT.LOCAL', 'x@import.goenntertainment.local'] as $email) {
            $this->postJson('/api/register', self::signUp(['email' => $email]))
                ->assertStatus(422)
                ->assertJsonPath('errors.email.0', self::MSG_EMAIL);
        }
    }

    /**
     * Spellings of the system domain that look different but that users.email treats as the same
     * address (it ignores accents and width and expands œ to oe). The seed and the import find
     * their accounts with a plain `email = ?`, so such an address would be adopted as the system
     * account.
     *
     * @return array<string, array{string, string}> the variant and the plain address it equals
     */
    public static function collationVariants(): array
    {
        return [
            'precomposed accent' => ["someone@goenntertainment.loc\u{00E1}l", 'someone@goenntertainment.local'],
            'combining accent' => ["someone@goenntertainment.loca\u{0301}l", 'someone@goenntertainment.local'],
            'full-width letter' => ["someone@goenntertainment.\u{FF4C}ocal", 'someone@goenntertainment.local'],
            'oe ligature' => ["someone@g\u{0153}nntertainment.local", 'someone@goenntertainment.local'],
            'accent below a subdomain' => ["someone@import.GOENNTERTAINMENT.LOC\u{00C1}L", 'someone@import.goenntertainment.local'],
            'zero-width space' => ["someone@goenn\u{200B}tertainment.local", 'someone@goenntertainment.local'],
            'full-width dot before the domain' => ["someone@import\u{FF0E}goenntertainment.local", 'someone@import.goenntertainment.local'],
        ];
    }

    /** The database itself compares the variant equal to the plain address: the case is real. */
    private function assertTheDatabaseTreatsThemAsEqual(string $variant, string $plain): void
    {
        $same = DB::selectOne('SELECT CONVERT(? USING utf8mb4) COLLATE utf8mb4_unicode_ci = ? AS same', [$variant, $plain]);
        $this->assertSame(1, (int) $same->same, "the database tells {$variant} apart from {$plain}");
    }

    #[DataProvider('collationVariants')]
    public function test_sign_up_refuses_spellings_the_database_treats_as_the_system_domain(string $email, string $plain): void
    {
        $this->assertTheDatabaseTreatsThemAsEqual($email, $plain);

        $this->postJson('/api/register', self::signUp(['email' => $email]))
            ->assertStatus(422)
            ->assertJsonPath('errors.email.0', self::MSG_EMAIL);

        $this->assertFalse(DB::table('users')->where('email', $email)->exists());
    }

    public function test_addresses_the_database_tells_apart_from_the_system_domain_are_accepted(): void
    {
        // The last one: a letter outside ASCII right before the domain is no dot to the database.
        foreach (['notgoenntertainment.local', 'goenntertainment.local.example.invalid', 'goenntertainment.locale', "x\u{00E1}goenntertainment.local"] as $domain) {
            $email = self::freeUsername('lookalike').'@'.$domain;

            $this->postJson('/api/register', self::signUp(['email' => $email]))->assertCreated();
        }
    }

    /** The collation the check compares under is the one of users.email (named mirror). */
    public function test_the_check_compares_under_the_collation_of_users_email(): void
    {
        $column = DB::selectOne(
            "SELECT collation_name AS name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'email'",
        );

        $this->assertSame(ReservedAccounts::EMAIL_COLLATION, $column->name);
    }

    public function test_profile_change_refuses_a_reserved_username(): void
    {
        DB::table('users')->whereRaw('LOWER(username) = ?', ['admin'])->delete();
        $user = $this->makeUser();

        $this->withBearer($this->issueToken($user))
            ->patchJson('/api/user', ['username' => 'Admin'])
            ->assertStatus(422)
            ->assertJsonPath('errors.username.0', self::MSG_USERNAME);

        $this->assertSame($user->username, DB::table('users')->where('id', $user->id)->value('username'));
    }

    public function test_an_account_that_has_a_reserved_username_keeps_it(): void
    {
        DB::table('users')->whereRaw('LOWER(username) = ?', ['admin'])->delete();
        $admin = $this->makeUser(['username' => 'admin', 'email' => 'seeded-admin@example.invalid']);

        // The profile screen sends the unchanged username with every save.
        $this->withBearer($this->issueToken($admin))
            ->patchJson('/api/user', ['username' => 'admin', 'name' => 'Admin'])
            ->assertOk()
            ->assertJsonPath('user.username', 'admin');
    }

    public function test_ordinary_names_are_not_affected(): void
    {
        $this->postJson('/api/register', self::signUp(['username' => self::freeUsername('administrator')]))
            ->assertCreated();
    }
}
