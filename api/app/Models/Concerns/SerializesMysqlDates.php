<?php

namespace App\Models\Concerns;

use DateTimeInterface;

/**
 * Datums-Felder als 'YYYY-MM-DD HH:MM:SS' ausliefern - nicht als ISO-8601.
 *
 * ## Warum gegen die Laravel-Vorgabe
 *
 * Das vorige Backend las die Spalten mit `dateStrings: true` (siehe
 * server/src/db.js) und reichte sie ROH durch. Die App bekommt seit Monaten
 * `"2026-07-23 14:12:05"` und ist darauf eingestellt. Carbon serialisiert von
 * Haus aus `"2026-07-23T14:12:05.000000Z"` - ein anderer String, sechs Stellen
 * Mikrosekunden inklusive.
 *
 * Beides parst `new Date(...)` in JavaScript, aber nicht jede Stelle in der App
 * parst: Wo Datumsangaben verglichen, zugeschnitten oder als Schluessel benutzt
 * werden, waere der Wechsel ein stiller Bruch. Also bleibt das Format, das die
 * App kennt - die Umstellung des Backends soll an der API NICHTS aendern.
 *
 * Die Werte stehen in der DB in UTC, und `app.timezone` ist UTC: Was hier
 * herauskommt, ist derselbe Zeitpunkt wie zuvor, nur anders geschrieben.
 *
 * Wo das vorige Backend AUSDRUECKLICH ISO lieferte (`toIso()` in db.js, etwa an
 * Aktivitaeten), formatiert der jeweilige Controller das weiterhin selbst.
 */
trait SerializesMysqlDates
{
    protected function serializeDate(DateTimeInterface $date): string
    {
        return $date->format('Y-m-d H:i:s');
    }
}
