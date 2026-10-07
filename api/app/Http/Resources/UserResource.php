<?php

namespace App\Http\Resources;

use App\Support\Format;
use App\Support\Media;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Ein Konto, wie es die API ausliefert.
 *
 * ## Warum hier nicht jedes Feld einzeln steht
 *
 * Die Antwort enthaelt ALLE Spalten der Tabelle ausser `password`,
 * `remember_token` und den Zwei-Faktor-Geheimnissen (die blendet das Model aus;
 * `two_factor_method` bleibt). Wuerde diese Klasse die Felder
 * aufzaehlen, muesste jede neue Spalte an zwei Stellen nachgetragen werden - und
 * beim Vergessen fehlt sie still in der App. Darum: alles nehmen, drei Felder
 * geradebiegen.
 *
 * Die Reihenfolge bleibt dabei die der Tabelle. Das ist kein Zufall, sondern das
 * Verhalten des vorigen Backends: Es ueberschrieb `is_admin`, `avatar` und
 * `banner` in einem bestehenden Objekt, und ein ersetzter Schluessel behaelt
 * seinen Platz - in JavaScript wie in PHP.
 *
 * `interests` kommt nur auf Wunsch dazu und immer zuletzt: Die Anmelde-Antworten
 * liefern sie mit.
 */
class UserResource extends JsonResource
{
    private bool $withInterests = false;

    public function withInterests(bool $value = true): static
    {
        $this->withInterests = $value;

        return $this;
    }

    public function toArray(Request $request): array
    {
        $data = parent::toArray($request);

        // Immer selbst bestimmen, ob die Kategorien mitkommen - waere die
        // Beziehung vom Aufrufer geladen, staende sie hier sonst ungefragt drin.
        unset($data['interests']);

        // Aus 0/1 der Datenbank ein echtes Ja/Nein.
        $data['is_admin'] = (bool) $this->is_admin;

        // Aus Pfaden fertige Adressen - fremde URLs (Google) bleiben, wie sie sind.
        $data['avatar'] = Media::url($this->avatar, $request);

        // Immer vorhanden, auch wenn Node die Spalte noch nicht nachgeruestet
        // hat: Die App fragt `two_factor_method` ab, und ein fehlender Schluessel
        // waere dort `undefined` statt „aus". Secret und Codes blendet das Model
        // aus (#[Hidden] in App\Models\User).
        $data['two_factor_method'] = $this->resource->two_factor_method ?? null;

        // Club-Stand fuer die Kopfzeile (Credits in der Mitte, Stufe am Bild).
        // Fehlt die Spalte noch (Datenbank vor der Migration), gilt Free mit 0.
        $data['club_plan'] = $this->resource->club_plan ?? 'free';
        $data['credits_balance'] = (int) ($this->resource->credits_balance ?? 0);
        $data['club_cancel_at_period_end'] = (bool) ($this->resource->club_cancel_at_period_end ?? false);
        // month | year (Jahresabo)
        $data['club_interval'] = $this->resource->club_interval ?? 'month';
        unset($data['club_credits_next_at']);
        foreach (['club_since', 'club_renews_at'] as $field) {
            $data[$field] = Format::iso($this->resource->{$field} ?? null);
        }

        // Darf dieses Konto im Partner-Modus scannen? Die App zeigt dann den Eintrag.
        $data['is_partner_staff'] = $this->resource->staffPartners()->exists();

        // Ueberbleibsel der alten Kontostufen - die App kennt sie nicht mehr.
        unset($data['account_type'], $data['granted_account_type'], $data['banner']);

        if ($this->withInterests) {
            $data['interests'] = $this->resource->interests()->get();
        }

        return $data;
    }
}
