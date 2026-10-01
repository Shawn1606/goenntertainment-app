<?php

namespace Tests\Feature;

use App\Support\RateLimitRules;
use Illuminate\Cache\RateLimiting\Limit;
use InvalidArgumentException;
use LogicException;
use Tests\TestCase;

/**
 * The rule format of config/ratelimits.php, the documented defaults, and their copy in
 * api/.env.example (named mirror, checked here).
 */
class RateLimitRulesTest extends TestCase
{
    /**
     * The default limits, as the PR text lists them. Changing a number is allowed, but it has to
     * change here, in api/.env.example and in the PR table together.
     */
    private const DOCUMENTED = [
        'register' => ['ip' => '10/600,30/3600', 'account' => '5/3600'],
        'login' => ['account_ip' => '10/60', 'ip' => '30/60', 'account' => '50/3600,200/86400'],
        'password-forgot' => ['ip' => '5/600,20/3600', 'account' => '3/3600,10/86400'],
        'password-reset' => ['ip' => '10/600', 'account' => '10/3600'],
        'two-factor' => ['challenge' => '10/60', 'ip' => '30/60', 'account' => '30/3600'],
        'two-factor-resend' => ['ip' => '10/60', 'account' => '5/600,20/86400'],
        'two-factor-setup' => ['user' => '10/60,30/3600'],
        'account-sensitive' => ['user' => '10/60,30/3600'],
        'profile' => ['user' => '30/60,300/3600'],
    ];

    public function test_rules_parse(): void
    {
        $this->assertSame([['max' => 10, 'seconds' => 60]], RateLimitRules::parse('10/60'));
        $this->assertSame(
            [['max' => 10, 'seconds' => 600], ['max' => 30, 'seconds' => 3600]],
            RateLimitRules::parse(' 10/600 , 30 / 3600 '),
        );
    }

    public function test_malformed_rules_throw(): void
    {
        $bad = ['', ' ', '10', '10/', '/60', '0/60', '10/0', '-1/60', '10/60,', 'ten/60', '10/60;30/3600', '1e3/60', null, 10];
        foreach ($bad as $spec) {
            try {
                RateLimitRules::parse($spec);
                $this->fail('accepted '.json_encode($spec));
            } catch (InvalidArgumentException) {
                $this->addToAssertionCount(1);
            }
        }
    }

    public function test_every_rule_is_its_own_limit_with_the_window_in_its_key(): void
    {
        config(['ratelimits.probe' => ['ip' => '2/60,5/3600', 'account' => '1/600']]);
        $response = static fn () => response()->json([], 429);

        $limits = RateLimitRules::limits('probe', ['ip' => '192.0.2.1', 'account' => 'user:7'], $response);

        $this->assertCount(3, $limits);
        $this->assertContainsOnlyInstancesOf(Limit::class, $limits);
        $this->assertSame(
            ['probe|ip|192.0.2.1|60', 'probe|ip|192.0.2.1|3600', 'probe|account|user:7|600'],
            array_map(fn (Limit $l) => $l->key, $limits),
        );
        $this->assertSame([2, 5, 1], array_map(fn (Limit $l) => $l->maxAttempts, $limits));
        $this->assertSame([60, 3600, 600], array_map(fn (Limit $l) => $l->decaySeconds, $limits));
    }

    public function test_scopes_and_keys_must_match(): void
    {
        config(['ratelimits.probe' => ['ip' => '2/60', 'account' => '1/600']]);
        $response = static fn () => response()->json([], 429);

        foreach ([['ip' => 'x'], ['ip' => 'x', 'account' => 'y', 'user' => 'z'], []] as $keys) {
            try {
                RateLimitRules::limits('probe', $keys, $response);
                $this->fail('accepted keys '.json_encode(array_keys($keys)));
            } catch (LogicException) {
                $this->addToAssertionCount(1);
            }
        }

        $this->expectException(LogicException::class);
        RateLimitRules::limits('no-such-limiter', [], $response);
    }

    public function test_the_defaults_are_the_documented_table(): void
    {
        $defaults = require base_path('config/ratelimits.php');
        foreach (array_keys(self::DOCUMENTED) as $limiter) {
            foreach ($defaults[$limiter] as $scope => $spec) {
                RateLimitRules::parse($spec);
            }
        }

        $this->assertSame(self::DOCUMENTED, $defaults);
    }

    public function test_env_example_lists_every_override_with_its_default(): void
    {
        $config = (string) file_get_contents(base_path('config/ratelimits.php'));
        preg_match_all("/env\('(AUTH_LIMIT_[A-Z0-9_]+)',\s*'([^']+)'\)/", $config, $inConfig, PREG_SET_ORDER);
        $example = (string) file_get_contents(base_path('.env.example'));
        preg_match_all('/^# (AUTH_LIMIT_[A-Z0-9_]+)=(\S+)$/m', $example, $inExample, PREG_SET_ORDER);

        $pairs = static fn (array $sets): array => array_combine(array_column($sets, 1), array_column($sets, 2));

        $this->assertCount(17, $inConfig, 'every scope of config/ratelimits.php has its own variable');
        $this->assertSame($pairs($inConfig), $pairs($inExample));
    }
}
