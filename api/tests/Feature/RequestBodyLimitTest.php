<?php

namespace Tests\Feature;

use Illuminate\Http\Client\Request as ClientRequest;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Http;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * Laravel refuses request bodies over Node's limits before it parses them (F-02): 32 kB for JSON
 * and any other non-form body, 16 kB urlencoded, 128 kB on the RevenueCat webhook path; a
 * multipart POST is PHP's to bound. Laravel answers 413 with Node's message and calls Node not at
 * all. The values are written here on purpose (not read from the middleware), so these tests run,
 * and fail, on code without the limit. The same check before Request::capture() in
 * public/index.php: RequestBodyLimitServerTest.
 *
 * No database: every request is refused, fails validation before any query, or goes to the faked
 * Node.
 */
class RequestBodyLimitTest extends TestCase
{
    private const MSG_TOO_LARGE = 'Die Anfrage ist zu groß.';

    private const KB = 1024;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.node_fallback.url' => 'http://node.test']);
        Http::preventStrayRequests();
        Http::fake(['node.test/*' => Http::response(['ok' => true], 200)]);
    }

    /** A JSON object of exactly $bytes bytes: {"pad":"xxx..."}. */
    private static function jsonOfSize(int $bytes): string
    {
        $body = '{"pad":"'.str_repeat('x', $bytes - 10).'"}';
        self::assertSame($bytes, strlen($body));

        return $body;
    }

    /** POST $body as raw content with these server variables (Content-Length only when given). */
    private function postRaw(string $uri, string $body, array $server, string $method = 'POST'): TestResponse
    {
        return $this->call($method, $uri, [], [], [], $server + ['HTTP_ACCEPT' => 'application/json'], $body);
    }

    private function assertTooLarge(TestResponse $response): void
    {
        $response->assertStatus(413)->assertExactJson(['message' => self::MSG_TOO_LARGE]);
    }

    public function test_a_json_body_over_32_kb_is_refused_on_a_laravel_route(): void
    {
        $this->assertTooLarge($this->postJson('/api/login', ['email' => str_repeat('a', 40 * self::KB).'@example.invalid', 'password' => 'x']));
        Http::assertNothingSent();
    }

    public function test_a_json_body_over_32_kb_is_refused_on_a_node_path_and_never_forwarded(): void
    {
        $this->assertTooLarge($this->postRaw('/api/activities', self::jsonOfSize(40 * self::KB), [
            'CONTENT_TYPE' => 'application/json',
            'CONTENT_LENGTH' => 40 * self::KB,
        ]));
        Http::assertNothingSent();
    }

    public function test_the_json_limit_is_exactly_32_kb(): void
    {
        $this->postRaw('/api/activities', self::jsonOfSize(32 * self::KB), [
            'CONTENT_TYPE' => 'application/json',
            'CONTENT_LENGTH' => 32 * self::KB,
        ])->assertOk();
        Http::assertSentCount(1);

        $this->assertTooLarge($this->postRaw('/api/activities', self::jsonOfSize(32 * self::KB + 1), [
            'CONTENT_TYPE' => 'application/json',
            'CONTENT_LENGTH' => 32 * self::KB + 1,
        ]));
        Http::assertSentCount(1);
    }

    /** A 100,000-character value and a 1 MB array, each answered fast (generous bound). */
    public function test_100000_characters_and_1_mb_are_refused_fast(): void
    {
        $bodies = [
            '100,000-character value' => json_encode(['email' => str_repeat('a', 100000), 'password' => 'x']),
            '1 MB array' => '['.rtrim(str_repeat('0,', 512 * self::KB), ',').']',
        ];

        foreach ($bodies as $label => $body) {
            $start = hrtime(true);
            $response = $this->postRaw('/api/login', $body, ['CONTENT_TYPE' => 'application/json', 'CONTENT_LENGTH' => strlen($body)]);
            $seconds = (hrtime(true) - $start) / 1e9;

            $this->assertTooLarge($response);
            $this->assertLessThan(2.0, $seconds, "{$label}: {$seconds} s");
        }
        Http::assertNothingSent();
    }

    /** Without a Content-Length (chunked transfer) the body itself is measured. */
    public function test_a_chunked_body_is_measured_without_a_content_length(): void
    {
        $this->assertTooLarge($this->postRaw('/api/activities', self::jsonOfSize(40 * self::KB), [
            'CONTENT_TYPE' => 'application/json',
            'HTTP_TRANSFER_ENCODING' => 'chunked',
        ]));
        Http::assertNothingSent();

        $this->postRaw('/api/activities', self::jsonOfSize(2 * self::KB), [
            'CONTENT_TYPE' => 'application/json',
            'HTTP_TRANSFER_ENCODING' => 'chunked',
        ])->assertOk();
        Http::assertSentCount(1);
    }

    public function test_an_urlencoded_body_over_16_kb_is_refused(): void
    {
        $body = 'pad='.str_repeat('x', 20 * self::KB);
        $this->assertTooLarge($this->postRaw('/api/activities', $body, [
            'CONTENT_TYPE' => 'application/x-www-form-urlencoded',
            'CONTENT_LENGTH' => strlen($body),
        ]));
        Http::assertNothingSent();

        $small = 'pad='.str_repeat('x', 10 * self::KB);
        $this->postRaw('/api/activities', $small, [
            'CONTENT_TYPE' => 'application/x-www-form-urlencoded',
            'CONTENT_LENGTH' => strlen($small),
        ])->assertOk();
        Http::assertSentCount(1);
    }

    /** The webhook carries the store's subscriber attributes: up to 128 kB, in any spelling of its path. */
    public function test_the_webhook_takes_up_to_128_kb_and_is_still_forwarded(): void
    {
        foreach (['/api/webhooks/revenuecat', '/api/Webhooks//RevenueCat/'] as $path) {
            $body = self::jsonOfSize(100 * self::KB);
            $this->postRaw($path, $body, ['CONTENT_TYPE' => 'application/json', 'CONTENT_LENGTH' => strlen($body)])->assertOk();
        }
        Http::assertSentCount(2);
        Http::assertSent(fn (ClientRequest $request) => str_ends_with($request->url(), '/api/webhooks/revenuecat')
            && strlen($request->body()) === 100 * self::KB);

        $this->assertTooLarge($this->postRaw('/api/webhooks/revenuecat', self::jsonOfSize(128 * self::KB + 1), [
            'CONTENT_TYPE' => 'application/json',
            'CONTENT_LENGTH' => 128 * self::KB + 1,
        ]));
        Http::assertSentCount(2);
    }

    /** Only the webhook path gets the larger limit, not a path that merely contains it. */
    public function test_other_paths_keep_the_32_kb_limit(): void
    {
        $this->assertTooLarge($this->postRaw('/api/webhooks/revenuecat/other', self::jsonOfSize(40 * self::KB), [
            'CONTENT_TYPE' => 'application/json',
            'CONTENT_LENGTH' => 40 * self::KB,
        ]));
        Http::assertNothingSent();
    }

    /** A multipart POST is bounded by PHP (post_max_size, upload_max_filesize) and Node, not here. */
    public function test_a_multipart_upload_of_a_few_megabytes_still_reaches_node(): void
    {
        $path = tempnam(sys_get_temp_dir(), 'upload-');
        file_put_contents($path, random_bytes(3 * 1024 * self::KB));

        try {
            $file = new UploadedFile($path, 'banner.jpg', 'image/jpeg', null, true);
            $this->call('POST', '/api/activities', ['title' => 'Upload test'], [], ['banner' => $file], [
                'CONTENT_TYPE' => 'multipart/form-data; boundary=----fixture-boundary',
                'CONTENT_LENGTH' => 3 * 1024 * self::KB + 400,
                'HTTP_ACCEPT' => 'application/json',
            ])->assertOk();
        } finally {
            if (is_file($path)) {
                unlink($path);
            }
        }

        Http::assertSentCount(1);
        Http::assertSent(fn (ClientRequest $request) => $request->isMultipart()
            && str_contains($request->body(), 'filename="banner.jpg"')
            && strlen($request->body()) > 3 * 1024 * self::KB);
    }

    /** PHP parses multipart only for POST; any other method leaves the body raw, so it is limited. */
    public function test_a_multipart_body_with_another_method_is_limited(): void
    {
        $this->assertTooLarge($this->postRaw('/api/posts/1', str_repeat('x', 40 * self::KB), [
            'CONTENT_TYPE' => 'multipart/form-data; boundary=----fixture-boundary',
            'CONTENT_LENGTH' => 40 * self::KB,
        ], 'PATCH'));
        Http::assertNothingSent();
    }
}
