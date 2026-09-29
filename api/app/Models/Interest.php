<?php

namespace App\Models;

use App\Models\Concerns\SerializesMysqlDates;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

/**
 * Eine Kategorie ("Interesse") wie Basketball oder Comedy & Kabarett.
 *
 * `created_at`/`updated_at` und `pivot` sind versteckt, weil die API genau vier
 * Felder ausliefert - id, name, slug, icon. Ohne das `pivot` haenge an jedem
 * Interesse einer Person noch ein Objekt mit den Verknuepfungsspalten, das es in
 * der bisherigen Antwort nie gab.
 */
#[Hidden(['pivot', 'created_at', 'updated_at'])]
class Interest extends Model
{
    use SerializesMysqlDates;

    public function users(): BelongsToMany
    {
        return $this->belongsToMany(User::class, 'interest_user');
    }
}
