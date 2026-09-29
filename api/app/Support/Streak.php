<?php

namespace App\Support;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * Aktive Tage - die Datengrundlage der Serie („Streak").
 *
 * Diese Klasse zaehlt nur mit. Was daraus eine Serie wird (Laenge, Rekord,
 * „laeuft heute ab") rechnet die App in src/domain/streak.ts, dort ist es auch
 * getestet. Gleiches Muster wie bei den XP: Der Server liefert Zahlen, die App
 * deutet sie - so reagiert die Anzeige sofort und die Regeln liegen an einer
 * Stelle.
 *
 * Wichtig fuer die Fairness: Aktive Tage geben KEINE XP und aendern die Rangliste
 * nicht. Sonst koennte man sich durch blosses Oeffnen der App nach oben klicken,
 * ohne jemals jemanden getroffen zu haben.
 */
class Streak
{
    /** Wie weit zurueck Tage ausgeliefert werden (deckt jede sinnvolle Anzeige ab). */
    public const ACTIVE_DAYS_WINDOW = 120;

    /** Nur ein wohlgeformtes `YYYY-MM-DD` durchlassen (kommt vom Client!). */
    public static function safeDay(mixed $value): ?string
    {
        return (is_string($value) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $value) === 1)
            ? $value
            : null;
    }

    /**
     * Haelt fest, dass `$userId` an `$dayHint` aktiv war.
     *
     * `$dayHint` ist das LOKALE Datum des Geraets. Fehlt es, nehmen wir das
     * UTC-Datum des Servers - dann kann ein Tag an der Mitternachtsgrenze um eins
     * verrutschen, was fuer eine Serie verkraftbar ist.
     *
     * ## Was hier gegenueber dem Vorgaenger fehlt
     *
     * Das Node-Backend merkte sich im Arbeitsspeicher, fuer wen es heute schon
     * geschrieben hatte, und sparte so einen Schreibvorgang pro Anfrage. Das ging
     * nur, weil dort EIN Prozess dauerhaft lief. PHP beginnt jede Anfrage von
     * vorn - eine solche Notiz waere immer leer. Sie durch den Cache zu ersetzen
     * brachte nichts: Der Cache liegt in derselben Datenbank, ein Cache-Eintrag
     * waere also genau der Schreibvorgang, den er vermeiden soll.
     *
     * Bleibt das INSERT, und das ist billig: `day = day` ist ein absichtlicher
     * Leerlauf, der aus dem Einfuegen ein „gibt es schon? dann nichts tun" macht,
     * ohne vorher zu lesen.
     */
    public static function markActiveDay(int $userId, mixed $dayHint = null): void
    {
        $day = self::safeDay($dayHint) ?? CarbonImmutable::now('UTC')->format('Y-m-d');

        DB::statement(
            'INSERT INTO user_active_days (user_id, day) VALUES (?, ?)
             ON DUPLICATE KEY UPDATE day = day',
            [$userId, $day],
        );
    }

    /** Die aktiven Tage der letzten ACTIVE_DAYS_WINDOW Tage, neueste zuerst. */
    public static function activeDaysFor(int $userId): array
    {
        $rows = DB::select(
            "SELECT DATE_FORMAT(day, '%Y-%m-%d') AS day
               FROM user_active_days
              WHERE user_id = ? AND day >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
              ORDER BY day DESC",
            [$userId, self::ACTIVE_DAYS_WINDOW],
        );

        return array_map(static fn (object $row): string => $row->day, $rows);
    }

    /**
     * Einmaliges Nachtragen fuer Konten, die es vor der Serie schon gab.
     *
     * Ohne das startet jede:r bei 0, obwohl die App seit Wochen benutzt wird - das
     * faende zu Recht niemand gut. Wir leiten die Tage aus den Spuren ab, die es
     * ohnehin gibt: erstellte Events, Beitritte, angesehene Events. Laeuft nur,
     * solange die Tabelle leer ist, und ist danach ein billiges LIMIT-1-SELECT.
     */
    public static function backfillActiveDays(): int
    {
        if (DB::selectOne('SELECT 1 AS ok FROM user_active_days LIMIT 1') !== null) {
            return 0;
        }

        return DB::affectingStatement("
            INSERT IGNORE INTO user_active_days (user_id, day)
            SELECT user_id, day FROM (
              SELECT user_id, DATE(created_at) AS day FROM activities     WHERE created_at IS NOT NULL
              UNION
              SELECT user_id, DATE(created_at) AS day FROM activity_user  WHERE created_at IS NOT NULL
              UNION
              SELECT user_id, DATE(created_at) AS day FROM activity_views WHERE created_at IS NOT NULL
            ) AS traces
            WHERE day IS NOT NULL
        ");
    }
}
