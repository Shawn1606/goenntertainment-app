<?php

namespace App\Support;

use Illuminate\Http\Request;

/**
 * Adressen fuer Bilder, die unter storage/ liegen.
 *
 * Warum das eine eigene Stelle ist: In `users.avatar` stehen ZWEI Sorten Werte.
 * Google-Konten bringen eine fremde, absolute URL mit
 * (lh3.googleusercontent.com/...), selbst hochgeladene Bilder liegen als
 * relativer Pfad in der DB ('avatars/ab12cd.jpg'). Beide muessen in der Antwort
 * als fertige Adresse ankommen - die App setzt sie unveraendert in ein <Image>.
 *
 * Und warum ueberhaupt der relative Pfad? Weil die absolute Adresse dieses
 * Servers sich AENDERT: In der Entwicklung ist es die WLAN-IP des Rechners
 * (siehe src/constants/config.ts in der App), in Produktion PUBLIC_URL. Stuende
 * die Volladresse in der DB, zeigten alle Profilbilder nach dem naechsten
 * IP-Wechsel ins Nichts. Der Pfad bleibt richtig, die Adresse entsteht bei jeder
 * Antwort neu.
 */
class Media
{
    /** Basis fuer oeffentliche Datei-Adressen. */
    public static function base(?Request $request = null): string
    {
        $configured = config('app.public_url');

        if (is_string($configured) && $configured !== '') {
            return rtrim($configured, '/');
        }

        return ($request ?? request())->getSchemeAndHttpHost();
    }

    /**
     * Volle Adresse fuer einen gespeicherten Pfad.
     *
     * Fremde URLs (Google-Avatare) bleiben unangetastet, `null` bleibt `null` -
     * so kann der Aufrufer den Wert bedenkenlos durchschleifen.
     */
    public static function url(?string $value, ?Request $request = null): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }

        if (preg_match('#^https?://#i', $value) === 1) {
            return $value;
        }

        return self::base($request).'/storage/'.$value;
    }
}
