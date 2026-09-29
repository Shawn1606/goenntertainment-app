<?php

namespace App\Http\Controllers;

use App\Support\Gamification;
use App\Support\Media;
use App\Support\Streak;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Fortschritt und Rangliste.
 *
 * Level, Titel, Abzeichen und die Serie berechnet die APP aus diesen Zahlen
 * selbst (src/domain/gamification.ts bzw. src/domain/streak.ts), damit die
 * Anzeige sofort reagiert und die Regeln testbar an einer Stelle liegen. Hier
 * stehen nur die Kennzahlen.
 */
class ProgressController extends Controller
{
    /** Wie viele Plaetze die Rangliste maximal zeigt. */
    private const LEADERBOARD_LIMIT = 50;

    /**
     * Kennzahlen je Konto als Unterabfrage:
     *  hosted  = selbst erstellte Events
     *  joined  = Events, bei denen man dabei ist (das eigene zaehlt mit)
     *  variety = wie viele verschiedene Kategorien dabei vorkamen
     *
     * Bewusst als SQL und nicht ueber den Query Builder zusammengesetzt: Es sind
     * drei zusammenhaengende Unterabfragen, und in dieser Form ist nachlesbar,
     * was gezaehlt wird. Der Platzhalter nimmt zusaetzliche Nutzerspalten auf
     * (fuer die Rangliste).
     */
    private function statsQuery(string $columns = ''): string
    {
        return "
            SELECT {$columns}
                   (SELECT COUNT(*) FROM activities a WHERE a.user_id = u.id) AS hosted,
                   (SELECT COUNT(*) FROM activity_user au WHERE au.user_id = u.id) AS joined,
                   (SELECT COUNT(DISTINCT ai.interest_id)
                      FROM activity_user au2
                      JOIN activity_interest ai ON ai.activity_id = au2.activity_id
                     WHERE au2.user_id = u.id) AS variety
              FROM users u
        ";
    }

    /** XP-Formel auf den Alias-Spalten der Kennzahlen-Abfrage. */
    private function xpExpression(): string
    {
        return Gamification::xpSqlExpression([
            'hosted' => 'hosted',
            'joined' => 'joined',
            'distinctInterests' => 'variety',
        ]);
    }

    private function toStats(object $row): array
    {
        return [
            'hosted' => (int) $row->hosted,
            'joined' => (int) $row->joined,
            'distinctInterests' => (int) $row->variety,
        ];
    }

    private function statsFor(int $userId): array
    {
        $row = DB::selectOne($this->statsQuery().' WHERE u.id = ?', [$userId]);

        return $row === null ? Gamification::emptyStats() : $this->toStats($row);
    }

    /** GET /api/me/progress (geschuetzt) */
    public function progress(Request $request): JsonResponse
    {
        $user = $request->user();

        /**
         * Diesen Aufruf macht die App bei jedem Blick auf die Startseite - er ist
         * damit der ehrlichste Zeitpunkt fuer „heute war jemand da". `day` ist das
         * lokale Datum des Geraets; fehlt es, nimmt der Server sein eigenes. Erst
         * markieren, dann lesen, damit der heutige Tag sofort mitzaehlt.
         *
         * Scheitert das Markieren, ist das kein Grund, den Fortschritt zu
         * verweigern - dann fehlt eben ein Tag in der Serie.
         */
        try {
            Streak::markActiveDay($user->id, $request->query('day'));
        } catch (\Throwable) {
            // bewusst still
        }

        $stats = $this->statsFor($user->id);

        try {
            $activeDates = Streak::activeDaysFor($user->id);
        } catch (\Throwable) {
            $activeDates = [];
        }

        return response()->json([
            'stats' => $stats,
            'xp' => Gamification::xpFromStats($stats),
            'activeDates' => $activeDates,
        ]);
    }

    /** GET /api/leaderboard (geschuetzt) - Top-Liste nach XP + eigene Position. */
    public function leaderboard(Request $request): JsonResponse
    {
        $user = $request->user();
        $xp = $this->xpExpression();

        $rows = DB::select(
            "SELECT id, name, username, avatar, hosted, joined, variety, {$xp} AS xp
               FROM ({$this->statsQuery('u.id, u.name, u.username, u.avatar,')}) AS s
              ORDER BY xp DESC, id ASC
              LIMIT ?",
            [self::LEADERBOARD_LIMIT],
        );

        $data = [];
        foreach ($rows as $index => $row) {
            $data[] = [
                'rank' => $index + 1,
                'xp' => (int) $row->xp,
                'stats' => $this->toStats($row),
                'user' => [
                    'id' => $row->id,
                    'name' => $row->name,
                    'username' => $row->username,
                    'avatar' => Media::url($row->avatar, $request),
                ],
            ];
        }

        // Eigene Position: aus der Top-Liste, sonst zaehlen, wie viele davor liegen.
        $me = null;
        foreach ($data as $entry) {
            if ($entry['user']['id'] === $user->id) {
                $me = $entry;
                break;
            }
        }

        if ($me === null) {
            $stats = $this->statsFor($user->id);
            $ownXp = Gamification::xpFromStats($stats);

            $ahead = DB::selectOne(
                "SELECT COUNT(*) AS c FROM ({$this->statsQuery('u.id,')}) AS s WHERE {$xp} > ?",
                [$ownXp],
            );

            $me = [
                'rank' => (int) ($ahead->c ?? 0) + 1,
                'xp' => $ownXp,
                'stats' => $stats,
                'user' => [
                    'id' => $user->id,
                    'name' => $user->name,
                    'username' => $user->username,
                    'avatar' => Media::url($user->avatar, $request),
                ],
            ];
        }

        return response()->json(['data' => $data, 'me' => $me]);
    }
}
