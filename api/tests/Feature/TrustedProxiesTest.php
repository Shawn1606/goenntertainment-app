<?php

namespace Tests\Feature;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Route;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/**
 * The real client address (F-31): Laravel trusts forwarding headers from the configured proxy only
 * (config/trustedproxy.php; in production Caddy), never a header the client wrote. What it
 * establishes is what its rate limits count and what its image addresses are built from: a probe
 * route registered here reports the address, host and scheme Laravel took (the former Node
 * fallback, which passed them on, played that part). No database: the requests either go to the
 * probe or fail validation before any query.
 */
class TrustedProxiesTest extends TestCase
{
    private const PROXY = '10.10.10.10';

    private const CLIENT = '203.0.113.7';

    private const OTHER_PEER = '198.51.100.20';

    private const PROBE = '/api/_client-probe';

    protected function setUp(): void
    {
        parent::setUp();
        config(['trustedproxy.proxies' => self::PROXY]);
        Http::preventStrayRequests();
        Route::get(self::PROBE, static fn (Request $request) => response()->json([
            'ip' => $request->ip(),
            'host' => $request->getHost(),
            'scheme' => $request->getScheme(),
        ]));
    }

    /** GET the probe from $peer with these headers. */
    private function fromPeer(string $peer, array $headers, string $host = 'localhost'): TestResponse
    {
        return $this->withServerVariables(['REMOTE_ADDR' => $peer])->withHeaders($headers)->getJson("http://{$host}".self::PROBE);
    }

    public function test_forwarded_for_is_honoured_only_from_the_configured_proxy(): void
    {
        $this->fromPeer(self::PROXY, ['X-Forwarded-For' => self::CLIENT])->assertOk()->assertJsonPath('ip', self::CLIENT);
    }

    public function test_untrusted_peer_cannot_choose_its_address(): void
    {
        $this->fromPeer(self::OTHER_PEER, ['X-Forwarded-For' => self::CLIENT])->assertOk()->assertJsonPath('ip', self::OTHER_PEER);
    }

    public function test_an_appended_chain_is_reduced_to_the_client(): void
    {
        $this->fromPeer(self::PROXY, ['X-Forwarded-For' => '192.0.2.66, '.self::CLIENT])->assertOk()->assertJsonPath('ip', self::CLIENT);
    }

    public function test_without_a_configured_proxy_nobody_is_trusted(): void
    {
        config(['trustedproxy.proxies' => self::configuredProxies('')]);

        $this->fromPeer('127.0.0.1', ['X-Forwarded-For' => self::CLIENT])->assertOk()->assertJsonPath('ip', '127.0.0.1');

        $this->assertSame([], self::configuredProxies(null));
        $this->assertSame(self::PROXY, self::configuredProxies(self::PROXY));
    }

    /**
     * The value config/trustedproxy.php gives for this TRUSTED_PROXIES (null = not set at all),
     * read from the file itself rather than written into the test.
     */
    private static function configuredProxies(?string $setting): mixed
    {
        $saved = [getenv('TRUSTED_PROXIES'), $_ENV['TRUSTED_PROXIES'] ?? null, $_SERVER['TRUSTED_PROXIES'] ?? null];
        if ($setting === null) {
            putenv('TRUSTED_PROXIES');
            unset($_ENV['TRUSTED_PROXIES'], $_SERVER['TRUSTED_PROXIES']);
        } else {
            putenv('TRUSTED_PROXIES='.$setting);
            $_ENV['TRUSTED_PROXIES'] = $_SERVER['TRUSTED_PROXIES'] = $setting;
        }

        try {
            return (require config_path('trustedproxy.php'))['proxies'];
        } finally {
            $saved[0] === false ? putenv('TRUSTED_PROXIES') : putenv('TRUSTED_PROXIES='.$saved[0]);
            if ($saved[1] === null) {
                unset($_ENV['TRUSTED_PROXIES']);
            } else {
                $_ENV['TRUSTED_PROXIES'] = $saved[1];
            }
            if ($saved[2] === null) {
                unset($_SERVER['TRUSTED_PROXIES']);
            } else {
                $_SERVER['TRUSTED_PROXIES'] = $saved[2];
            }
        }
    }

