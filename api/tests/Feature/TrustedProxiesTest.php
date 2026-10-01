<?php

namespace Tests\Feature;

use Illuminate\Http\Client\Request as ClientRequest;
use Illuminate\Support\Facades\Http;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * The real client address (F-31): Laravel trusts forwarding headers from the configured proxy only
 * (config/trustedproxy.php; in production Caddy), and passes on to Node exactly the client address
 * it established, never a header the client wrote. No database: the requests either go to the
 * faked Node or fail validation before any query.
 */
class TrustedProxiesTest extends TestCase
{
    private const PROXY = '10.10.10.10';

    private const CLIENT = '203.0.113.7';

    private const OTHER_PEER = '198.51.100.20';

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.node_fallback.url' => 'http://node.test', 'trustedproxy.proxies' => self::PROXY]);
        Http::preventStrayRequests();
        Http::fake(['node.test/*' => Http::response(['data' => []], 200)]);
    }

    /** GET /api/activities (a Node path) from $peer with these headers. */
    private function fromPeer(string $peer, array $headers): TestResponse
    {
        return $this->withServerVariables(['REMOTE_ADDR' => $peer])->withHeaders($headers)->getJson('/api/activities');
    }

    /** The one header value Node received. */
    private function sentHeader(string $name): ?string
    {
        $values = Http::recorded()->first()[0]->header($name);
        $this->assertCount(1, Http::recorded(), 'exactly one call to Node expected');
        $this->assertLessThanOrEqual(1, count($values), "{$name} sent more than once");

        return $values[0] ?? null;
    }

    public function test_forwarded_for_is_honoured_only_from_the_configured_proxy(): void
    {
        $this->fromPeer(self::PROXY, ['X-Forwarded-For' => self::CLIENT])->assertOk();

        $this->assertSame(self::CLIENT, $this->sentHeader('X-Forwarded-For'));
    }

    public function test_untrusted_peer_cannot_choose_its_address(): void
    {
        $this->fromPeer(self::OTHER_PEER, ['X-Forwarded-For' => self::CLIENT])->assertOk();

        $this->assertSame(self::OTHER_PEER, $this->sentHeader('X-Forwarded-For'));
    }

    public function test_an_appended_chain_is_reduced_to_the_client(): void
    {
        $this->fromPeer(self::PROXY, ['X-Forwarded-For' => '192.0.2.66, '.self::CLIENT])->assertOk();

        $this->assertSame(self::CLIENT, $this->sentHeader('X-Forwarded-For'));
    }

    public function test_without_a_configured_proxy_nobody_is_trusted(): void
    {
        config(['trustedproxy.proxies' => null]);

        $this->fromPeer('127.0.0.1', ['X-Forwarded-For' => self::CLIENT])->assertOk();

        $this->assertSame('127.0.0.1', $this->sentHeader('X-Forwarded-For'));
    }

    public function test_host_and_scheme_come_only_from_the_proxy(): void
    {
        $this->fromPeer(self::OTHER_PEER, [
            'X-Forwarded-Host' => 'spoofed.example.invalid',
            'X-Forwarded-Proto' => 'https',
        ])->assertOk();

        $this->assertSame('localhost', $this->sentHeader('X-Forwarded-Host'));
        $this->assertSame('http', $this->sentHeader('X-Forwarded-Proto'));
    }

    public function test_host_and_scheme_from_the_proxy_are_passed_on(): void
    {
        $this->fromPeer(self::PROXY, [
            'X-Forwarded-Host' => 'app.example.invalid',
            'X-Forwarded-Proto' => 'https',
        ])->assertOk();

        $this->assertSame('app.example.invalid', $this->sentHeader('X-Forwarded-Host'));
        $this->assertSame('https', $this->sentHeader('X-Forwarded-Proto'));
    }

    public function test_other_client_address_headers_are_not_passed_on(): void
    {
        $this->fromPeer(self::PROXY, [
            'X-Forwarded-For' => self::CLIENT,
            'X-Real-IP' => '192.0.2.1',
            'Forwarded' => 'for=192.0.2.2',
            'True-Client-IP' => '192.0.2.3',
            'X-Client-IP' => '192.0.2.4',
            'X-Forwarded-Port' => '8443',
        ])->assertOk();

        Http::assertSent(fn (ClientRequest $request) => ! $request->hasHeader('X-Real-IP')
            && ! $request->hasHeader('Forwarded')
            && ! $request->hasHeader('True-Client-IP')
            && ! $request->hasHeader('X-Client-IP')
            && ! $request->hasHeader('X-Forwarded-Port'));
    }

    /**
     * Laravel's own limits key on $request->ip() too. With every peer trusted, a client could send
     * each sign-in attempt under another X-Forwarded-For and never reach the per-address limit.
     * (Invalid e-mail addresses: the throttle counts the request, the controller answers 422
     * before any database query. Robust to other limit numbers as long as they stay below 200.)
     */
    public function test_rotating_forwarded_for_does_not_escape_the_login_limit(): void
    {
        $statuses = [];
        for ($i = 1; $i <= 200; $i++) {
            $status = $this->withServerVariables(['REMOTE_ADDR' => self::OTHER_PEER])
                ->withHeaders(['X-Forwarded-For' => '192.0.2.'.($i % 250)])
                ->postJson('/api/login', ['email' => 'not-an-address-'.$i, 'password' => 'x'])
                ->status();
            $statuses[$status] = ($statuses[$status] ?? 0) + 1;
            if ($status === 429) {
                break;
            }
        }

        $this->assertArrayHasKey(429, $statuses, 'no 429 in '.array_sum($statuses).' attempts: '.json_encode($statuses));
    }
}
