<?php

namespace Tests\Unit;

use App\Support\ApiPath;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * App\Support\ApiPath: one spelling per request path (F-01). A unit test of a class this change
 * adds; the behaviour through HTTP is tested in tests/Feature/NodeFallbackOwnershipTest.php.
 */
class ApiPathTest extends TestCase
{
    public static function spellings(): array
    {
        return [
            'already normal' => ['/api/login', '/api/login'],
            'mixed case' => ['/api/Login', '/api/login'],
            'upper case' => ['/API/LOGIN', '/api/login'],
            'double slash' => ['/api//login', '/api/login'],
            'many slashes' => ['//api///login//', '/api/login'],
            'trailing slash' => ['/api/login/', '/api/login'],
            'dot segment' => ['/api/./login', '/api/login'],
            'dot-dot segment' => ['/api/x/../login', '/api/login'],
            'dot-dot above the root' => ['/api/../../up', '/up'],
            'encoded letter, upper' => ['/api/%4Cogin', '/api/login'],
            'encoded letter, lower' => ['/api/%6cogin', '/api/login'],
            'double-encoded letter' => ['/api/%254Cogin', '/api/login'],
            'triple-encoded letter' => ['/api/%25254Cogin', '/api/login'],
            'encoded dot segment' => ['/api/%2e/login', '/api/login'],
            'double-encoded dot-dot' => ['/api/%252e%252e/up', '/up'],
            'encoded slash' => ['/api%2Flogin', '/api/login'],
            'encoded trailing slash' => ['/api/login%2F', '/api/login'],
            'backslash' => ['/api\\login', '/api/login'],
            'encoded backslash' => ['/api/%5Clogin', '/api/login'],
            'plus stays a plus' => ['/api/a+b', '/api/a+b'],
            'umlaut, encoded' => ['/api/users/J%C3%9CRGEN', '/api/users/jürgen'],
            'root' => ['/', '/'],
            'empty' => ['', '/'],
        ];
    }

    #[DataProvider('spellings')]
    public function test_normalise(string $raw, string $expected): void
    {
        $this->assertSame($expected, ApiPath::normalise($raw));
    }

    public function test_decoding_stops_after_eight_rounds(): void
    {
        // 'L' percent-encoded k times is '%' followed by k-1 times '25', then '4C'.
        $eight = '/api/%'.str_repeat('25', 7).'4Cogin';    // decodes 8 times
        $nine = '/api/%'.str_repeat('25', 8).'4Cogin';     // would need a 9th round
        $this->assertSame('/api/login', ApiPath::normalise($eight));
        $this->assertNull(ApiPath::normalise($nine));
    }

    public static function refused(): array
    {
        return [
            'NUL' => ['/api/login%00'],
            'double-encoded NUL' => ['/api/login%2500'],
            'line feed' => ['/api/log%0Ain'],
            'DEL' => ['/api/login%7F'],
            'invalid UTF-8' => ['/api/%C3%28'],
        ];
    }

    #[DataProvider('refused')]
    public function test_refuses_control_characters_and_invalid_utf8(string $raw): void
    {
        $this->assertNull(ApiPath::normalise($raw));
    }

    public function test_encode_keeps_reserved_characters_inside_their_segment(): void
    {
        $this->assertSame('/api/activities/history', ApiPath::encode('/api/activities/history'));
        $this->assertSame('/api/users/a%3Fb%23c%25d', ApiPath::encode('/api/users/a?b#c%d'));
        $this->assertSame('/api/users/j%C3%BCrgen', ApiPath::encode('/api/users/jürgen'));
    }

    public function test_is_under_api(): void
    {
        $this->assertTrue(ApiPath::isUnderApi('/api'));
        $this->assertTrue(ApiPath::isUnderApi('/api/login'));
        $this->assertFalse(ApiPath::isUnderApi('/apix'));
        $this->assertFalse(ApiPath::isUnderApi('/internal/health'));
        $this->assertFalse(ApiPath::isUnderApi('/'));
    }
}
