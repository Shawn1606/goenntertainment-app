<?php

namespace App\Support;

use Illuminate\Database\Query\Builder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use InvalidArgumentException;
use RuntimeException;

/**
 * The retention prune (F-16): deletes data that is no longer needed once it is older than the
 * operator's retention settings. A port of server/src/retention.js, which ran inside the Node
 * server; the deploy no longer runs Node, so Laravel's schedule runs this one every hour
 * (`php artisan retention:prune`, routes/console.php; the `scheduler` service of
 * deploy/docker-compose.yml).
 *
 * The settings (config/retention.php) are an operator decision without a default: required in
 * production (the compose refuses to start without them, and settings() refuses a missing or
 * malformed one), elsewhere both or none; none prunes nothing.
 *   EVIDENCE_RETENTION_DAYS  evidence images of bans and timeouts
 *   TOKEN_RETENTION_DAYS     sign-in tokens, the challenges (two-factor sign-in, reset, e-mail
 *                            change, first password) and the rows of the former reset links
 *
 * What goes (every comparison with this process's clock, which writes the rows; the day counts
 * come from the settings, never from a request):
 *   tokens               sign-in tokens TOKEN_RETENTION_DAYS after they stopped being valid:
 *                        after expires_at, or after the token lifetime (config sanctum.expiration)
 *                        counted from created_at - whichever the row says first;
 *   twoFactorChallenges  challenges TOKEN_RETENTION_DAYS after expires_at;
 *   resetLinks           rows of password_reset_tokens TOKEN_RETENTION_DAYS after they were written;
 *   cacheRows, cacheLocks  rows of the database cache and its locks that expired more than
 *                        CACHE_EXPIRED_GRACE_SECONDS ago (Laravel never deletes them itself; an
 *                        expired row is unused, so this needs no retention decision);
 *   evidenceImages       the image of a ban evidence row older than EVIDENCE_RETENTION_DAYS (the
 *                        row stays, image_path becomes NULL); also of an AI moderation report, in
 *                        a database from the Node era that still has moderation_reports;
 *   filesRemoved         those images' files once no row shows them any more, removed after each
 *                        batch; then every evidence file older than EVIDENCE_RETENTION_DAYS that
 *                        no row shows (the sweep, for files a stopped run or a failed removal
 *                        left behind);
 *   filesFailed          removals the file system refused; the sweep tries them again next run.
 * Rows without the timestamp a step compares (NULL) are left alone: their age is unknown.
 *
 * Not ported: the steps for the AI moderation reports and call counter, the event views and the
 * active days of the Node server (MODERATION_REPORT_RETENTION_DAYS, USAGE_RETENTION_DAYS). The
 * production schema (api/database/migrations) has none of those tables.
 *
 * The result holds counts only - never ids, names, paths or texts.
 */
final class Retention
{
    /** Rows per statement: a large backlog goes in steps, so no statement locks for long. */
    public const BATCH = 1000;

    /** Expired cache rows stay this long (a day), clear of rows Laravel may be reusing right now. */
    public const CACHE_EXPIRED_GRACE_SECONDS = 86400;

    /** The keys of the result, in the order the output shows them. */
    public const COUNTS = ['tokens', 'twoFactorChallenges', 'resetLinks', 'cacheRows', 'cacheLocks', 'evidenceImages', 'filesRemoved', 'filesFailed'];

    /** The settings, by name, and where config/retention.php keeps them. */
    public const SETTINGS = ['EVIDENCE_RETENTION_DAYS' => 'retention.evidence_days', 'TOKEN_RETENTION_DAYS' => 'retention.token_days'];

    /** Whole days, written as digits only (at most five), as the Node server accepted them. */
    private const DAYS_PATTERN = '/^\d{1,5}$/';

    /** The tables whose image_path holds evidence images. */
    private const EVIDENCE_TABLES = ['ban_evidence', 'moderation_reports'];

    /** The folder of the evidence images on the private disk (Uploads::PRIVATE_FOLDERS). */
    private const EVIDENCE_FOLDER = 'evidence';

    /** Evidence files the sweep checks against the database per query. */
    private const SWEEP_CHUNK = 500;

    /**
     * The settings as ['evidence_days' => int, 'token_days' => int], or null when neither is set
     * outside production (then nothing is pruned).
     *
     * @throws RuntimeException naming (never showing) each missing or malformed setting
     */
    public static function settings(): ?array
    {
        $raw = [];
        foreach (self::SETTINGS as $name => $key) {
            $raw[$name] = trim((string) config($key));
        }
        if (! app()->isProduction() && implode('', $raw) === '') {
            return null;
        }
        $bad = array_keys(array_filter($raw, fn (string $value) => preg_match(self::DAYS_PATTERN, $value) !== 1 || (int) $value < 1));
        if ($bad !== []) {
            throw new RuntimeException('Retention settings missing or invalid: '.implode(', ', $bad)
                .' (whole days, at least 1; required in production, elsewhere both or none; see deploy/.env.example).');
        }

        return ['evidence_days' => (int) $raw['EVIDENCE_RETENTION_DAYS'], 'token_days' => (int) $raw['TOKEN_RETENTION_DAYS']];
    }

