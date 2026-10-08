<?php

namespace App\Support;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Ein Konto endgueltig loeschen - samt Daten UND Dateien. Portiert aus
 * server/src/account-deletion.js, with that file's fixes.
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
 *   - the account's own events, deleted before the account row: with a single DELETE FROM users,
 *     MySQL 8.4 cascades to activities and to activity_history at once; the events' ON DELETE
 *     SET NULL then updates the host's own history rows, and InnoDB re-checks their user_id
 *     foreign key against the user row that is already being deleted (ER_NO_REFERENCED_ROW_2).
 *     Deleted first, the SET NULL runs while the user row still exists. The participants' history
 *     keeps title, place and date and loses only the picture, as when one event is deleted.
 *   - the AI moderation log of the account (`moderation_reports`): each row copies the person's
 *     own text and image, so the rows go with the account (their foreign key says SET NULL);
 *   - the account's own tokens (polymorph, ohne Fremdschluessel; only this model's), Passwort-
 *     Links (haengen an der E-Mail), Sitzungen;
 *   - die Dateien, public and private (App\Support\Uploads). Eine Datei wird nur geloescht, wenn
 *     danach keine Spalte mehr auf sie zeigt (App\Support\StoredFiles).
 */
final class AccountDeletion
{
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

            $id = $user->getKey();
            $eventIds = self::hasTable('activities')
                ? DB::table('activities')->where('user_id', $id)->pluck('id')->all()
                : [];
            $eventBanners = array_values(array_filter(array_merge(
                self::column('activities', 'banner_path', 'user_id', $id),
                // Auch Banner laengst geloeschter eigener Events: Sie stehen noch im Verlauf anderer.
                self::hasTable('activity_history')
                    ? DB::table('activity_history')->where('user_id', $id)->where('role', 'host')->whereNotNull('banner_path')->pluck('banner_path')->all()
                    : [],
            ), [StoredFiles::class, 'isStored']));

            $files = array_merge(
                [$user->avatar, $user->banner],
                self::column('ban_evidence', 'image_path', 'user_id', $id),
                self::column('moderation_reports', 'image_path', 'user_id', $id),
                self::column('posts', 'image_path', 'user_id', $id),
                self::column('stories', 'image_path', 'user_id', $id),
                $eventBanners,
            );

            if (self::hasTable('activity_history')) {
                // The participants' history: the removal starts as when one event is deleted (the
                // foreign key sets activity_id to NULL), and the event's picture goes.
                if ($eventIds !== []) {
                    DB::table('activity_history')->whereIn('activity_id', $eventIds)->whereNull('removed_at')
                        ->update(['removed_at' => now(), 'updated_at' => now()]);
                }
                if ($eventBanners !== []) {
                    DB::table('activity_history')->whereIn('banner_path', $eventBanners)
                        ->update(['banner_path' => null, 'updated_at' => now()]);
                }
            }
            if ($eventIds !== []) {
                DB::table('activities')->where('user_id', $id)->delete();
            }
            if (self::hasTable('moderation_reports')) {
                DB::table('moderation_reports')->where('user_id', $id)->delete();
            }

            DB::table('personal_access_tokens')
                ->where('tokenable_type', $user->getMorphClass())
                ->where('tokenable_id', $id)
                ->delete();
            DB::table('password_reset_tokens')->where('email', $user->email)->delete();
            if (self::hasTable('sessions')) {
                DB::table('sessions')->where('user_id', $id)->delete();
            }
            DB::table('users')->where('id', $id)->delete();

            return 'deleted';
        });

        if ($result !== 'deleted') {
            return $result;
        }

        // Dateien erst NACH dem Commit: Kippt die Transaktion, zeigt das Konto
        // weiter auf Bilder, die es noch gibt. Each goes only once no row shows it.
        StoredFiles::removeUnreferenced($files);

        return 'deleted';
    }

    /** @return list<string> */
    private static function column(string $table, string $column, string $key, int $userId): array
    {
        if (! self::hasTable($table)) {
            return [];
        }

        return DB::table($table)->where($key, $userId)->whereNotNull($column)->pluck($column)->all();
    }

    private static function hasTable(string $table): bool
    {
        return Schema::hasTable($table);
    }
}
