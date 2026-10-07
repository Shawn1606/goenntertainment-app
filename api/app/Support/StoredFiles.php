<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;

/**
 * Stored upload files and the rows that show them (App\Support\Uploads stores them). A file goes
 * only once no row shows it any more: the account deletion (AccountDeletion) and the retention
 * prune (Retention) both remove files through here.
 */
final class StoredFiles
{
    /**
     * Every column that can hold a path of a stored file. Tables of removed features (posts,
     * stories, events, the AI moderation log) are listed while databases from the Node era may
     * still have them; a table or column that does not exist is skipped.
     */
    public const REFERENCES = [
        ['users', 'avatar'],
        ['users', 'banner'],
        ['ban_evidence', 'image_path'],
        ['moderation_reports', 'image_path'],
        ['posts', 'image_path'],
        ['stories', 'image_path'],
        ['activities', 'banner_path'],
        ['activity_history', 'banner_path'],
        ['partners', 'logo_path'],
        ['partners', 'cover_path'],
        ['offers', 'image_path'],
    ];

    /** A path this app stored: not an outside address (old Google avatars), no "..". */
    public static function isStored(mixed $value): bool
    {
        return is_string($value) && $value !== '' && preg_match('#^https?://#i', $value) !== 1 && ! str_contains($value, '..');
    }

    /**
     * The paths among `$files` that a row still shows.
     *
     * @param  list<string>  $files
     * @return array<string, true>
     */
    public static function referencedAmong(array $files): array
    {
        $found = [];
        if ($files === []) {
            return $found;
        }
        foreach (self::REFERENCES as [$table, $column]) {
            if (! Schema::hasTable($table) || ! Schema::hasColumn($table, $column)) {
                continue;
            }
            foreach (DB::table($table)->whereIn($column, $files)->distinct()->pluck($column) as $path) {
                $found[$path] = true;
            }
        }

        return $found;
    }

    /**
     * Removes the files among `$files` that no row shows any more, each from its disk
     * (Uploads::diskFor). A file that is already gone counts as neither.
     *
     * @param  list<mixed>  $files
     * @return array{removed: int, failed: int}
     */
    public static function removeUnreferenced(array $files): array
    {
        $result = ['removed' => 0, 'failed' => 0];
        $stored = array_values(array_unique(array_filter($files, [self::class, 'isStored'])));
        $referenced = self::referencedAmong($stored);
        foreach ($stored as $file) {
            if (isset($referenced[$file])) {
                continue;
            }
            $disk = Storage::disk(Uploads::diskFor($file));
            if (! $disk->exists($file)) {
                continue;
            }
            $disk->delete($file) ? $result['removed']++ : $result['failed']++;
        }

        return $result;
    }
}
