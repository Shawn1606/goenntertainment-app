<?php

namespace Tests;

use App\Models\User;
use App\Support\BlockedTerms;
use App\Support\Legal;
use DateTimeImmutable;
use DateTimeInterface;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;
use Throwable;

/**
 * Base class for every feature test that touches the database.
 *
 * The app schema exists in one place only, server/schema.sql: the stock migrations in
 * database/migrations do not match it, and the controllers use MySQL-only SQL. So these tests
 * run against MySQL 8.4 loaded from that file (CI's api job, or the local command in README
 * "Tests and checks"), each test inside a transaction that is rolled back afterwards. They never
 * build their own schema: a second copy would drift from schema.sql (F-33), and
 * RefreshDatabase would replace the app tables with the stock ones.
 *
 * Without MySQL, or with a database that lacks a table of server/schema.sql, every test of this
 * class FAILS with a message that says how to run it. It is never skipped: a skipped suite looks
 * green while it tests nothing. tests/Unit/AppFeatureTestCaseTest.php proves the failure.
 */
abstract class AppFeatureTestCase extends TestCase
{
    use DatabaseTransactions;

    /**
     * Password of every account made by makeUser(). Obviously fake; a mirror of TEST_PASSWORD in
     * server/test/support/fixtures.js, kept equal by tests/Unit/AppFeatureTestCaseTest.php
     * (tests/Unit/PasswordPolicyTest.php checks that it is not on the common-password list).
     */
    public const TEST_PASSWORD = 'Fixture-Only-Pass-2468';

    /** Appended to every failure: how to give these tests what they need. */
    public const HOW_TO_RUN = 'Database feature tests need MySQL 8.4 loaded from server/schema.sql: '
        .'set DB_CONNECTION=mysql plus DB_HOST, DB_PORT, DB_DATABASE, DB_USERNAME and DB_PASSWORD '
        .'(README.md, "Tests and checks").';

    /** Result of the schema check, made once per process: null = not checked yet, '' = fine. */
    private static ?string $schemaProblem = null;

    /**
     * The cache store of these tests: the database store the deploy runs (CACHE_STORE=database,
     * deploy/docker-compose.yml), so rate-limit counters and the two-factor failure count live in
     * the `cache` table of server/schema.sql, inside the test's transaction. phpunit.xml keeps the
     * array store for the tests without a database.
     */
    public const CACHE_STORE = 'database';

    /**
     * Builds the application with CACHE_STORE set to self::CACHE_STORE. The value must be in the
     * environment while the configuration loads: the rate limiter takes its store when the
     * application boots, so changing the config afterwards would not reach it.
     */
    protected function refreshApplication()
    {
        $saved = [getenv('CACHE_STORE'), $_ENV['CACHE_STORE'] ?? null, $_SERVER['CACHE_STORE'] ?? null];
        putenv('CACHE_STORE='.self::CACHE_STORE);
        $_ENV['CACHE_STORE'] = $_SERVER['CACHE_STORE'] = self::CACHE_STORE;

        try {
            parent::refreshApplication();
        } finally {
            $saved[0] === false ? putenv('CACHE_STORE') : putenv('CACHE_STORE='.$saved[0]);
            if ($saved[1] === null) {
                unset($_ENV['CACHE_STORE']);
            } else {
                $_ENV['CACHE_STORE'] = $saved[1];
            }
            if ($saved[2] === null) {
                unset($_SERVER['CACHE_STORE']);
            } else {
                $_SERVER['CACHE_STORE'] = $saved[2];
            }
        }
    }

    /**
     * Runs after the application is created and before the traits start the transaction, so a
     * missing or wrong database ends in this message rather than a driver error.
     */
    protected function setUpTraits()
    {
        $problem = self::$schemaProblem ??= self::appSchemaProblem();
        if ($problem !== '') {
            $this->fail($problem.' '.self::HOW_TO_RUN);
        }

        return parent::setUpTraits();
    }

