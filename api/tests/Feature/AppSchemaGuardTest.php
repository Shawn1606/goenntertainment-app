<?php

namespace Tests\Feature;

use Tests\AppFeatureTestCase;
use Tests\Probes\ProbeRun;

/**
 * MySQL is there, but the database lacks the app schema: every database feature test must still
 * fail, never skip. The positive control shows the probe passes on the configured test database,
 * so the failure above comes from the missing schema and not from the child process.
 * (tests/Unit/AppFeatureTestCaseTest.php covers the case without MySQL.)
 */
class AppSchemaGuardTest extends AppFeatureTestCase
{
    public function test_mysql_without_the_app_schema_fails_and_is_not_skipped(): void
    {
        // information_schema is readable by every MySQL account and holds none of the app tables.
        [$code, $output] = ProbeRun::appSchemaProbe(['DB_DATABASE' => 'information_schema']);

        $tables = count(self::schemaTables());
        $this->assertSame(1, $code, $output);
        $this->assertMatchesRegularExpression('/^Tests: 1, Assertions: \d+, Failures: 1\.$/m', $output);
        $this->assertStringNotContainsString('Skipped', $output);
        $this->assertStringContainsString(
            "{$tables} of the {$tables} tables in server/schema.sql are missing in database \"information_schema\"",
            $output,
        );
    }

    public function test_the_probe_passes_on_the_configured_test_database(): void
    {
        [$code, $output] = ProbeRun::appSchemaProbe([]);

        $this->assertSame(0, $code, $output);
        $this->assertMatchesRegularExpression('/^OK \(1 test, 1 assertion\)$/m', $output);
    }
}
