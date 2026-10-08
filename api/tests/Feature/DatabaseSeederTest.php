<?php

namespace Tests\Feature;

use App\Models\User;
use Database\Seeders\DatabaseSeeder;
use RuntimeException;
use Tests\AppFeatureTestCase;

/**
 * The seeder makes a local test account with the factory's known password: never in production,
 * and with an address in example.invalid, which no mailbox will ever have (AGENTS.md: no personal
 * data or working credentials in fixtures).
 */
class DatabaseSeederTest extends AppFeatureTestCase
{
    private const ADDRESS = 'test-user@example.invalid';

    public function test_the_seeder_refuses_to_run_in_production(): void
    {
        $this->app['env'] = 'production';
        try {
            (new DatabaseSeeder)->run();
            $this->fail('the seeder ran in production');
        } catch (RuntimeException) {
            $this->assertFalse(User::where('email', self::ADDRESS)->exists());
        } finally {
            $this->app['env'] = 'testing';
        }
    }

    public function test_the_local_test_account_has_an_invalid_address(): void
    {
        (new DatabaseSeeder)->run();

        $this->assertTrue(User::where('email', self::ADDRESS)->exists());
        $this->assertFalse(User::where('email', 'test@example.com')->exists());
    }
}
