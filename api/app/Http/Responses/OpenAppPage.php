<?php

namespace App\Http\Responses;

use Illuminate\Http\Response;

/**
 * Die kleine Seite hinter den Adressen auf Aufklebern und Einladungslinks (routes/web.php).
 *
 * Sie bringt ihr Aussehen als <style> im Kopf mit. Die Kante setzt auf jede Antwort ohne eigene
 * Richtlinie `default-src 'none'` (deploy/Caddyfile, F-30) - damit stuende die Seite ohne Stil
 * da. Deshalb schickt sie ihre eigene: genau das eingebettete CSS, sonst nichts (kein Skript,
 * kein Bild, kein Formular, in keinem Rahmen).
 */
final class OpenAppPage
{
    public const CSP = "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

    public static function make(string $title, string $line, string $deepLink): Response
    {
        return response()
            ->view('open-app', ['title' => $title, 'line' => $line, 'deepLink' => $deepLink])
            ->header('Content-Security-Policy', self::CSP);
    }
}
