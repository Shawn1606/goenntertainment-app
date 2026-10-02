<?php

namespace Tests\Unit;

use PHPUnit\Framework\TestCase;
use Tests\AppFeatureTestCase;

/**
 * The deploy keeps Laravel's rate-limit counters in the database: a file cache
 * inside the api container loses increments under concurrent requests and starts from zero when
 * the container is recreated, so a per-account cap on it would not hold. The tables come from
 * server/schema.sql, the one schema the deploy loads (Laravel migrations never run there).
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

        preg_match_all('/^\s*CACHE_STORE:\s*(\S+)\s*$/m', $compose, $m);
        $this->assertSame(['database'], $m[1], 'deploy/docker-compose.yml sets CACHE_STORE exactly once, to database');
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