    /** What is wrong with the test database, or '' when it is MySQL with the whole app schema. */
    private static function appSchemaProblem(): string
    {
        $connection = DB::connection();
        $driver = $connection->getDriverName();
        if ($driver !== 'mysql') {
            return "The test database connection uses the '{$driver}' driver, not 'mysql'.";
        }

        $expected = self::schemaTables();
        if ($expected === []) {
            return 'server/schema.sql declares no tables (or cannot be read), so the schema cannot be checked.';
        }

        try {
            $database = (string) $connection->selectOne('SELECT DATABASE() AS name')->name;
            $present = array_map(
                fn (object $row): string => strtolower((string) $row->name),
                $connection->select('SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE()'),
            );
        } catch (Throwable $e) {
            // Class and code only: a driver message is not repeated (it can carry connection details).
            return sprintf('Could not read the MySQL test database (%s, code %s).', class_basename($e), (string) $e->getCode());
        }

        $missing = array_values(array_diff($expected, $present));
        if ($missing !== []) {
            return sprintf(
                '%d of the %d tables in server/schema.sql are missing in database "%s" (%s).',
                count($missing),
                count($expected),
                $database,
                implode(', ', array_slice($missing, 0, 8)).(count($missing) > 8 ? ', ...' : ''),
            );
        }

        return '';
    }

    /** Table names declared in server/schema.sql (the source of truth), lower-case. */
    public static function schemaTables(): array
    {
        $path = dirname(__DIR__, 2).'/server/schema.sql';
        $sql = is_file($path) ? (string) file_get_contents($path) : '';
        preg_match_all('/^\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?(\w+)`?/mi', $sql, $m);

        return array_values(array_unique(array_map('strtolower', $m[1])));
    }

    /**
     * A throw-away account written straight to the database (no route, no word filter). The
     * username is redrawn until the word filter accepts it, so a later rename or profile check
     * never fails on a random letter combination.
     */
    protected function makeUser(array $attributes = []): User
    {
        $username = $attributes['username'] ?? self::freeUsername('feature');

        $user = new User;
        $user->forceFill(array_merge([
            'name' => 'Feature Test',
            'username' => $username,
            'email' => $username.'@example.invalid',
            'password' => self::TEST_PASSWORD,
            'account_type' => 'standard',
        ], $attributes));
        $user->save();

        return $user->fresh();
    }

    /**
     * The consent fields a sign-up must send (F-14): the current terms version and the confirmed
     * minimum age, from shared/legal.json as the app sends them (registrationConsent() in
     * src/domain/legal.ts). Tests of POST /api/register merge them into their payloads.
     */
    protected static function consent(): array
    {
        return ['terms_version' => Legal::termsVersion(), 'confirmed_min_age' => Legal::minAge()];
    }

    /** A random username after $prefix that the word filter accepts. */
    protected static function freeUsername(string $prefix): string
    {
        for ($try = 0; $try < 20; $try++) {
            $candidate = $prefix.Str::lower(Str::random(12));
            if (BlockedTerms::default()->find($candidate, 'username') === null) {
                return $candidate;
            }
        }

        throw new RuntimeException("no username after '{$prefix}' passed the word filter in 20 draws");
    }

    /**
     * A Sanctum token for $user, as the app gets it from the login routes; returns the bearer
     * value. It expires in a day unless the test passes another time, or null for no expiry.
     */
    protected function issueToken(User $user, ?DateTimeInterface $expiresAt = new DateTimeImmutable('+1 day')): string
    {
        return $user->createToken('test', ['*'], $expiresAt)->plainTextToken;
    }

    /**
     * Sends the next requests with this bearer token. Sanctum's guard remembers the user of the
     * previous request in the same test; forgetting the guards makes every request look the
     * token up again (a revoked token must not stay valid by accident).
     */
    protected function withBearer(string $token): static
    {
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }
}
