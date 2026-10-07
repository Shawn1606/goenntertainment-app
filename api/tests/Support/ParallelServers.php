<?php

namespace Tests\Support;

use RuntimeException;

/**
 * Several `php -S` servers on this checkout, for tests that need requests to run AT THE SAME
 * TIME in separate PHP processes, as the workers of the deploy do (one PHPUnit process cannot
 * show a race: it handles one request after the other).
 *
 * Each server is one single-threaded process, so this works on every operating system
 * (PHP_CLI_SERVER_WORKERS does not exist on Windows); together they serve as many requests in
 * parallel as there are servers. They inherit this process's environment with the given
 * overrides, so they reach the same database. Requests go out over plain sockets: no HTTP
 * extension is needed, and every request of a burst is sent before the first answer is read.
 */
final class ParallelServers
{
    /** @var list<array{process: resource, port: int, log: string}> */
    private array $servers = [];

    private function __construct() {}

    /** Starts $count servers with the environment of this process plus $overrides. */
    public static function start(int $count, array $overrides): self
    {
        $api = dirname(__DIR__, 2);
        $router = $api.'/vendor/laravel/framework/src/Illuminate/Foundation/resources/server.php';
        if (! is_file($router)) {
            throw new RuntimeException('the framework router for `php -S` is missing (composer install)');
        }

        $env = getenv();
        foreach (array_keys($env) as $name) {
            // The test runner's own output settings are not the servers' business.
            if (str_starts_with($name, 'COLLISION_') || $name === 'PHP_CLI_SERVER_WORKERS') {
                unset($env[$name]);
            }
        }
        $env = array_merge($env, $overrides);

        $self = new self;
        try {
            for ($i = 0; $i < $count; $i++) {
                $port = self::freePort();
                $log = tempnam(sys_get_temp_dir(), 'php-s-');
                // OPcache (where loaded) keeps the compiled framework in each server between its
                // requests; the files do not change while a test runs.
                $process = proc_open(
                    [PHP_BINARY, '-d', 'opcache.enable=1', '-d', 'opcache.enable_cli=1', '-d', 'opcache.validate_timestamps=0', '-S', '127.0.0.1:'.$port, $router],
                    [0 => ['file', PHP_OS_FAMILY === 'Windows' ? 'NUL' : '/dev/null', 'r'], 1 => ['file', $log, 'a'], 2 => ['file', $log, 'a']],
                    $pipes,
                    $api.'/public',
                    $env,
                );
                if (! is_resource($process)) {
                    throw new RuntimeException('could not start `php -S`');
                }
                $self->servers[] = ['process' => $process, 'port' => $port, 'log' => $log];
            }
            foreach ($self->servers as $server) {
                $self->waitUntilListening($server);
            }
        } catch (\Throwable $e) {
            $self->stop();

            throw $e;
        }

        return $self;
    }

    /**
     * Sends the requests one after the other (request i to server i, in turn) and returns the
     * answers: to build up a state, and to get every server past its first, slowest request.
     *
     * @param  list<array{method: string, path: string, body?: array, token?: string}>  $requests
     * @return list<array{status: int, json: mixed}>
     */
    public function inTurn(array $requests): array
    {
        $answers = [];
        foreach ($requests as $i => $request) {
            $answers[] = $this->send([[$i % count($this->servers), $request]])[0];
        }

        return $answers;
    }

    /**
     * Sends every request at once, spread over the servers in turn, and returns the answers in
     * the order of the requests. $whileInFlight runs after the last request is sent and before
     * any answer is read (a test can hold a lock there, and release it).
     *
     * @param  list<array{method: string, path: string, body?: array, token?: string}>  $requests
     * @return list<array{status: int, json: mixed}>
     */
    public function burst(array $requests, ?\Closure $whileInFlight = null): array
    {
        $byServer = [];
        foreach (array_values($requests) as $i => $request) {
            $byServer[] = [$i % count($this->servers), $request];
        }

        return $this->send($byServer, $whileInFlight);
    }

