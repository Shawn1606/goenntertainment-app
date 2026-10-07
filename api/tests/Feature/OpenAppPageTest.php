<?php

namespace Tests\Feature;

use App\Http\Responses\OpenAppPage;
use Tests\TestCase;

/**
 * The page behind sticker and invite links (routes/web.php) sends its own Content-Security-Policy:
 * the edge's default (`default-src 'none'`, deploy/Caddyfile) would leave it without its inline
 * styles, and the edge keeps a policy the answer brings. Its own allows the inline CSS and nothing
 * else.
 */
class OpenAppPageTest extends TestCase
{
    public function test_both_pages_send_their_own_policy_with_inline_styles_only(): void
    {
        $pages = [
            '/c/'.str_repeat('a1B2', 5) => 'goenntertainmentapp://c/'.str_repeat('a1B2', 5),
            '/g/abc-123' => 'goenntertainmentapp://join/abc-123',
        ];

        foreach ($pages as $path => $deepLink) {
            $response = $this->get($path);

            $response->assertOk();
            $response->assertHeader('Content-Security-Policy', OpenAppPage::CSP);
            $this->assertStringStartsWith('text/html', (string) $response->headers->get('Content-Type'));
            $this->assertStringContainsString('<style>', $response->getContent(), "{$path}: the page has no inline styles to allow");
            $this->assertStringContainsString('href="'.$deepLink.'"', $response->getContent(), $path);
        }
    }

    public function test_the_policy_allows_inline_styles_and_nothing_else(): void
    {
        $directives = [];
        foreach (explode(';', OpenAppPage::CSP) as $part) {
            $words = preg_split('/\s+/', trim($part));
            $directives[array_shift($words)] = $words;
        }

        $this->assertSame([
            'default-src' => ["'none'"],
            'style-src' => ["'unsafe-inline'"],
            'frame-ancestors' => ["'none'"],
            'base-uri' => ["'none'"],
            'form-action' => ["'none'"],
        ], $directives);
    }

    public function test_paths_outside_the_patterns_are_not_found(): void
    {
        $this->get('/c/short')->assertNotFound();
        $this->get('/g/'.str_repeat('a', 21))->assertNotFound();
        $this->get('/g/a%3Cb')->assertNotFound();
    }
}
