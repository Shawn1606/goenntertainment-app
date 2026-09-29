<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Umlaute und Schraegstriche unverschluesselt ausliefern.
 *
 * PHP schreibt in JSON von Haus aus `"Theater & Bühne"`, JavaScript
 * `"Theater & Bühne"`. Fuer `JSON.parse` ist das dasselbe - die App merkt keinen
 * Unterschied. Zwei Gruende sprechen trotzdem dafuer, es umzustellen:
 *
 * Erstens die Groesse. Jeder Umlaut wird von zwei Bytes zu sechs. Bei Listen mit
 * hunderten Events - „Bühne", „Göttingen", „Frühstück" - sind das je Antwort
 * schnell einige Kilobyte, die ueber ein Mobilfunknetz gehen.
 *
 * Zweitens die Vergleichbarkeit. Solange das alte und das neue Backend
 * nebeneinander laufen, ist „Antwort zeichengleich" die Pruefung, mit der sich
 * jede Etappe absichern laesst. Verschluesselte Umlaute wuerden JEDE Antwort mit
 * einem deutschen Wort als abweichend melden - und damit genau die Pruefung
 * wertlos machen, die echte Fehler finden soll.
 *
 * Schraegstriche aus demselben Grund: `http:\/\/` waere gueltig, aber nicht das,
 * was bisher in den Bild-Adressen stand.
 *
 * Die durchgereichten Antworten des alten Servers beruehrt das nicht - die sind
 * keine JsonResponse, sondern schon fertiger Text.
 */
class UnescapedJsonResponses
{
    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);

        if ($response instanceof JsonResponse) {
            $response->setEncodingOptions(
                $response->getEncodingOptions() | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
            );
        }

        return $response;
    }
}