    /**
     * @param  list<array{0: int, 1: array}>  $requests  [server index, request] pairs
     * @return list<array{status: int, json: mixed}>
     */
    private function send(array $requests, ?\Closure $whileInFlight = null, int $timeoutSeconds = 60): array
    {
        $sockets = [];
        foreach ($requests as $i => [$index]) {
            $server = $this->servers[$index];
            $socket = @stream_socket_client('tcp://127.0.0.1:'.$server['port'], $errno, $error, 10);
            if ($socket === false) {
                throw new RuntimeException("could not connect to the test server on port {$server['port']}");
            }
            $sockets[$i] = $socket;
        }

        // Every request is on its way before any answer is read.
        foreach ($requests as $i => [, $request]) {
            fwrite($sockets[$i], self::httpRequest($request));
            stream_set_blocking($sockets[$i], false);
        }
        if ($whileInFlight !== null) {
            $whileInFlight();
        }

        $raw = array_fill_keys(array_keys($sockets), '');
        $open = $sockets;
        $deadline = microtime(true) + $timeoutSeconds;
        while ($open !== []) {
            if (microtime(true) > $deadline) {
                throw new RuntimeException(count($open).' of '.count($requests).' requests got no complete answer in time'.$this->logTail());
            }
            $read = array_values($open);
            $write = $except = null;
            if (stream_select($read, $write, $except, 1) === false) {
                throw new RuntimeException('stream_select failed');
            }
            foreach ($read as $socket) {
                $i = array_search($socket, $open, true);
                $chunk = fread($socket, 65536);
                if ($chunk !== false && $chunk !== '') {
                    $raw[$i] .= $chunk;
                }
                if (feof($socket)) {
                    fclose($socket);
                    unset($open[$i]);
                }
            }
        }

        $answers = [];
        foreach (array_keys($requests) as $i) {
            $answers[] = self::parseResponse($raw[$i]);
        }

        return $answers;
    }

    /** Stops every server and removes its log. */
    public function stop(): void
    {
        foreach ($this->servers as $server) {
            if (is_resource($server['process'])) {
                proc_terminate($server['process']);
                proc_close($server['process']);
            }
            @unlink($server['log']);
        }
        $this->servers = [];
    }

    /** The last lines the servers wrote (access lines and PHP errors), for a failure message. */
    public function logTail(int $lines = 20): string
    {
        $out = [];
        foreach ($this->servers as $server) {
            $text = is_file($server['log']) ? (string) file_get_contents($server['log']) : '';
            $out = array_merge($out, array_slice(preg_split('/\R/', trim($text)) ?: [], -$lines));
        }

        return $out === [] ? '' : "\nserver output:\n".implode("\n", array_slice($out, -$lines));
    }

    private static function freePort(): int
    {
        $probe = stream_socket_server('tcp://127.0.0.1:0', $errno, $error);
        if ($probe === false) {
            throw new RuntimeException('no free local port');
        }
        $name = (string) stream_socket_get_name($probe, false);
        fclose($probe);

        return (int) substr($name, strrpos($name, ':') + 1);
    }

    /** @param array{process: resource, port: int, log: string} $server */
    private function waitUntilListening(array $server): void
    {
        $deadline = microtime(true) + 15;
        while (microtime(true) < $deadline) {
            $socket = @stream_socket_client('tcp://127.0.0.1:'.$server['port'], $errno, $error, 1);
            if ($socket !== false) {
                fclose($socket);

                return;
            }
            if (! proc_get_status($server['process'])['running']) {
                break;
            }
            usleep(50_000);
        }

        throw new RuntimeException("`php -S` did not start on port {$server['port']}".$this->logTail());
    }

    /** @param array{method: string, path: string, body?: array, token?: string} $request */
    private static function httpRequest(array $request): string
    {
        $body = json_encode($request['body'] ?? [], JSON_THROW_ON_ERROR);
        $headers = [
            "{$request['method']} {$request['path']} HTTP/1.0",
            'Host: 127.0.0.1',
            'Accept: application/json',
            'Content-Type: application/json',
            'Content-Length: '.strlen($body),
            'Connection: close',
        ];
        if (isset($request['token'])) {
            $headers[] = 'Authorization: Bearer '.$request['token'];
        }

        return implode("\r\n", $headers)."\r\n\r\n".$body;
    }

    /** @return array{status: int, json: mixed} */
    private static function parseResponse(string $raw): array
    {
        [$head, $body] = array_pad(explode("\r\n\r\n", $raw, 2), 2, '');
        if (preg_match('#^HTTP/\d(?:\.\d)? (\d{3})#', $head, $m) !== 1) {
            throw new RuntimeException('an answer without an HTTP status line ('.strlen($raw).' bytes)');
        }
        if (preg_match('/^Transfer-Encoding:\s*chunked/mi', $head) === 1) {
            $body = self::dechunk($body);
        }

        return ['status' => (int) $m[1], 'json' => json_decode($body, true)];
    }

    private static function dechunk(string $body): string
    {
        $out = '';
        while ($body !== '') {
            [$size, $rest] = array_pad(explode("\r\n", $body, 2), 2, '');
            $length = hexdec(trim($size));
            if ($length === 0) {
                break;
            }
            $out .= substr($rest, 0, $length);
            $body = substr($rest, $length + 2);
        }

        return $out;
    }
}
