<?php

namespace App\Support;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;

/**
 * Ein Konto endgueltig loeschen - samt Daten UND Dateien. Portiert aus
 * server/src/account-deletion.js.
 *
 * Genutzt von der Selbst-Loeschung (DELETE /api/me) und dem Admin-Bereich.
 *
 * ## Was die Datenbank erledigt
 *
 * Fast alles: Was an `users` haengt, hat ON DELETE CASCADE bzw. SET NULL.
 * SET NULL steht absichtlich dort, wo etwas das Konto ueberdauern soll -
 * Meldungen, Buchungen (Abrechnung mit dem Partner), Zahlungen, Admin-Spalten.
 *
 * ## Was von Hand dazukommt
 *
 * Tokens (polymorph, ohne Fremdschluessel), Passwort-Links (haengen an der
 * E-Mail), Sitzungen - und die Dateien. Eine Datei wird nur geloescht, wenn
 * danach keine Spalte mehr auf sie zeigt.
 */
final class AccountDeletion
{
    /**
     * Alle Spalten, in denen ein Pfad unter storage/ stehen kann. Tabellen der
     * entfernten Funktionen (Beitraege, Storys, Aktivitaeten) stehen mit drin,
     * solange es sie in bestehenden Datenbanken noch gibt.
     */
    private const FILE_REFERENCES = [
        ['users', 'avatar'],
        ['users', 'banner'],
        ['ban_evidence', 'image_path'],
        ['moderation_reports', 'image_path'],
        ['posts', 'image_path'],
        ['stories', 'image_path'],
        ['activities', 'banner_path'],
        ['activity_history', 'banner_path'],
    ];

    /** @return 'deleted'|'last_admin' */
    public static function delete(User $user, bool $refuseLastAdmin = false): string
    {
        $files = [];

        $result = DB::transaction(function () use ($user, $refuseLastAdmin, &$files) {
            if ($refuseLastAdmin && $user->is_admin) {
                $others = User::where('is_admin', true)->whereKeyNot($user->getKey())->lockForUpdate()->exists();
                if (! $others) {
                    return 'last_admin';
                }
            }

            $files = array_merge(
                [$user->avatar, $user->banner],
                self::column('ban_evidence', 'image_path', $user->getKey()),
                self::column('posts', 'image_path', $user->getKey()),
                self::column('stories', 'image_path', $user->getKey()),
                self::column('activities', 'banner_path', $user->getKey()),
            );

            DB::table('personal_access_tokens')->where('tokenable_id', $user->getKey())->delete();
            DB::table('password_reset_tokens')->where('email', $user->email)->delete();
            if (Schema::hasTable('sessions')) {
                DB::table('sessions')->where('user_id', $user->getKey())->delete();
            }
            DB::table('users')->where('id', $user->getKey())->delete();

            return 'deleted';
        });

        if ($result !== 'deleted') {
            return $result;
        }

        // Dateien erst NACH dem Commit: Kippt die Transaktion, zeigt das Konto
        // weiter auf Bilder, die es noch gibt.
        foreach (array_unique(array_filter($files, [self::class, 'isStoredFile'])) as $file) {
            if (! self::stillReferenced($file)) {
                Storage::disk('public')->delete($file);
            }
        }

        return 'deleted';
    }

    /** @return list<string> */
    private static function column(string $table, string $column, int $userId): array
    {
        if (! Schema::hasTable($table)) {
            return [];
        }

        return DB::table($table)->where('user_id', $userId)->whereNotNull($column)->pluck($column)->all();
    }

    private static function isStoredFile(mixed $value): bool
    {
        // Fremde Adressen (Google-Avatare) und Pfade mit „.." fasst das nicht an.
        return is_string($value) && $value !== '' && preg_match('#^https?://#i', $value) !== 1 && ! str_contains($value, '..');
    }

    private static function stillReferenced(string $file): bool
    {
        foreach (self::FILE_REFERENCES as [$table, $column]) {
            if (Schema::hasTable($table) && Schema::hasColumn($table, $column)
                && DB::table($table)->where($column, $file)->exists()) {
                return true;
            }
        }

        return false;
    }
}
