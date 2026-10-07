<?php

namespace Tests\Feature;

use RuntimeException;
use Tests\TestCase;

/**
 * The body limit holds before Laravel reads the request (F-02). Request::capture() in
 * public/index.php decodes a JSON body completely while it builds the request, before the first
 * middleware runs, so a middleware alone cannot stop that cost: public/index.php checks first.
 *
 * Proven end to end through public/index.php under PHP's built-in web server, with a memory limit
 * that decoding a 4 MB body would exceed: without the check that request dies in
 * Request::capture() (500); with it, it gets the 413. Also with chunked transfer, where no
 * Content-Length announces the size. A small request still reaches Laravel (its 422).
 *
 * No database and no Node: the requests are refused or fail validation first.
 */
class RequestBodyLimitServerTest extends TestCase
{
    private const MSG_TOO_LARGE = 'Die Anfrage ist zu groß.';

    /** Decoding the 4 MB body below needs well over this (about 70 MB more than the boot). */
    private const MEMORY_LIMIT = '64M';

    /** @var resource|null */
    private $server = null;

    private int $port = 0;

    private string $log = '';

    protected function setUp(): void
    {
        parent::setUp();
        $this->startServer();
    }

    protected function tearDown(): void
    {
        if (is_resource($this->server)) {
            proc_terminate($this->server);
            proc_close($this->server);
        }
        if ($this->log !== '' && is_file($this->log)) {
            unlink($this->log);
        }
        parent::tearDown();
    }

    private function startServer(): void
    {
        $probe = stream_socket_server('tcp://127.0.0.1:0', $errno, $error);
        if ($probe === false) {
            throw new RuntimeException("no free local port ({$errno})");
        }
        $name = (string) stream_socket_get_name($probe, false);
        $this->port = (int) substr($name, strrpos($name, ':') + 1);
        fclose($probe);

        $this->log = (string) tempnam(sys_get_temp_dir(), 'body-limit-server-');
        $env = array_merge(getenv(), [
            'APP_ENV' => 'testing',
            'APP_DEBUG' => 'false',
            'CACHE_STORE' => 'array',
            'SESSION_DRIVER' => 'array',
            'LOG_CHANNEL' => 'null',
            'NODE_FALLBACK_URL' => '',
        ]);

        $this->server = proc_open([
            PHP_BINARY,
            '-d', 'memory_limit='.self::MEMORY_LIMIT,
            '-d', 'post_max_size=16M',
            '-d', 'display_errors=0',
            '-S', '127.0.0.1:'.$this->port,
            '-t', public_path(),
            public_path('index.php'),
        ], [0 => ['pipe', 'r'], 1 => ['file', $this->log, 'a'], 2 => ['file', $this->log, 'a']], $pipes, base_path(), $env);
        if (! is_resource($this->server)) {
            throw new RuntimeException('could not start the PHP built-in server');
        }
        fclose($pipes[0]);

        $deadline = microtime(true) + 15;
        while (microtime(true) < $deadline) {
            $socket = @stream_socket_client('tcp://127.0.0.1:'.$this->port, $errno, $error, 0.2);
            if ($socket !== false) {
                fclose($socket);

                return;
            }
            usleep(100000);
        }
        $this->fail('the PHP built-in server did not start: '.file_get_contents($this->log));
    }

    /**
     * Sends one raw request and returns [status, body].
     *
     * @param  iterable<string>  $body  the body in pieces, written as they come
     */
    private function sendRaw(string $head, iterable $body): array
    {
        $socket = stream_socket_client('tcp://127.0.0.1:'.$this->port, $errno, $error, 5);
        $this->assertNotFalse($socket, "connect failed ({$errno})");
        stream_set_timeout($socket, 60);

        fwrite($socket, $head);
        foreach ($body as $piece) {
            // The server may answer and close before it has read everything: stop writing then.
            if (@fwrite($socket, $piece) === false) {
                break;
            }
        }
        $response = (string) stream_get_contents($socket);
        fclose($socket);

        $this->assertMatchesRegularExpression('/^HTTP\/1\.[01] \d{3}/', $response, 'no HTTP answer; server log: '.file_get_contents($this->log));
        [$headers, $content] = array_pad(explode("\r\n\r\n", $response, 2), 2, '');

        return [(int) substr($headers, 9, 3), $content];
    }

    /** A JSON array of zeros of about $megabytes MB, in 64 kB pieces. */
    private static function zeros(int $megabytes): array
    {
        $body = '['.rtrim(str_repeat('0,', $megabytes * 512 * 1024), ',').']';

        return str_split($body, 65536);
    }

    private static function requestHead(string $extra): string
    {
        return "POST /api/login HTTP/1.1\r\nHost: localhost\r\nAccept: application/json\r\nContent-Type: application/json\r\nConnection: close\r\n{$extra}\r\n";
    }

    public function test_a_small_body_still_reaches_laravel(): void
    {
        $body = '{"email":"not-an-address","password":"x"}';

        [$status] = $this->sendRaw(self::requestHead('Content-Length: '.strlen($body)."\r\n"), [$body]);

        $this->assertSame(422, $status);
    }

    public function test_an_oversized_body_is_refused_before_laravel_decodes_it(): void
    {
        $pieces = self::zeros(4);
        $length = array_sum(array_map('strlen', $pieces));

        $start = hrtime(true);
        [$status, $content] = $this->sendRaw(self::requestHead("Content-Length: {$length}\r\n"), $pieces);
        $seconds = (hrtime(true) - $start) / 1e9;

        $this->assertSame(413, $status, 'server log: '.file_get_contents($this->log));
        $this->assertSame(['message' => self::MSG_TOO_LARGE], json_decode($content, true));
        $this->assertLessThan(5.0, $seconds);
    }

    public function test_an_oversized_chunked_body_is_refused_before_laravel_decodes_it(): void
    {
        $chunks = array_map(static fn (string $piece): string => dechex(strlen($piece))."\r\n{$piece}\r\n", self::zeros(4));
        $chunks[] = "0\r\n\r\n";

        [$status, $content] = $this->sendRaw(self::requestHead("Transfer-Encoding: chunked\r\n"), $chunks);

        $this->assertSame(413, $status, 'server log: '.file_get_contents($this->log));
        $this->assertSame(['message' => self::MSG_TOO_LARGE], json_decode($content, true));
    }
}
