<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\AdminAccount;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Tests\AppFeatureTestCase;

/**
 * `php artisan admin:create` (App\Support\AdminAccount): the first admin account, which the
 * deploy's admin gate waits for before the public edge starts (F-05). The same rules as Node's
 * seed:admin (server/test/seed.test.js), which the deploy no longer runs: it only creates, it
 * refuses an address or the username "admin" that exists, and its output names no address and no
 * password (F-18). ADMIN_EMAIL and ADMIN_PASSWORD come from the process environment.
 */
class AdminCreateTest extends AppFeatureTestCase
{
    private const EMAIL = 'first-admin@example.test';

    private const PASSWORD = 'Seed-Owner-Fixture-8642';

    protected function setUp(): void
    {
        parent::setUp();
        // The slot the command fills, empty in this test's transaction.
        DB::table('users')->where('username', AdminAccount::USERNAME)->orWhere('email', self::EMAIL)->delete();
    }

    protected function tearDown(): void
    {
        putenv('ADMIN_EMAIL');
        putenv('ADMIN_PASSWORD');
        parent::tearDown();
    }

    /** Runs the command with the two values in its environment; returns [exit code, output]. */
    private function create(?string $email, ?string $password): array
    {
        putenv($email === null ? 'ADMIN_EMAIL' : "ADMIN_EMAIL={$email}");
        putenv($password === null ? 'ADMIN_PASSWORD' : "ADMIN_PASSWORD={$password}");
        $code = $this->withoutMockingConsoleOutput()->artisan('admin:create');

        return [$code, \Illuminate\Support\Facades\Artisan::output()];
    }

    public function test_it_creates_the_admin_on_an_empty_slot(): void
    {
        [$code, $output] = $this->create(self::EMAIL, self::PASSWORD);

        $this->assertSame(0, $code, $output);
        $this->assertStringContainsString(AdminAccount::MSG_CREATED, $output);
        $admin = User::where('email', self::EMAIL)->firstOrFail();
        $this->assertTrue((bool) $admin->is_admin);
        $this->assertSame(AdminAccount::USERNAME, $admin->username);
        $this->assertTrue(Hash::check(self::PASSWORD, $admin->password));
        $this->assertNotSame(self::PASSWORD, $admin->password);
    }

    public function test_it_signs_in_like_any_account(): void
    {
        $this->create(self::EMAIL, self::PASSWORD);

        $this->postJson('/api/login', ['email' => self::EMAIL, 'password' => self::PASSWORD])
            ->assertOk()
            ->assertJsonPath('user.is_admin', true);
    }

    public function test_an_existing_address_or_username_is_refused_and_nothing_changes(): void
    {
        $owner = $this->makeUser(['email' => self::EMAIL]);
        $before = $owner->fresh()->only(['password', 'is_admin', 'username', 'name']);

        [$code, $output] = $this->create(self::EMAIL, self::PASSWORD);

        $this->assertSame(1, $code);
        $this->assertStringContainsString(AdminAccount::MSG_REFUSED, $output);
        $this->assertSame($before, $owner->fresh()->only(['password', 'is_admin', 'username', 'name']));

        // The username "admin" taken by someone else: refused as well, and no second account.
        $owner->delete();
        $squatter = $this->makeUser();
        DB::table('users')->where('id', $squatter->id)->update(['username' => AdminAccount::USERNAME]);
        [$code] = $this->create(self::EMAIL, self::PASSWORD);
        $this->assertSame(1, $code);
        $this->assertFalse(User::where('email', self::EMAIL)->exists());
        $this->assertFalse((bool) $squatter->fresh()->is_admin);
    }

    public function test_a_second_run_never_adopts_or_resets_the_first(): void
    {
        $this->create(self::EMAIL, self::PASSWORD);
        $hash = User::where('email', self::EMAIL)->value('password');

        [$code] = $this->create(self::EMAIL, 'Another-Fixture-Pass-9753');

        $this->assertSame(1, $code);
        $this->assertSame($hash, User::where('email', self::EMAIL)->value('password'));
        $this->assertSame(1, User::where('username', AdminAccount::USERNAME)->count());
    }

    public function test_missing_or_invalid_values_create_nothing(): void
    {
        $cases = [
            'no address' => [null, self::PASSWORD, 'ADMIN_EMAIL must be set'],
            'no password' => [self::EMAIL, null, 'ADMIN_PASSWORD must be set'],
            'empty both' => ['', '', 'ADMIN_EMAIL and ADMIN_PASSWORD must be set'],
            'not an address' => ['not-an-address', self::PASSWORD, 'ADMIN_EMAIL is not a valid e-mail address'],
            'weak password' => [self::EMAIL, 'password1', 'ADMIN_PASSWORD does not meet the password rules'],
            'password with the username' => [self::EMAIL, 'Myadmin-Pass-2468', 'ADMIN_PASSWORD does not meet the password rules'],
        ];
        foreach ($cases as $label => [$email, $password, $expected]) {
            [$code, $output] = $this->create($email, $password);
            $this->assertSame(1, $code, $label);
            $this->assertStringContainsString($expected, $output, $label);
            $this->assertFalse(User::where('username', AdminAccount::USERNAME)->exists(), "{$label}: an account was created");
        }
    }

    public function test_the_output_names_neither_the_address_nor_the_password(): void
    {
        $outputs = [];
        [, $outputs[]] = $this->create(self::EMAIL, self::PASSWORD);
        [, $outputs[]] = $this->create(self::EMAIL, self::PASSWORD);
        [, $outputs[]] = $this->create(self::EMAIL, 'short1');

        foreach ($outputs as $output) {
            $this->assertNotSame('', trim($output));
            $this->assertStringNotContainsString(self::EMAIL, $output);
            $this->assertStringNotContainsString(self::PASSWORD, $output);
            $this->assertStringNotContainsString('short1', $output);
        }
    }
}
