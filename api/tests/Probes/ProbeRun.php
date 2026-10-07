<?php

namespace Tests\Probes;

use RuntimeException;

/**
 * Runs AppSchemaProbe in a child PHPUnit process (plain PHP, no Laravel, so unit tests can use
 * it). The child inherits this process's environment with $overrides applied, so a test can show
 * what every database feature test gets with another database setup.
 */
final class ProbeRun
{
    /** @return array{0: int, 1: string} the child's exit code and its combined output */
    public static function appSchemaProbe(array $overrides): array
    {
        $api = dirname(__DIR__, 2);

        $env = getenv();
        // The child prints PHPUnit's plain summary, which the callers read: `php artisan test` asks
        // for Collision's printer through COLLISION_*, and laravel/pao switches to JSON output when
        // it detects an AI agent unless PAO_DISABLE is set.
        foreach (array_keys($env) as $name) {
            if (str_starts_with($name, 'COLLISION_')) {
                unset($env[$name]);
            }
        }
        $env = array_merge($env, ['PAO_DISABLE' => '1'], $overrides);

        $command = [
            PHP_BINARY,
            $api.'/vendor/phpunit/phpunit/phpunit',
            '--configuration', $api.'/phpunit.xml',
            '--colors=never',
            '--do-not-cache-result',
            $api.'/tests/Probes/AppSchemaProbe.php',
        ];
        $process = proc_open($command, [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['redirect', 1]], $pipes, $api, $env);
        if (! is_resource($process)) {
            throw new RuntimeException('could not start a child PHPUnit process');
        }
        fclose($pipes[0]);
        // Line ends as on Linux, so callers can match whole lines on every platform.
        $output = str_replace("\r\n", "\n", (string) stream_get_contents($pipes[1]));
        fclose($pipes[1]);

        return [proc_close($process), $output];
    }
}
