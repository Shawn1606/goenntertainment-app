<?php

namespace App\Rules;

use App\Support\BlockedTerms;
use Closure;
use Illuminate\Contracts\Validation\ValidationRule;

/**
 * Validierungsregel: Der Wert enthaelt keinen gesperrten Begriff.
 *
 *     'username' => ['bail', 'required', ..., new NoBlockedTerms('username')],
 *
 * Der Modus entscheidet, welche Gruppen der Liste gelten (siehe
 * shared/blocked-terms.json): 'username' ist am strengsten, 'name' laesst echte
 * Nachnamen wie „Fick" durch, 'text' laesst Geschichte („Doku ueber Hitler") durch.
 *
 * Die Meldung kommt aus derselben Datei wie in App und Node - die App zeigt sie
 * woertlich, und sie soll dort denselben Satz sehen, den sie vorab schon zeigt.
 *
 * Nicht-Texte uebergeht die Regel: Ob ein Feld Pflicht und ein String ist, sagen
 * `required`/`string` davor; mit `bail` kommt die Regel bei falschem Typ gar nicht
 * erst dran.
 */
final class NoBlockedTerms implements ValidationRule
{
    /**
     * @param  'username'|'name'|'text'  $mode
     * @param  BlockedTerms|null  $terms  Nur fuer Tests - sonst die Liste des Projekts.
     */
    public function __construct(
        private readonly string $mode,
        private readonly ?BlockedTerms $terms = null,
    ) {}

    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        if (! is_string($value)) {
            return;
        }

        $terms = $this->terms ?? BlockedTerms::default();

        if ($terms->find($value, $this->mode) !== null) {
            $fail($terms->message($this->mode));
        }
    }
}
