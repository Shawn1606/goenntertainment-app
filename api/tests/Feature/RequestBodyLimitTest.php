<?php

namespace Tests\Feature;

use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Route;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * Laravel refuses request bodies over its limits before it parses them (F-02): 32 kB for JSON
 * and any other non-form body, 16 kB urlencoded, 128 kB on the RevenueCat webhook path; a
 * multipart POST is PHP's to bound. Laravel answers 413 before any route runs. The values are
 * written here on purpose (not read from the middleware), so these tests run, and fail, on code
 * without the limit. The same check before Request::capture() in public/index.php:
 * RequestBodyLimitServerTest.
 *
 * A body within the limits reaches the application: a probe route registered here answers with
 * the size of the body it got (the former Node fallback played that part). No database: every
 * request is refused, fails validation before any query, or reaches the probe.
 */
class RequestBodyLimitTest extends TestCase
{
    private const MSG_TOO_LARGE = 'Die Anfrage ist zu groß.';

    private const KB = 1024;

    /** A route that only reports what reached it. */
    private const PROBE = '/api/_body-probe';

    protected function setUp(): void
    {
        parent::setUp();
        Http::preventStrayRequests();
        $report = static fn (Request $request) => response()->json([
            'bytes' => strlen($request->getContent()),
            'files' => array_keys($request->allFiles()),
        ]);
        Route::post(self::PROBE, $report);
        // The webhook path keeps its larger limit (App\Http\Middleware\LimitRequestBody).
        Route::post('/api/webhooks/revenuecat', $report);
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
        $this->postRaw(self::PROBE, self::jsonOfSize(32 * self::KB), [
            'CONTENT_TYPE' => 'application/json',
            'CONTENT_LENGTH' => 32 * self::KB,
        ])->assertOk()->assertJsonPath('bytes', 32 * self::KB);

        $this->assertTooLarge($this->postRaw(self::PROBE, self::jsonOfSize(32 * self::KB + 1), [
            'CONTENT_TYPE' => 'application/json',
            'CONTENT_LENGTH' => 32 * self::KB + 1,
        ]));
        Http::assertNothingSent();
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
        $this->assertTooLarge($this->postRaw(self::PROBE, self::jsonOfSize(40 * self::KB), [
            'CONTENT_TYPE' => 'application/json',
            'HTTP_TRANSFER_ENCODING' => 'chunked',
        ]));

        $this->postRaw(self::PROBE, self::jsonOfSize(2 * self::KB), [
            'CONTENT_TYPE' => 'application/json',
            'HTTP_TRANSFER_ENCODING' => 'chunked',
        ])->assertOk()->assertJsonPath('bytes', 2 * self::KB);
        Http::assertNothingSent();
    }

    public function test_an_urlencoded_body_over_16_kb_is_refused(): void
    {
        $body = 'pad='.str_repeat('x', 20 * self::KB);
        $this->assertTooLarge($this->postRaw(self::PROBE, $body, [
            'CONTENT_TYPE' => 'application/x-www-form-urlencoded',
            'CONTENT_LENGTH' => strlen($body),
        ]));

        $small = 'pad='.str_repeat('x', 10 * self::KB);
        $this->postRaw(self::PROBE, $small, [
            'CONTENT_TYPE' => 'application/x-www-form-urlencoded',
            'CONTENT_LENGTH' => strlen($small),
        ])->assertOk()->assertJsonPath('bytes', strlen($small));
        Http::assertNothingSent();
    }

    /** The webhook carries the store's subscriber attributes: up to 128 kB, in any spelling of its path. */
    public function test_the_webhook_path_takes_up_to_128_kb(): void
    {
        $body = self::jsonOfSize(100 * self::KB);
        $this->postRaw('/api/webhooks/revenuecat', $body, ['CONTENT_TYPE' => 'application/json', 'CONTENT_LENGTH' => strlen($body)])
            ->assertOk()->assertJsonPath('bytes', 100 * self::KB);
        // Another spelling of the path gets the same limit: no route answers it (404), but it is
        // not refused for its size.
        $this->postRaw('/api/Webhooks//RevenueCat/', $body, ['CONTENT_TYPE' => 'application/json', 'CONTENT_LENGTH' => strlen($body)])
            ->assertNotFound();

        $this->assertTooLarge($this->postRaw('/api/webhooks/revenuecat', self::jsonOfSize(128 * self::KB + 1), [
            'CONTENT_TYPE' => 'application/json',
            'CONTENT_LENGTH' => 128 * self::KB + 1,
        ]));
        Http::assertNothingSent();
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

    /** A multipart POST is bounded by PHP (post_max_size, upload_max_filesize), not here. */
    public function test_a_multipart_upload_of_a_few_megabytes_still_reaches_laravel(): void
    {
        $path = tempnam(sys_get_temp_dir(), 'upload-');
        file_put_contents($path, random_bytes(3 * 1024 * self::KB));

        try {
            $file = new UploadedFile($path, 'banner.jpg', 'image/jpeg', null, true);
            $this->call('POST', self::PROBE, ['title' => 'Upload test'], [], ['banner' => $file], [
                'CONTENT_TYPE' => 'multipart/form-data; boundary=----fixture-boundary',
                'CONTENT_LENGTH' => 3 * 1024 * self::KB + 400,
                'HTTP_ACCEPT' => 'application/json',
            ])->assertOk()->assertJsonPath('files', ['banner']);
        } finally {
            if (is_file($path)) {
                unlink($path);
            }
        }
        Http::assertNothingSent();
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
