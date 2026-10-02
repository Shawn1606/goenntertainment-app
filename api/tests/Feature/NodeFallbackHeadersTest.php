<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * Files Node serves through the fallback keep the headers that protect them (F-11): the type is
 * not to be guessed (X-Content-Type-Options: nosniff), a file opened on its own runs nothing
 * (Content-Security-Policy), and private files are not kept by any cache (Cache-Control). Laravel
 * copies only the headers that belong to the payload; these are part of it.
 *
 * No database: Node is faked (node.test), and the fallback forwards without a query.
 */
class NodeFallbackHeadersTest extends TestCase
{
    private const CSP = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox";

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.node_fallback.url' => 'http://node.test']);
        Http::preventStrayRequests();
        Http::fake([
            'node.test/*' => Http::response("\x89PNG\r\n\x1a\nnot-really-a-png", 200, [
                'Content-Type' => 'image/png',
                'X-Content-Type-Options' => 'nosniff',
                'Content-Security-Policy' => self::CSP,
                'Cache-Control' => 'private, no-store',
                // Not part of the payload: never copied (Laravel sets its own CORS headers).
                'Access-Control-Allow-Origin' => 'https://node-set.example.invalid',
            ]),
        ]);
    }

    public function test_a_private_image_from_node_keeps_nosniff_csp_and_no_store(): void
    {
        $response = $this->withHeaders(['Authorization' => 'Bearer 1|test-only-token-not-a-secret'])
            ->get('/api/admin/evidence-files/0123456789abcdef0123456789abcdef01234567.png');

        $response->assertOk();
        $response->assertHeader('Content-Type', 'image/png');
        $response->assertHeader('X-Content-Type-Options', 'nosniff');
        $response->assertHeader('Content-Security-Policy', self::CSP);
        $this->assertStringContainsString('no-store', (string) $response->headers->get('Cache-Control'));
        $this->assertNotSame('https://node-set.example.invalid', $response->headers->get('Access-Control-Allow-Origin'));
        $this->assertCount(1, Http::recorded(), 'the request reached the faked Node once');
    }

    public function test_a_story_image_from_node_keeps_nosniff(): void
    {
        $response = $this->withHeaders(['Authorization' => 'Bearer 1|test-only-token-not-a-secret'])
            ->get('/api/media/stories/0123456789abcdef0123456789abcdef01234567.jpg');

        $response->assertOk();
        $response->assertHeader('X-Content-Type-Options', 'nosniff');
        $response->assertHeader('Content-Security-Policy', self::CSP);
    }
}
