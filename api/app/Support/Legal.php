<?php

namespace App\Support;

use RuntimeException;

/**
 * The current terms version and the minimum age (F-14), from shared/legal.json, the one source
 * for Laravel, the container smoke and (as named mirrors pinned by a test) the app.
 *
 * Sign-up (AuthController::register) accepts only this terms version and a confirmation of this
 * minimum age, and stores both with a timestamp. Without a readable, valid file nothing is
 * accepted (an exception instead of a default): a consent check that silently goes missing is
 * found only after accounts were created without it.
 */
final class Legal
{
    /** A terms version is a date, as the app shows it under the text (src/domain/legal.ts). */
    private const VERSION_PATTERN = '/^\d{4}-\d{2}-\d{2}$/';

    private static ?self $default = null;

    private function __construct(
        private readonly string $termsVersion,
        private readonly int $minAge,
    ) {}

    public static function default(): self
    {
        return self::$default ??= self::fromFile(self::defaultPath());
    }

    /** shared/ sits next to api/ in the repository and in the image (/var/www/shared). */
    public static function defaultPath(): string
    {
        return dirname(__DIR__, 3).'/shared/legal.json';
    }

    public static function fromFile(string $path): self
    {
        $raw = is_readable($path) ? file_get_contents($path) : false;
        if ($raw === false) {
            throw new RuntimeException("Legal settings not readable: {$path}");
        }

        $data = json_decode($raw, true);
        $version = is_array($data) ? ($data['terms_version'] ?? null) : null;
        $minAge = is_array($data) ? ($data['min_age'] ?? null) : null;
        if (! is_string($version) || preg_match(self::VERSION_PATTERN, $version) !== 1) {
            throw new RuntimeException("Legal settings need 'terms_version' as YYYY-MM-DD: {$path}");
        }
        if (! is_int($minAge) || $minAge < 1 || $minAge > 99) {
            throw new RuntimeException("Legal settings need 'min_age' as a whole number of years: {$path}");
        }

        return new self($version, $minAge);
    }

    public static function termsVersion(): string
    {
        return self::default()->termsVersion;
    }

    public static function minAge(): int
    {
        return self::default()->minAge;
    }

    public function version(): string
    {
        return $this->termsVersion;
    }

    public function age(): int
    {
        return $this->minAge;
    }
}
