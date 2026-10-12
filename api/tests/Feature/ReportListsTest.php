<?php

namespace Tests\Feature;

use App\Http\Controllers\SafetyController;
use Tests\TestCase;

/**
 * App and API know the same report reasons and the same report targets.
 *
 * The keys belong to the API (SafetyController::REASONS, ::TARGETS), the words to the app
 * (src/domain/report-reason.ts). A key the app offers but the API does not know ends in a 422,
 * and only when the report is sent; one the API knows but the app does not shows up in the admin
 * list without a word. The app's lists are read from its source, so no TypeScript runs here.
 */
class ReportListsTest extends TestCase
{
    private function appSource(): string
    {
        $file = dirname(base_path()).'/src/domain/report-reason.ts';
        $this->assertFileExists($file);

        return (string) file_get_contents($file);
    }

    public function test_app_und_api_kennen_dieselben_gruende(): void
    {
        // Without an anchor at the line start: an entry on one line does not begin with `key:`.
        preg_match_all("/\\bkey: '([^']+)'/", $this->appSource(), $matches);
        $app = $matches[1];
        sort($app);
        $api = SafetyController::REASONS;
        sort($api);

        $this->assertSame($api, $app);
    }

    public function test_app_und_api_kennen_dieselben_ziele(): void
    {
        $this->assertSame(1, preg_match('/export const REPORT_TARGETS = \[([^\]]*)\]/', $this->appSource(), $block), 'the app has no REPORT_TARGETS');
        preg_match_all("/'([^']+)'/", $block[1], $matches);
        $app = $matches[1];
        sort($app);
        $api = SafetyController::TARGETS;
        sort($api);

        $this->assertSame($api, $app);
    }
}
