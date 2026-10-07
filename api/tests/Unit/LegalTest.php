<?php

namespace Tests\Unit;

use App\Support\Legal;
use PHPUnit\Framework\TestCase;
use RuntimeException;

/**
 * App\Support\Legal reads shared/legal.json (F-14) and fails closed: without a readable, valid file
 * no sign-up is accepted, instead of one with a default version or age.
 */
class LegalTest extends TestCase
{
    /** @var list<string> */
    private array $files = [];

    protected function tearDown(): void
    {
        foreach ($this->files as $file) {
            @unlink($file);
        }
        parent::tearDown();
    }

    private function file(string $content): string
    {
        $path = tempnam(sys_get_temp_dir(), 'legal');
        file_put_contents($path, $content);
        $this->files[] = $path;

        return $path;
    }

    public function test_the_shared_file_has_a_dated_terms_version_and_a_minimum_age(): void
    {
        $legal = Legal::fromFile(Legal::defaultPath());

        $this->assertMatchesRegularExpression('/^\d{4}-\d{2}-\d{2}$/', $legal->version());
        $this->assertGreaterThan(0, $legal->age());
        $this->assertSame($legal->version(), Legal::termsVersion());
        $this->assertSame($legal->age(), Legal::minAge());
    }

    public function test_a_missing_or_invalid_file_is_refused(): void
    {
        $cases = [
            'missing' => sys_get_temp_dir().'/legal-does-not-exist-'.bin2hex(random_bytes(4)).'.json',
            'not json' => $this->file('terms'),
            'no version' => $this->file('{"min_age": 16}'),
            'version not a date' => $this->file('{"terms_version": "v2", "min_age": 16}'),
            'age as text' => $this->file('{"terms_version": "2026-09-29", "min_age": "16"}'),
            'age zero' => $this->file('{"terms_version": "2026-09-29", "min_age": 0}'),
        ];

        foreach ($cases as $name => $path) {
            try {
                Legal::fromFile($path);
                $this->fail("{$name}: accepted");
            } catch (RuntimeException) {
                $this->addToAssertionCount(1);
            }
        }
    }
}
