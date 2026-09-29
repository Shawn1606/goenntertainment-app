<?php

namespace App\Support;

use Illuminate\Support\Facades\Hash;

/**
 * Passwoerter pruefen - ueber die Grenze zweier bcrypt-Umsetzungen hinweg.
 *
 * ## Das Problem, und warum es beinahe niemandem aufgefallen waere
 *
 * In `users.password` stehen drei Sorten bcrypt-Hashes, je nachdem, wer das Konto
 * angelegt hat:
 *
 *   $2y$  - vom fruehren Laravel-Backend (2 Konten)
 *   $2a$  - vom Node-Backend, das bcryptjs benutzte (14 Konten)
 *   $2b$  - moegliche Abwandlung derselben Bibliothek
 *
 * Alle drei sind DASSELBE Verfahren. Der Praefix ist Geschichte, nicht Technik: Er
 * wurde eingefuehrt, um eine behobene Eigenart im Umgang mit Zeichen jenseits von
 * ASCII zu kennzeichnen. bcryptjs rechnet richtig und schreibt trotzdem `$2a$`.
 *
 * PHP interessiert das nicht. `password_get_info()` erkennt AUSSCHLIESSLICH
 * `$2y$` als bcrypt; bei `$2a$` liefert es „unknown". Und Laravels `Hash::check()`
 * prueft das VOR dem Vergleichen und wirft dann:
 *
 *   RuntimeException: This password does not use the Bcrypt algorithm.
 *
 * Keine falsche Anmeldung, kein 422 - ein Serverfehler. Damit haette sich nach der
 * Umstellung fast niemand mehr anmelden koennen, und die Meldung haette in die
 * voellig falsche Richtung gezeigt: Das Passwort ist in Ordnung, der Hash ist in
 * Ordnung, nur der Praefix passt nicht zum Erwartungshorizont von PHP.
 *
 * Das vorige Backend hatte genau dieselbe Huerde in der anderen Richtung und loeste
 * sie genauso - es drehte `$2y$` zu `$2b$`, bevor es bcryptjs fragte (siehe
 * `checkPassword` in server/src/auth.js).
 *
 * Neue Passwoerter schreibt Laravel mit `$2y$`. Der Bestand wandert also von
 * selbst hinueber, sobald jemand sein Passwort aendert - diese Klasse bleibt
 * trotzdem noetig, solange ein einziger alter Hash existiert.
 */
class Passwords
{
    /**
     * Praefixe, die dasselbe Verfahren bezeichnen wie `$2y$`.
     *
     * `$2x$` steht mit dabei, weil es aus derselben Familie kommt; es taucht in
     * dieser Datenbank nicht auf, kostet hier aber nichts.
     */
    private const EQUIVALENT_PREFIXES = ['$2a$', '$2b$', '$2x$'];

    /**
     * Stimmt das Passwort zu diesem Hash?
     *
     * Ein Konto ohne Passwort (nur ueber Google angemeldet) kann sich nicht mit
     * einem anmelden - `false`, keine Ausnahme.
     */
    public static function check(string $plain, ?string $hash): bool
    {
        if ($hash === null || $hash === '') {
            return false;
        }

        return Hash::check($plain, self::normalize($hash));
    }

    /** Auf den Praefix umschreiben, den PHP als bcrypt akzeptiert. */
    public static function normalize(string $hash): string
    {
        foreach (self::EQUIVALENT_PREFIXES as $prefix) {
            if (str_starts_with($hash, $prefix)) {
                return '$2y$'.substr($hash, strlen($prefix));
            }
        }

        return $hash;
    }
}