    /** Empty and unset TRUSTED_PROXIES, each with the hosts and the switch for which Laravel trusts every proxy when the list is null. */
    public static function untrustedSetups(): array
    {
        $rows = [];
        foreach (['empty' => '', 'unset' => null] as $label => $setting) {
            foreach (['localhost', 'x.on-forge.com', 'x.on-vapor.com'] as $host) {
                $rows["{$label}, host {$host}"] = [$setting, $host, false];
            }
            $rows["{$label}, cloud switch on"] = [$setting, 'localhost', true];
        }

        return $rows;
    }

    /**
     * "Empty = trust nobody" has to hold whatever Host the client sends: given a null proxy list,
     * Laravel's TrustProxies trusts every peer when the Host ends in .on-forge.com or .on-vapor.com
     * or LARAVEL_CLOUD=1 is set, so a client could choose its own address again (F-31).
     */
    #[DataProvider('untrustedSetups')]
    public function test_an_empty_or_unset_proxy_setting_trusts_nobody_whatever_the_host(?string $setting, string $host, bool $cloud): void
    {
        config(['trustedproxy.proxies' => self::configuredProxies($setting)]);

        $savedCloud = $_SERVER['LARAVEL_CLOUD'] ?? null;
        if ($cloud) {
            $_SERVER['LARAVEL_CLOUD'] = '1';
        }

        try {
            $response = $this->fromPeer(self::OTHER_PEER, ['X-Forwarded-For' => self::CLIENT], $host)->assertOk();
        } finally {
            if ($savedCloud === null) {
                unset($_SERVER['LARAVEL_CLOUD']);
            } else {
                $_SERVER['LARAVEL_CLOUD'] = $savedCloud;
            }
        }

        $response->assertJsonPath('ip', self::OTHER_PEER);
    }

    /** The guard behind the test above: no later edit of the config file brings the null back. */
    public function test_the_proxy_setting_is_an_empty_list_when_nothing_is_configured(): void
    {
        $this->assertSame([], self::configuredProxies(''));
        $this->assertSame([], self::configuredProxies(null));
        $this->assertSame(self::PROXY, self::configuredProxies(self::PROXY));
    }

    public function test_host_and_scheme_come_only_from_the_proxy(): void
    {
        $this->fromPeer(self::OTHER_PEER, [
            'X-Forwarded-Host' => 'spoofed.example.invalid',
            'X-Forwarded-Proto' => 'https',
        ])->assertOk()->assertJsonPath('host', 'localhost')->assertJsonPath('scheme', 'http');
    }

    public function test_host_and_scheme_from_the_proxy_are_used(): void
    {
        $this->fromPeer(self::PROXY, [
            'X-Forwarded-Host' => 'app.example.invalid',
            'X-Forwarded-Proto' => 'https',
        ])->assertOk()->assertJsonPath('host', 'app.example.invalid')->assertJsonPath('scheme', 'https');
    }

    /** Only X-Forwarded-For, -Host and -Proto are read (bootstrap/app.php): no other header sets the address. */
    public function test_other_client_address_headers_do_not_change_the_address(): void
    {
        $this->fromPeer(self::PROXY, [
            'X-Forwarded-For' => self::CLIENT,
            'X-Real-IP' => '192.0.2.1',
            'Forwarded' => 'for=192.0.2.2',
            'True-Client-IP' => '192.0.2.3',
            'X-Client-IP' => '192.0.2.4',
            'X-Forwarded-Port' => '8443',
        ])->assertOk()->assertJsonPath('ip', self::CLIENT);

        $this->fromPeer(self::OTHER_PEER, [
            'X-Real-IP' => '192.0.2.1',
            'Forwarded' => 'for=192.0.2.2',
            'True-Client-IP' => '192.0.2.3',
            'X-Client-IP' => '192.0.2.4',
        ])->assertOk()->assertJsonPath('ip', self::OTHER_PEER);
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
