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
        'voucher-redeem' => ['user' => '10/60', 'ip' => '30/60'],
        'payments' => ['user' => '12/60'],
        'checkin' => ['user' => '20/60'],
        'avatar' => ['user' => '10/60'],
        'chat-send' => ['user' => '10/10,30/60,1000/86400', 'ip' => '300/60'],
        'write-content' => ['user' => '60/600,500/86400', 'ip' => '600/600'],
        'write-state' => ['user' => '120/60', 'ip' => '1200/60'],
        'write-report' => ['user' => '10/600,50/86400', 'ip' => '100/600'],
        'write-block' => ['user' => '30/600,200/86400', 'ip' => '300/600'],
        'write-admin' => ['user' => '120/600', 'ip' => '600/600'],
        'two-factor-failures' => ['account' => '10/900'],
        'lock-wait' => '5',
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
            if ($limiter === 'lock-wait') {
                continue; // one number, not rules: test_the_lock_wait_is_a_whole_number_of_seconds
            }
            foreach ($defaults[$limiter] as $scope => $spec) {
                RateLimitRules::parse($spec);
            }
        }

        $this->assertSame(self::DOCUMENTED, $defaults);
    }

    public function test_the_lock_wait_is_a_whole_number_of_seconds(): void
    {
        $this->assertSame(5, RateLimitRules::lockWaitSeconds());

        foreach (['1' => 1, ' 30 ' => 30, '999' => 999] as $spec => $seconds) {
            config(['ratelimits.lock-wait' => $spec]);
            $this->assertSame($seconds, RateLimitRules::lockWaitSeconds(), $spec);
        }
        foreach (['0', '-1', '1000', '2.5', '5s', '', null] as $bad) {
            config(['ratelimits.lock-wait' => $bad]);
            try {
                RateLimitRules::lockWaitSeconds();
                $this->fail('accepted '.json_encode($bad));
            } catch (InvalidArgumentException) {
                $this->addToAssertionCount(1);
            }
        }
    }

    public function test_env_example_lists_every_override_with_its_default(): void
    {
        $config = (string) file_get_contents(base_path('config/ratelimits.php'));
        preg_match_all("/env\('(AUTH_LIMIT_[A-Z0-9_]+)',\s*'([^']+)'\)/", $config, $inConfig, PREG_SET_ORDER);
        $example = (string) file_get_contents(base_path('.env.example'));
        preg_match_all('/^# (AUTH_LIMIT_[A-Z0-9_]+)=(\S+)$/m', $example, $inExample, PREG_SET_ORDER);

        $pairs = static fn (array $sets): array => array_combine(array_column($sets, 1), array_column($sets, 2));

        $this->assertCount(19, $inConfig, 'every scope of config/ratelimits.php (and the lock wait) has its own variable');
        $this->assertSame($pairs($inConfig), $pairs($inExample));
    }

    /**
     * The header of config/ratelimits.php states how long each per-account scope can refuse an
     * account with the defaults: the longest window of its rules (a fixed window refuses until it
     * ends). Named mirror of the numbers above, so the stated lockout cannot drift from them.
     */
    public function test_the_config_states_the_longest_refusal_of_every_account_scope(): void
    {
        $header = (string) file_get_contents(base_path('config/ratelimits.php'));
        $checked = 0;
        foreach (self::DOCUMENTED as $limiter => $scopes) {
            if (! isset($scopes['account'])) {
                continue;
            }
            $seconds = max(array_column(RateLimitRules::parse($scopes['account']), 'seconds'));
            $stated = $seconds % 3600 === 0 ? ($seconds / 3600).' h' : ($seconds / 60).' min';

            $this->assertMatchesRegularExpression(
                '/^\|\s+'.preg_quote($limiter, '/').'\s+up to '.preg_quote($stated, '/').'\b/m',
                $header,
                "config/ratelimits.php does not state 'up to {$stated}' for the {$limiter} account scope",
            );
            $checked++;
        }

        $this->assertSame(7, $checked, 'limiters with an account scope');
    }

    /** @return array<string, string> every AUTH_LIMIT_* variable of config/ratelimits.php with its default */
    private static function overrides(): array
    {
        $config = (string) file_get_contents(base_path('config/ratelimits.php'));
        preg_match_all("/env\('(AUTH_LIMIT_[A-Z0-9_]+)',\s*'([^']+)'\)/", $config, $m, PREG_SET_ORDER);

        return array_combine(array_column($m, 1), array_column($m, 2));
    }

    /** config/ratelimits.php evaluated with these environment variables set (null = unset). */
    private static function configWith(array $variables): array
    {
        $saved = [];
        foreach ($variables as $name => $value) {
            $saved[$name] = [getenv($name), $_ENV[$name] ?? null, $_SERVER[$name] ?? null];
            if ($value === null) {
                putenv($name);
                unset($_ENV[$name], $_SERVER[$name]);
            } else {
                putenv("{$name}={$value}");
                $_ENV[$name] = $_SERVER[$name] = $value;
            }
        }

        try {
            return require base_path('config/ratelimits.php');
        } finally {
            foreach ($saved as $name => [$env, $envConst, $server]) {
                $env === false ? putenv($name) : putenv("{$name}={$env}");
                if ($envConst === null) {
                    unset($_ENV[$name]);
                } else {
                    $_ENV[$name] = $envConst;
                }
                if ($server === null) {
                    unset($_SERVER[$name]);
                } else {
                    $_SERVER[$name] = $server;
                }
            }
        }
    }

    /**
     * The production compose passes every variable as `${NAME:-}`, so an unset one arrives as an
     * empty string. Empty has to mean "the default": RateLimitRules::parse refuses '', and every
     * sign-in route would answer 500.
     */
    public function test_an_empty_override_means_the_default(): void
    {
        $overrides = self::overrides();
        $this->assertCount(19, $overrides);

        $config = self::configWith(array_fill_keys(array_keys($overrides), ''));

        $this->assertSame(self::DOCUMENTED, $config);
    }

    public function test_a_set_override_is_used_and_a_malformed_one_is_still_refused(): void
    {
        $this->assertSame('20/60', self::configWith(['AUTH_LIMIT_LOGIN_IP' => '20/60'])['login']['ip']);

        foreach (['0', 'abc', '0/60', ' '] as $bad) {
            $spec = self::configWith(['AUTH_LIMIT_LOGIN_IP' => $bad])['login']['ip'];
            try {
                RateLimitRules::parse($spec);
                $this->fail('accepted '.json_encode($bad));
            } catch (InvalidArgumentException) {
                $this->addToAssertionCount(1);
            }
        }
    }

    /**
     * A malformed override stops the application while it boots (in the api container that is
     * `php artisan config:cache` in the entrypoint, so the container does not start), instead of
     * a 500 on the sign-in routes at request time. The message names the limiter and the scope.
     */
    public function test_a_malformed_override_stops_the_application_from_booting(): void
    {
        $saved = [getenv('AUTH_LIMIT_LOGIN_IP'), $_ENV['AUTH_LIMIT_LOGIN_IP'] ?? null, $_SERVER['AUTH_LIMIT_LOGIN_IP'] ?? null];
        putenv('AUTH_LIMIT_LOGIN_IP=abc');
        $_ENV['AUTH_LIMIT_LOGIN_IP'] = $_SERVER['AUTH_LIMIT_LOGIN_IP'] = 'abc';

        try {
            $this->refreshApplication();
            $this->fail('the application booted with a malformed rate limit');
        } catch (InvalidArgumentException $e) {
            $this->assertStringContainsString('login.ip', $e->getMessage());
        } finally {
            $saved[0] === false ? putenv('AUTH_LIMIT_LOGIN_IP') : putenv('AUTH_LIMIT_LOGIN_IP='.$saved[0]);
            if ($saved[1] === null) {
                unset($_ENV['AUTH_LIMIT_LOGIN_IP']);
            } else {
                $_ENV['AUTH_LIMIT_LOGIN_IP'] = $saved[1];
            }
            if ($saved[2] === null) {
                unset($_SERVER['AUTH_LIMIT_LOGIN_IP']);
            } else {
                $_SERVER['AUTH_LIMIT_LOGIN_IP'] = $saved[2];
            }
            $this->refreshApplication();
        }
    }

    /** The lock wait is checked while booting too: a malformed value stops the application. */
    public function test_a_malformed_lock_wait_stops_the_application_from_booting(): void
    {
        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('AUTH_LIMIT_LOCK_WAIT');

        RateLimitRules::assertValid(array_replace(self::DOCUMENTED, ['lock-wait' => '0']));
    }

    public function test_the_documented_defaults_pass_the_boot_check(): void
    {
        RateLimitRules::assertValid(self::DOCUMENTED);
        $this->assertSame(5, RateLimitRules::parseLockWait(self::DOCUMENTED['lock-wait']));
    }

    /** The api service of the production compose passes every override, without a default of its own. */
    public function test_the_production_compose_passes_every_override_to_the_api(): void
    {
        $compose = (string) file_get_contents(dirname(base_path()).'/deploy/docker-compose.yml');
        $this->assertSame(1, preg_match('/^  api:\R(.*?)(?=^  \S)/ms', $compose, $service), 'no api service in deploy/docker-compose.yml');

        $missing = [];
        foreach (array_keys(self::overrides()) as $name) {
            if (preg_match('/^      '.$name.': \$\{'.$name.':-\}\r?$/m', $service[1]) !== 1) {
                $missing[] = $name;
            }
        }

        $this->assertSame([], $missing, 'not passed as NAME: ${NAME:-} in the api service');
    }

    public function test_the_deploy_env_example_names_every_override(): void
    {
        $example = (string) file_get_contents(dirname(base_path()).'/deploy/.env.example');

        $missing = array_values(array_filter(
            array_keys(self::overrides()),
            static fn (string $name): bool => preg_match('/\b'.$name.'\b/', $example) !== 1,
        ));

        $this->assertSame([], $missing);
    }
}