    /**
     * Deletes what the settings say is no longer needed; returns the counts (COUNTS).
     *
     * @return array<string, int>
     */
    public static function prune(int $evidenceDays, int $tokenDays, int $tokenLifetimeMinutes): array
    {
        foreach (['evidenceDays' => $evidenceDays, 'tokenDays' => $tokenDays, 'tokenLifetimeMinutes' => $tokenLifetimeMinutes] as $name => $value) {
            if ($value < 1) {
                throw new InvalidArgumentException("Retention::prune: {$name} must be a whole number of at least 1");
            }
        }
        $counts = array_fill_keys(self::COUNTS, 0);
        $now = Carbon::now();
        $tokenCutoff = $now->copy()->subDays($tokenDays);

        $counts['tokens'] = self::deleteInBatches(fn () => DB::table('personal_access_tokens')
            ->where(fn (Builder $q) => $q
                ->where(fn (Builder $q) => $q->whereNotNull('expires_at')->where('expires_at', '<', $tokenCutoff))
                ->orWhere(fn (Builder $q) => $q->whereNotNull('created_at')
                    ->where('created_at', '<', $tokenCutoff->copy()->subMinutes($tokenLifetimeMinutes)))));
        $counts['twoFactorChallenges'] = self::deleteInBatches(fn () => DB::table('two_factor_challenges')
            ->where('expires_at', '<', $tokenCutoff));
        $counts['resetLinks'] = self::deleteInBatches(fn () => DB::table('password_reset_tokens')
            ->whereNotNull('created_at')->where('created_at', '<', $tokenCutoff));
        foreach (['cacheRows' => 'cache', 'cacheLocks' => 'cache_locks'] as $count => $table) {
            $counts[$count] = self::deleteInBatches(fn () => DB::table($table)
                ->where('expiration', '<', $now->getTimestamp() - self::CACHE_EXPIRED_GRACE_SECONDS));
        }

        // Images first; each batch's files go once no row shows them any more (a younger row may
        // still show the same file). Then the sweep.
        $files = ['removed' => 0, 'failed' => 0];
        $evidenceCutoff = $now->copy()->subDays($evidenceDays);
        foreach (self::EVIDENCE_TABLES as $table) {
            if (! Schema::hasTable($table)) {
                continue;
            }
            for (;;) {
                $rows = DB::table($table)
                    ->whereNotNull('image_path')
                    ->whereNotNull('created_at')->where('created_at', '<', $evidenceCutoff)
                    ->orderBy('id')->limit(self::BATCH)->get(['id', 'image_path']);
                if ($rows->isEmpty()) {
                    break;
                }
                DB::table($table)->whereIn('id', $rows->pluck('id')->all())->update(['image_path' => null]);
                self::add($files, StoredFiles::removeUnreferenced($rows->pluck('image_path')->all()));
                $counts['evidenceImages'] += $rows->count();
                if ($rows->count() < self::BATCH) {
                    break;
                }
            }
        }
        self::add($files, self::sweepEvidenceFiles($now->getTimestamp() - $evidenceDays * 86400));
        $counts['filesRemoved'] = $files['removed'];
        $counts['filesFailed'] = $files['failed'];

        return $counts;
    }

    /** "tokens=0 twoFactorChallenges=2 ...": the counts in COUNTS order. */
    public static function describe(array $counts): string
    {
        return implode(' ', array_map(fn (string $key) => $key.'='.(int) ($counts[$key] ?? 0), self::COUNTS));
    }

    /** Runs the query's DELETE with LIMIT BATCH until fewer rows go; returns the total. */
    private static function deleteInBatches(callable $query): int
    {
        $total = 0;
        do {
            $deleted = $query()->limit(self::BATCH)->delete();
            $total += $deleted;
        } while ($deleted === self::BATCH);

        return $total;
    }

    /**
     * The sweep: removes the evidence files older than the cutoff (their modification time; an
     * evidence file is never changed after it was stored) that no row shows. Rows alone cannot
     * find them any more once a step has cleared their image_path. Only names Uploads gives
     * (STORED_NAME) and only plain files count: a symbolic link is left alone.
     *
     * @return array{removed: int, failed: int}
     */
    private static function sweepEvidenceFiles(int $cutoff): array
    {
        $result = ['removed' => 0, 'failed' => 0];
        $dir = Storage::disk(Uploads::PRIVATE_DISK)->path(self::EVIDENCE_FOLDER);
        $names = is_dir($dir) ? scandir($dir) : false;
        if ($names === false) {
            return $result;
        }
        $aged = [];
        foreach ($names as $name) {
            if (preg_match(Uploads::STORED_NAME, $name) !== 1) {
                continue;
            }
            $info = @lstat($dir.DIRECTORY_SEPARATOR.$name);
            if ($info !== false && ($info['mode'] & 0170000) === 0100000 && $info['mtime'] < $cutoff) {
                $aged[] = self::EVIDENCE_FOLDER.'/'.$name;
            }
        }
        foreach (array_chunk($aged, self::SWEEP_CHUNK) as $chunk) {
            self::add($result, StoredFiles::removeUnreferenced($chunk));
        }

        return $result;
    }

    /** @param  array{removed: int, failed: int}  $into */
    private static function add(array &$into, array $more): void
    {
        $into['removed'] += $more['removed'];
        $into['failed'] += $more['failed'];
    }
}
