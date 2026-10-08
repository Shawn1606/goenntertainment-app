<?php

namespace Tests\Unit;

use PHPUnit\Framework\TestCase;
use Tests\AppFeatureTestCase;

/**
 * The deploy keeps Laravel's rate-limit counters in the database: a file cache
 * inside the api container loses increments under concurrent requests and starts from zero when
 * the container is recreated, so a per-account cap on it would not hold. The scheduler's job
 * locks live there too. The tables come from the migrations, which build the deploy's schema
 * (api runs them at start), and from server/schema.sql, which the database feature tests load.
 *
 * Plain PHPUnit: the files are read as text. tests/Feature/CacheStoreTest.php checks the store at
 * runtime.
 */
class DeployCacheStoreTest extends TestCase
{
    private static function repoFile(string $path): string
    {
        $file = dirname(__DIR__, 3).'/'.$path;
        self::assertFileExists($file);

        return (string) file_get_contents($file);
    }

    public function test_the_production_compose_runs_laravel_with_the_database_cache_store(): void
    {
        $compose = self::repoFile('deploy/docker-compose.yml');

        // api (the rate limits) and the scheduler (the job locks); a service that leaves it out
        // gets the default, the database (the last test).
        preg_match_all('/^\s*CACHE_STORE:\s*(\S+)\s*$/m', $compose, $m);
        $this->assertSame(['database', 'database'], $m[1], 'deploy/docker-compose.yml sets CACHE_STORE for api and the scheduler, to database, and to nothing else anywhere');
    }

    public function test_the_migrations_create_the_cache_tables(): void
    {
        $migrations = '';
        foreach (glob(dirname(__DIR__, 2).'/database/migrations/*.php') ?: [] as $file) {
            $migrations .= (string) file_get_contents($file);
        }

        // As patterns, not the call itself: this file holds no DDL for scripts/schema-drift to find.
        $this->assertMatchesRegularExpression('/Schema::create\(\'cache\',/', $migrations);
        $this->assertMatchesRegularExpression('/Schema::create\(\'cache_locks\',/', $migrations);
    }

    public function test_schema_sql_declares_the_cache_tables(): void
    {
        // The table list as the database feature tests read it from server/schema.sql.
        $tables = AppFeatureTestCase::schemaTables();

        $this->assertNotSame([], $tables);
        $this->assertContains('cache', $tables);
        $this->assertContains('cache_locks', $tables);
    }

    public function test_the_default_store_without_configuration_is_the_database(): void
    {
        $this->assertMatchesRegularExpression(
            "/'default'\s*=>\s*env\('CACHE_STORE',\s*'database'\)/",
            self::repoFile('api/config/cache.php'),
        );
    }
}
