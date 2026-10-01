<?php

namespace Tests\Unit;

use PHPUnit\Framework\TestCase;

/**
 * composer.json against composer.lock: the PHP floor and the production package set.
 *
 * Plain PHPUnit (no framework boot): both files are read as JSON from the api/ folder.
 */
class ComposerManifestTest extends TestCase
{
    private static function json(string $file): array
    {
        $data = json_decode((string) file_get_contents(dirname(__DIR__, 2).'/'.$file), true);
        self::assertIsArray($data, "{$file} is not valid JSON");

        return $data;
    }

    /** "8.4.1" -> [8, 4, 1]; missing parts count as 0. */
    private static function version(string $major, ?string $minor, ?string $patch): array
    {
        return [(int) $major, (int) ($minor ?? 0), (int) ($patch ?? 0)];
    }

    /**
     * Lowest PHP version [major, minor, patch] a constraint admits, or null when it has no lower
     * bound. Knows the forms Composer uses in this lock: ^, ~, >=, >, =, bare versions, "A - B"
     * ranges, "," / space for AND, and | or || for OR. Anything else fails the test instead of being
     * guessed.
     */
    private static function floor(string $constraint): ?array
    {
        $number = 'v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:\.\d+)*';
        $lowest = null;
        foreach (preg_split('/\s*\|\|?\s*/', trim($constraint)) as $alternative) {
            $alternative = trim($alternative);
            $bound = null;
            if (preg_match("/^{$number}\\s+-\\s+\\S+$/", $alternative, $m) === 1) {
                $bound = self::version($m[1], $m[2] ?? null, $m[3] ?? null);
            } else {
                foreach (preg_split('/\s*,\s*|\s+/', $alternative) as $part) {
                    if ($part === '' || $part === '*') {
                        continue;
                    }
                    if (preg_match("/^(?:\\^|~|>=|>|=)?{$number}$/", $part, $m) === 1) {
                        $version = self::version($m[1], $m[2] ?? null, $m[3] ?? null);
                    } elseif (preg_match('/^(?:<|<=|!=)/', $part) === 1) {
                        continue; // upper bounds and exclusions do not raise the floor
                    } else {
                        self::fail("unknown constraint syntax: {$constraint}");
                    }
                    $bound = $bound === null || $version > $bound ? $version : $bound;
                }
            }
            if ($bound === null) {
                return null;
            }
            $lowest = $lowest === null || $bound < $lowest ? $bound : $lowest;
        }

        return $lowest;
    }

    public function test_php_floor_in_composer_json_covers_what_the_locked_packages_need(): void
    {
        $manifest = self::floor(self::json('composer.json')['require']['php'] ?? '');
        $this->assertNotNull($manifest, 'composer.json must require a PHP version');

        $lock = self::json('composer.lock');
        $packages = array_merge($lock['packages'], $lock['packages-dev']);
        $this->assertGreaterThan(0, count($packages), 'composer.lock lists no packages');

        $needed = [0, 0, 0];
        $examined = 0;
        foreach ($packages as $package) {
            $php = $package['require']['php'] ?? null;
            if ($php === null) {
                continue;
            }
            $examined++;
            $floor = self::floor($php);
            if ($floor !== null && $floor > $needed) {
                $needed = $floor;
            }
        }
        $this->assertGreaterThan(0, $examined, 'no locked package states a PHP requirement');

        // Compared on major.minor: the constraint is "^8.4" as decided, while some locked packages
        // need 8.4.1; Composer's platform check enforces that patch level at runtime.
        $this->assertGreaterThanOrEqual(
            array_slice($needed, 0, 2),
            array_slice($manifest, 0, 2),
            sprintf('composer.json allows PHP %d.%d.%d, the locked packages need %d.%d.%d', ...$manifest, ...$needed),
        );
    }

    public function test_the_floor_reader_knows_the_constraint_forms_of_the_lock(): void
    {
        $this->assertSame([8, 4, 0], self::floor('^8.4'));
        $this->assertSame([8, 4, 1], self::floor('>=8.4.1'));
        $this->assertSame([8, 1, 0], self::floor('8.1 - 8.5'));
        $this->assertSame([7, 2, 5], self::floor('^7.2.5 || ^8.0'));
        $this->assertSame([7, 4, 0], self::floor('^7.4|^8.0'));
        $this->assertSame([8, 0, 0], self::floor('>=8.0, <9.0'));
        $this->assertNull(self::floor('<9.0'));

        $this->expectException(\PHPUnit\Framework\AssertionFailedError::class);
        self::floor('dev-main as 8.4');
    }

    public function test_lock_platform_matches_the_manifest(): void
    {
        $this->assertSame(
            self::json('composer.json')['require']['php'] ?? null,
            self::json('composer.lock')['platform']['php'] ?? null,
        );
    }

    public function test_tinker_is_a_dev_dependency(): void
    {
        $manifest = self::json('composer.json');
        $this->assertArrayNotHasKey('laravel/tinker', $manifest['require']);
        $this->assertArrayHasKey('laravel/tinker', $manifest['require-dev']);

        $lock = self::json('composer.lock');
        $production = array_column($lock['packages'], 'name');
        $development = array_column($lock['packages-dev'], 'name');
        $this->assertGreaterThan(0, count($production));
        foreach (['laravel/tinker', 'psy/psysh'] as $name) {
            $this->assertNotContains($name, $production, "{$name} is installed in production");
            $this->assertContains($name, $development, "{$name} is missing from the dev packages");
        }
    }
}
