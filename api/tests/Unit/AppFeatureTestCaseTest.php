<?php

namespace Tests\Unit;

use PHPUnit\Framework\TestCase;
use Tests\AppFeatureTestCase;
use Tests\Probes\ProbeRun;

/**
 * Database feature tests (tests/AppFeatureTestCase.php) need MySQL loaded from server/schema.sql.
 * Without it they must FAIL, never skip: a skipped suite is green and tests nothing.
 *
 * No database here: the probe runs in a child process configured for sqlite in memory.
 * tests/Feature/AppSchemaGuardTest.php covers MySQL without the app schema.
 */
class AppFeatureTestCaseTest extends TestCase
{
    public function test_without_mysql_a_database_feature_test_fails_and_is_not_skipped(): void
    {
        [$code, $output] = ProbeRun::appSchemaProbe(['DB_CONNECTION' => 'sqlite', 'DB_DATABASE' => ':memory:']);

        $this->assertSame(1, $code, $output);
        $this->assertMatchesRegularExpression('/^Tests: 1, Assertions: \d+, Failures: 1\.$/m', $output);
        $this->assertStringNotContainsString('Skipped', $output);
        $this->assertStringContainsString("The test database connection uses the 'sqlite' driver, not 'mysql'.", $output);
        $this->assertStringContainsString(AppFeatureTestCase::HOW_TO_RUN, $output);
    }

    public function test_the_required_tables_are_read_from_server_schema_sql(): void
    {
        $sql = (string) file_get_contents(dirname(__DIR__, 3).'/server/schema.sql');
        // Denominator: one table per statement that opens a table definition in the file.
        $statements = preg_match_all('/^CREATE\s+TABLE\b/mi', $sql);
        $tables = AppFeatureTestCase::schemaTables();

        $this->assertGreaterThan(0, $statements);
        $this->assertCount($statements, $tables);
        $this->assertContains('users', $tables);
        $this->assertContains('personal_access_tokens', $tables);
    }

    public function test_the_fixture_password_mirrors_the_server_tests(): void
    {
        $fixtures = (string) file_get_contents(dirname(__DIR__, 3).'/server/test/support/fixtures.js');
        $this->assertSame(1, preg_match("/^export const TEST_PASSWORD = '([^']+)';\\r?$/m", $fixtures, $m), 'TEST_PASSWORD not found in server/test/support/fixtures.js');
        $this->assertSame($m[1], AppFeatureTestCase::TEST_PASSWORD);
    }

    public function test_unit_tests_do_not_boot_the_application(): void
    {
        // The Unit suite runs without any database; a test that needs Laravel or the database
        // belongs in tests/Feature and extends AppFeatureTestCase when it touches the database.
        $files = glob(__DIR__.'/*.php');
        $this->assertNotEmpty($files);
        $booting = [];
        foreach ($files as $file) {
            $text = (string) file_get_contents($file);
            $plainPhpunit = str_contains($text, 'use PHPUnit\Framework\TestCase;')
                && preg_match('/^(?:final\s+)?class\s+\w+\s+extends\s+TestCase\b/m', $text) === 1;
            if (! $plainPhpunit) {
                $booting[] = basename($file);
            }
        }
        $this->assertSame([], $booting, count($files).' unit test files checked');
    }

    public function test_no_test_rebuilds_or_empties_the_database(): void
    {
        // These traits would run the stock migrations over, or empty, the MySQL test database
        // that server/schema.sql filled; database tests use AppFeatureTestCase's transactions.
        // An import or a trait `use` line (comments and prose that name them do not count).
        $traits = '/^\s*use\s+(?:[\w\\\\]+\\\\)?(RefreshDatabase|LazilyRefreshDatabase|DatabaseMigrations|DatabaseTruncation)\b/m';
        $files = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator(dirname(__DIR__), \FilesystemIterator::SKIP_DOTS));
        $checked = 0;
        $found = [];
        foreach ($files as $file) {
            if ($file->getExtension() !== 'php' || $file->getRealPath() === __FILE__) {
                continue;
            }
            $checked++;
            if (preg_match($traits, (string) file_get_contents($file->getPathname()), $m) === 1) {
                $found[] = $file->getFilename().': '.$m[1];
            }
        }
        $this->assertGreaterThan(1, $checked);
        $this->assertSame([], $found, "{$checked} test files checked");
    }
}
