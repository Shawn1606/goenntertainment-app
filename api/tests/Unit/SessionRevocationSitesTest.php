<?php

namespace Tests\Unit;

use App\Support\Sessions;
use PHPUnit\Framework\TestCase;
use RecursiveDirectoryIterator;
use RecursiveIteratorIterator;

/**
 * A password sign-in writes its token only if the columns in Sessions::CREDENTIAL_COLUMNS still
 * hold what its password check saw (Sessions::issueIfUnchanged). That stops a sign-in under way
 * from outliving a revocation only if every change that revokes sessions writes one of those
 * columns first. This pins the list of those changes: every call of Sessions::revokeOthers or
 * Sessions::revokeAll in api/app, per file. A new call fails here until someone has checked that
 * its change writes a compared column before it revokes (or that its account signs in through a
 * challenge only), and has added it below and to the list in the Sessions class comment.
 *
 * Plain PHPUnit: it reads the source files of api/app.
 */
class SessionRevocationSitesTest extends TestCase
{
    /** File => calls, with the column each change writes before it revokes. */
    private const SITES = [
        // setPassword (both ways of updatePassword): `password`; confirmEmail: `email`.
        'app/Http/Controllers/AccountController.php' => 2,
        // afterChange, after switching two-factor sign-in on or off (`two_factor_method`) or new
        // recovery codes (a two-factor account: its sign-ins go through a challenge, ended first).
        'app/Http/Controllers/TwoFactorController.php' => 1,
        // reset: `password`.
        'app/Support/PasswordReset.php' => 1,
    ];

    public function test_the_compared_columns_are_the_ones_every_revoking_change_writes(): void
    {
        $this->assertSame(['password', 'email', 'two_factor_method'], Sessions::CREDENTIAL_COLUMNS);
    }

    public function test_every_call_that_revokes_sessions_is_listed(): void
    {
        $root = dirname(__DIR__, 2);
        $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root.'/app', RecursiveDirectoryIterator::SKIP_DOTS));

        $scanned = 0;
        $found = [];
        foreach ($iterator as $file) {
            if (! $file->isFile() || $file->getExtension() !== 'php') {
                continue;
            }
            $scanned++;
            $calls = preg_match_all('/\bSessions::revoke(?:Others|All)\s*\(/', (string) file_get_contents($file->getPathname()));
            if ($calls > 0) {
                $found[str_replace('\\', '/', substr($file->getPathname(), strlen($root) + 1))] = $calls;
            }
        }
        ksort($found);

        // Denominator: the whole of api/app was read.
        $this->assertGreaterThan(30, $scanned, "only {$scanned} files found under api/app");
        $this->assertSame(self::SITES, $found, "{$scanned} files scanned");
    }
}
