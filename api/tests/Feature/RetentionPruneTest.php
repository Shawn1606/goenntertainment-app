<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\Retention;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use RuntimeException;
use Tests\AppFeatureTestCase;

/**
 * The retention prune (F-16, App\Support\Retention, `php artisan retention:prune`): the port of
 * the Node server's prune (server/test/retention.test.js), which the deploy no longer runs. Each
 * test empties the pruned tables inside its own transaction, so the counts are exact.
 */
class RetentionPruneTest extends AppFeatureTestCase
{
    private const LIFETIME_MINUTES = 60 * 24 * 30;

    private User $user;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('private');
        Storage::fake('public');
        foreach (['personal_access_tokens', 'two_factor_challenges', 'password_reset_tokens', 'cache', 'cache_locks', 'ban_evidence'] as $table) {
            DB::table($table)->delete();
        }
        if (DB::getSchemaBuilder()->hasTable('moderation_reports')) {
            DB::table('moderation_reports')->delete();
        }
        $this->user = $this->makeUser();
    }

    private function token(?string $expiresAt, ?string $createdAt): int
    {
        return DB::table('personal_access_tokens')->insertGetId([
            'tokenable_type' => $this->user->getMorphClass(),
            'tokenable_id' => $this->user->id,
            'name' => 'retention-test',
            'token' => hash('sha256', Str::random(40)),
            'abilities' => '["*"]',
            'expires_at' => $expiresAt,
            'created_at' => $createdAt,
            'updated_at' => $createdAt,
        ]);
    }

    private static function ago(int $days, int $minutes = 0): string
    {
        return now()->subDays($days)->subMinutes($minutes)->toDateTimeString();
    }

    private static function stored(string $folder = 'evidence', string $ext = 'png'): string
    {
        return $folder.'/'.bin2hex(random_bytes(20)).'.'.$ext;
    }

    /** An evidence row created `$days` ago showing `$path`; its file exists on the private disk. */
    private function evidence(int $days, ?string $path): int
    {
        if ($path !== null) {
            Storage::disk('private')->put($path, 'evidence bytes');
        }

        return DB::table('ban_evidence')->insertGetId([
            'user_id' => $this->user->id,
            'action' => 'ban',
            'reason' => 'Fixture reason',
            'image_path' => $path,
            'created_at' => self::ago($days),
        ]);
    }

    private function prune(int $evidenceDays = 30, int $tokenDays = 7): array
    {
        return Retention::prune($evidenceDays, $tokenDays, self::LIFETIME_MINUTES);
    }

    public function test_without_settings_outside_production_nothing_is_pruned(): void
    {
        config(['retention.evidence_days' => null, 'retention.token_days' => null]);
        $this->assertNull(Retention::settings());

        $this->token(self::ago(400), self::ago(430));
        Artisan::call('retention:prune');

        $this->assertStringContainsString('nothing was deleted', Artisan::output());
        $this->assertSame(1, DB::table('personal_access_tokens')->count());
    }

    public function test_production_refuses_a_missing_or_malformed_setting_and_names_it_only(): void
    {
        $this->app->detectEnvironment(fn () => 'production');
        $cases = [
            [null, null, ['EVIDENCE_RETENTION_DAYS', 'TOKEN_RETENTION_DAYS']],
            ['30', null, ['TOKEN_RETENTION_DAYS']],
            ['0', '7', ['EVIDENCE_RETENTION_DAYS']],
            ['30', '7d', ['TOKEN_RETENTION_DAYS']],
            ['-1', '1.5', ['EVIDENCE_RETENTION_DAYS', 'TOKEN_RETENTION_DAYS']],
            ['123456', '7', ['EVIDENCE_RETENTION_DAYS']],
        ];
        foreach ($cases as [$evidence, $token, $named]) {
            config(['retention.evidence_days' => $evidence, 'retention.token_days' => $token]);
            try {
                Retention::settings();
                $this->fail("accepted evidence={$evidence} token={$token}");
            } catch (RuntimeException $e) {
                foreach (array_keys(Retention::SETTINGS) as $name) {
                    $this->assertSame(in_array($name, $named, true), str_contains($e->getMessage(), $name), $e->getMessage());
                }
                foreach ([$evidence, $token] as $value) {
                    if ($value !== null && strlen($value) > 2) {
                        $this->assertStringNotContainsString($value, $e->getMessage());
                    }
                }
            }
        }

        config(['retention.evidence_days' => ' 30 ', 'retention.token_days' => '1']);
        $this->assertSame(['evidence_days' => 30, 'token_days' => 1], Retention::settings());
    }

    public function test_tokens_go_retention_days_after_expiry_or_after_the_lifetime(): void
    {
        $gone = [
            $this->token(self::ago(8), self::ago(9)),            // expired 8 days ago
            $this->token(null, self::ago(38)),                    // 30-day lifetime + 8 days, no expires_at
            $this->token(self::ago(-1), self::ago(38)),           // the lifetime rule wins over a later expires_at
        ];
        $kept = [
            $this->token(self::ago(6), self::ago(7)),             // expired 6 days ago: within the 7 days
            $this->token(null, self::ago(36)),                    // lifetime + 6 days
            $this->token(self::ago(-5), self::ago(1)),            // valid
            $this->token(null, null),                             // age unknown
        ];

        $counts = $this->prune();

        $this->assertSame(count($gone), $counts['tokens']);
        $this->assertSame([], DB::table('personal_access_tokens')->whereIn('id', $gone)->pluck('id')->all());
        $this->assertSame(count($kept), DB::table('personal_access_tokens')->whereIn('id', $kept)->count());
    }

    public function test_challenges_reset_rows_and_expired_cache_rows_go_after_their_time(): void
    {
        $challenge = fn (string $expiresAt) => DB::table('two_factor_challenges')->insertGetId([
            'user_id' => $this->user->id,
            'token_hash' => hash('sha256', Str::random(40)),
            'purpose' => 'login',
            'expires_at' => $expiresAt,
            'created_at' => $expiresAt,
        ]);
        $oldChallenge = $challenge(self::ago(8));
        $youngChallenge = $challenge(self::ago(6));
        DB::table('password_reset_tokens')->insert([
            ['email' => 'old@example.invalid', 'token' => 'x', 'created_at' => self::ago(8)],
            ['email' => 'young@example.invalid', 'token' => 'x', 'created_at' => self::ago(6)],
            ['email' => 'unknown@example.invalid', 'token' => 'x', 'created_at' => null],
        ]);
        $now = time();
        DB::table('cache')->insert([
            ['key' => 'old', 'value' => 'x', 'expiration' => $now - Retention::CACHE_EXPIRED_GRACE_SECONDS - 60],
            ['key' => 'grace', 'value' => 'x', 'expiration' => $now - 60],
            ['key' => 'live', 'value' => 'x', 'expiration' => $now + 600],
        ]);
        DB::table('cache_locks')->insert([
            ['key' => 'old', 'owner' => 'x', 'expiration' => $now - Retention::CACHE_EXPIRED_GRACE_SECONDS - 60],
            ['key' => 'live', 'owner' => 'x', 'expiration' => $now + 600],
        ]);

        $counts = $this->prune();

        $this->assertSame(1, $counts['twoFactorChallenges']);
        $this->assertSame([$youngChallenge], DB::table('two_factor_challenges')->pluck('id')->all());
        $this->assertNotContains($oldChallenge, DB::table('two_factor_challenges')->pluck('id')->all());
        $this->assertSame(1, $counts['resetLinks']);
        $this->assertSame(['unknown@example.invalid', 'young@example.invalid'], DB::table('password_reset_tokens')->orderBy('email')->pluck('email')->all());
        $this->assertSame([1, 1], [$counts['cacheRows'], $counts['cacheLocks']]);
        $this->assertSame(['grace', 'live'], DB::table('cache')->orderBy('key')->pluck('key')->all());
        $this->assertSame(['live'], DB::table('cache_locks')->pluck('key')->all());
    }

    public function test_old_evidence_images_go_with_their_file_and_a_shared_file_waits(): void
    {
        $old = $this->evidence(31, $oldPath = self::stored());
        $young = $this->evidence(29, $youngPath = self::stored());
        // One file shown by an old and a young row: the old row loses it, the file stays.
        $shared = self::stored();
        $oldShared = $this->evidence(40, $shared);
        $youngShared = $this->evidence(2, $shared);

        $counts = $this->prune();

        $this->assertSame(2, $counts['evidenceImages']);
        $this->assertSame(1, $counts['filesRemoved']);
        $this->assertSame(0, $counts['filesFailed']);
        $this->assertNull(DB::table('ban_evidence')->where('id', $old)->value('image_path'), 'the row stays, without its image');
        $this->assertNull(DB::table('ban_evidence')->where('id', $oldShared)->value('image_path'));
        $this->assertSame(4, DB::table('ban_evidence')->count());
        Storage::disk('private')->assertMissing($oldPath);
        Storage::disk('private')->assertExists($youngPath);
        Storage::disk('private')->assertExists($shared);
        $this->assertSame($youngPath, DB::table('ban_evidence')->where('id', $young)->value('image_path'));
        $this->assertSame($shared, DB::table('ban_evidence')->where('id', $youngShared)->value('image_path'));
    }

    public function test_the_sweep_removes_old_evidence_files_no_row_shows_and_nothing_else(): void
    {
        $disk = Storage::disk('private');
        $aged = fn (string $path, int $days) => touch($disk->path($path), time() - $days * 86400);

        $orphan = self::stored();
        $disk->put($orphan, 'x');
        $aged($orphan, 31);
        $youngOrphan = self::stored();
        $disk->put($youngOrphan, 'x');
        $aged($youngOrphan, 29);
        $shown = self::stored();
        $this->evidence(1, $shown);
        $aged($shown, 31);
        $foreign = 'evidence/notes.txt';
        $disk->put($foreign, 'x');
        $aged($foreign, 400);
        // A link under a stored name is no plain file: left alone.
        $link = self::stored();
        symlink($disk->path($youngOrphan), $disk->path($link));

        $counts = $this->prune();

        $this->assertSame(1, $counts['filesRemoved']);
        $disk->assertMissing($orphan);
        foreach ([$youngOrphan, $shown, $foreign] as $path) {
            $disk->assertExists($path);
        }
        $this->assertTrue(is_link($disk->path($link)), 'the link was removed');
    }

    public function test_the_command_prints_counts_only(): void
    {
        config(['retention.evidence_days' => '30', 'retention.token_days' => '7']);
        $this->token(self::ago(8), self::ago(9));
        $this->evidence(31, $path = self::stored());

        $this->assertSame(0, Artisan::call('retention:prune'));
        $output = trim(Artisan::output());

        $this->assertMatchesRegularExpression('/^Retention prune: '.implode(' ', array_map(fn ($k) => $k.'=\d+', Retention::COUNTS)).'$/', $output);
        $this->assertStringContainsString('tokens=1 ', $output);
        $this->assertStringContainsString('evidenceImages=1 ', $output);
        $this->assertStringNotContainsString(basename($path), $output);
    }

    public function test_the_schedule_runs_the_prune_every_hour_without_overlapping(): void
    {
        $events = collect($this->app->make(Schedule::class)->events())
            ->filter(fn ($event) => str_contains((string) $event->command, 'retention:prune'));

        $this->assertCount(1, $events);
        $this->assertSame('0 * * * *', $events->first()->expression);
        $this->assertTrue($events->first()->withoutOverlapping);
    }
}
