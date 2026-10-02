<?php

namespace Tests\Unit;

use PHPUnit\Framework\TestCase;
use RecursiveDirectoryIterator;
use RecursiveIteratorIterator;

/**
 * The password reset works by a mailed code kept in two_factor_challenges (F-09), so
 * password_reset_tokens is no longer used. The table stays in the five schema copies (dropping it
 * is a backlog item, F-33), but no code in either backend writes a row into it: no INSERT,
 * UPDATE or REPLACE, and no query-builder insert or update. Deleting old rows (Node's account
 * deletion) is allowed.
 *
 * Plain PHPUnit: it reads the source files of api/app, api/routes and server/src.
 */
class PasswordResetTokensUnusedTest extends TestCase
{
    /** @return list<string> */
    private static function sourceFiles(): array
    {
        $root = dirname(__DIR__, 3);
        $files = [];
        foreach (['api/app' => 'php', 'api/routes' => 'php', 'server/src' => 'js'] as $dir => $extension) {
            $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root.'/'.$dir, RecursiveDirectoryIterator::SKIP_DOTS));
            foreach ($iterator as $file) {
                if ($file->isFile() && $file->getExtension() === $extension) {
                    $files[] = $file->getPathname();
                }
            }
        }

        return $files;
    }

    public function test_no_code_writes_to_password_reset_tokens(): void
    {
        $writes = [
            '/\b(?:INSERT\s+(?:IGNORE\s+)?INTO|UPDATE|REPLACE\s+INTO)\s+`?password_reset_tokens\b/i',
            "/table\\(\\s*['\"]password_reset_tokens['\"]\\s*\\)\\s*->\\s*(?:insert\\w*|update\\w*|upsert)\\s*\\(/i",
        ];

        $files = self::sourceFiles();
        $offenders = [];
        foreach ($files as $file) {
            $text = (string) file_get_contents($file);
            foreach ($writes as $pattern) {
                if (preg_match($pattern, $text) === 1) {
                    $offenders[] = substr($file, strlen(dirname(__DIR__, 3)) + 1);
                }
            }
        }

        // Denominator: both backends were read.
        $this->assertGreaterThan(80, count($files), 'only '.count($files).' source files found');
        $this->assertSame([], $offenders, count($files).' files scanned');
    }
}
