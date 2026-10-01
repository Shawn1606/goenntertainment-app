<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
// Die gemeinsame Basisklasse, nicht Illuminate\Http\Response: Diese Methode gibt
// auch JSON zurück (JsonResponse), und das ist KEIN Illuminate\Http\Response. Mit
// dem engeren Typ stürzten gerade die Fehlerwege ab („Node antwortet nicht" 502,
// „Bild zu groß" 413) – mit einem PHP-TypeError statt der vorgesehenen Meldung.
use Symfony\Component\HttpFoundation\Response;

/**
 * Reicht noch nicht portierte API-Pfade an das alte Node-Backend weiter.
 *
 * ## Warum es das gibt
 *
 * Das Backend zieht in Etappen nach Laravel um. Ohne diese Weiche waere die App
 * nach der ersten Etappe halb tot: Laravel wuerde alles mit 404 beantworten, was
 * noch nicht portiert ist. Mit ihr ist Laravel ab dem ersten Tag die einzige
 * Adresse, die die App kennt - was schon hier liegt, beantwortet Laravel selbst,
 * der Rest geht unveraendert weiter. Jede Etappe nimmt der Weiche Pfade weg.
 *
 * Wenn NODE_FALLBACK_URL leer ist, ist der Umzug fertig: Dann gibt es keinen
 * Rueckfall mehr, und ein unbekannter Pfad ist genau das - ein 404 im Format,
 * das die App kennt.
 *
 * ## Was hier bewusst NICHT weitergegeben wird
 *
 * `Host` (der alte Server wuerde sich sonst unter dem falschen Namen sehen),
 * `Content-Length` und `Accept-Encoding` (Laenge und Kodierung bestimmt der
 * HTTP-Client neu; eine geerbte Laenge passt nach dem Neuaufbau des Rumpfs
 * nicht mehr und der Aufruf bricht ab).
 */
class NodeFallbackController extends Controller
{
    /** Kopfzeilen, die eine Verbindung beschreiben - nicht die Anfrage. */
    private const HOP_BY_HOP = [
        'host',
        'content-length',
        'connection',
        'keep-alive',
        'transfer-encoding',
        'accept-encoding',
        'upgrade',
        'proxy-authorization',
        'proxy-authenticate',
        'te',
        'trailer',
    ];

    /**
     * Headers a client may never send on to Node: only Laravel sets them, on its internal calls
     * (App\Support\NodeInternal). A copy from the client is dropped, never forwarded.
     */
    private const NEVER_FORWARD = [
        'x-internal-secret',
        'x-account-deletion-grant',
    ];

    public function __invoke(Request $request, string $path = ''): Response
    {
        $base = rtrim((string) config('services.node_fallback.url'), '/');

        // Kein Rueckfall eingerichtet: Der Umzug ist durch. Gleiche Antwort wie
        // zuvor der alte Server auf einen unbekannten Pfad.
        if ($base === '') {
            return response()->json(['message' => 'Nicht gefunden.'], 404);
        }

        $target = $base.'/api'.($path === '' ? '' : '/'.$path);

        $isMultipart = str_starts_with(strtolower((string) $request->header('Content-Type', '')), 'multipart/form-data');

        $headers = [];
        foreach ($request->headers->all() as $name => $values) {
            if (in_array(strtolower($name), self::HOP_BY_HOP, true)
                || in_array(strtolower($name), self::NEVER_FORWARD, true)) {
                continue;
            }
            // Bei Formularen mit Dateien baut der HTTP-Client den Rumpf NEU und
            // setzt dabei eine eigene Trennmarke. Die alte Content-Type-Zeile
            // (mit der Trennmarke der App) passte dann nicht mehr zum Rumpf.
            if ($isMultipart && strtolower($name) === 'content-type') {
                continue;
            }
            $headers[$name] = implode(', ', $values);
        }

        /**
         * Unter welcher Adresse die App WIRKLICH gefragt hat.
         *
         * Node baut Bildadressen aus dem Host der Anfrage (server/src/media.js). Ohne
         * diese Zeilen sah es nur „127.0.0.1:8001" – und schickte der App Bild-URLs,
         * die das Handy nie erreicht. Laravel liefert /storage selbst aus
         * (public/storage zeigt auf server/storage), die Adresse von hier stimmt also.
         */
        $headers['X-Forwarded-Host'] = $request->getHttpHost();
        $headers['X-Forwarded-Proto'] = $request->getScheme();

        /**
         * Zu große Datei – laut ablehnen statt still weglassen.
         *
         * Überschreitet ein Bild `upload_max_filesize` von PHP, kommt es in $_FILES
         * nur als Fehlereintrag an. Früher fiel es beim Neuaufbau des Formulars
         * einfach weg: Node bekam die Aktivität OHNE Bild und legte sie an, als wäre
         * nichts gewesen. Die Meldung nennt die Grenze, die Node selbst zieht (5 MB),
         * damit sie mit der Meldung für andere zu große Bilder übereinstimmt.
         */
        if ($isMultipart && $this->hasOversizedUpload($request->allFiles())) {
            return response()->json([
                'message' => 'Das Bild ist zu groß – bitte nimm eines unter '.$this->uploadLimitMb().' MB.',
            ], 413);
        }

        try {
            // Kein ->throw(): Der HTTP-Client wirft von sich aus NICHT bei
            // 4xx/5xx, und genau das ist hier richtig. Weiterleiten heisst
            // weiterleiten - antwortet der alte Server mit 401 oder 404, ist das
            // die Antwort und kein Fehler dieses Servers.
            $client = Http::withHeaders($headers)->timeout(30);

            if ($isMultipart) {
                /**
                 * multipart/form-data kann NICHT roh durchgereicht werden.
                 *
                 * PHP liest solche Anfragen selbst ein (in $_POST und $_FILES), und
                 * danach ist der Rohrumpf LEER – `getContent()` liefert ''. Früher
                 * ging deshalb ein leerer Rumpf mit Multipart-Kopfzeile an Node, der
                 * Formular-Leser dort brach ab, und JEDER Upload über die App
                 * (Aktivität mit Foto, Profilbild, Banner, Story) endete in
                 * „Serverfehler.". Also wird das Formular aus Feldern und Dateien
                 * neu zusammengesetzt – mit denselben Feldnamen („interests[]"), die
                 * die App geschickt hat.
                 */
                $upstream = $client->send($request->method(), $target, [
                    'query' => $request->query(),
                    'multipart' => $this->multipartParts($request),
                ]);
            } else {
                // Alles andere ROH durchgeben, nicht als JSON neu aufbauen: So
                // bleibt der Rumpf Byte für Byte, was die App geschickt hat.
                $content = $request->getContent();
                if ($content !== '') {
                    $client = $client->withBody($content, $request->header('Content-Type', 'application/json'));
                }

                $upstream = $client->send($request->method(), $target, [
                    'query' => $request->query(),
                ]);
            }
        } catch (\Throwable $e) {
            Log::error('Rueckfall auf das alte Backend fehlgeschlagen', [
                'target' => $target,
                'fehler' => $e->getMessage(),
            ]);

            // 502, nicht 500: Der Fehler liegt nicht hier, sondern hinter uns.
            // Die Meldung ist fuer Menschen gedacht, die gerade portieren.
            return response()->json([
                'message' => 'Serverfehler.',
                'hinweis' => 'Dieser Pfad liegt noch beim alten Backend, und das antwortet nicht.',
            ], 502);
        }

        $response = response($upstream->body(), $upstream->status());

        // Nur die Kopfzeilen uebernehmen, die zur Nutzlast gehoeren. Die
        // CORS-Kopfzeilen setzt Laravel selbst (config/cors.php) - kaemen sie
        // zusaetzlich vom alten Server, staenden sie doppelt in der Antwort, und
        // der Browser lehnt eine doppelte Access-Control-Allow-Origin ab.
        foreach (['Content-Type', 'Cache-Control', 'ETag', 'Last-Modified', 'Location'] as $name) {
            $value = $upstream->header($name);
            if ($value !== '') {
                $response->header($name, $value);
            }
        }

        // Verraet beim Pruefen, wer geantwortet hat. Sichtbar nur fuer Werkzeuge
        // (die App liest ausschliesslich den Rumpf), aber Gold wert, wenn man
        // wissen will, ob eine Etappe wirklich greift.
        return $response->header('X-Goenn-Backend', 'node-fallback');
    }

    /**
     * Welche Grenze gerade wirklich gilt, in MB: die kleinere aus PHPs
     * `upload_max_filesize` und den 5 MB, die Node selbst zieht. Im Container ist
     * PHP großzügiger (8 MB, api/docker/php.ini), dann sind es die 5 MB von Node;
     * am PC mit PHPs Vorgabe von 2 MB wären „5 MB" in der Meldung gelogen.
     */
    private function uploadLimitMb(): int
    {
        $raw = trim((string) ini_get('upload_max_filesize'));
        $bytes = (int) $raw;
        $unit = strtoupper(substr($raw, -1));
        $bytes *= match ($unit) {
            'G' => 1024 ** 3,
            'M' => 1024 ** 2,
            'K' => 1024,
            default => 1,
        };
        $nodeLimit = 5 * 1024 ** 2;

        return max(1, intdiv(min($bytes > 0 ? $bytes : $nodeLimit, $nodeLimit), 1024 ** 2));
    }

    /** Steckt irgendwo eine Datei, die PHP wegen ihrer Größe abgewiesen hat? */
    private function hasOversizedUpload(array $files): bool
    {
        foreach ($files as $file) {
            if (is_array($file)) {
                if ($this->hasOversizedUpload($file)) {
                    return true;
                }

                continue;
            }
            if ($file instanceof \Illuminate\Http\UploadedFile
                && in_array($file->getError(), [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Felder und Dateien einer Multipart-Anfrage als Teile für den HTTP-Client.
     *
     * Listen werden wieder zu `name[]` (so schickt die App `interests[]`), benannte
     * Unterfelder zu `name[schluessel]`. Das ist die Schreibweise, die Nodes
     * Formular-Leser (multer) zurück in Listen und Objekte verwandelt.
     *
     * @return list<array{name: string, contents: mixed, filename?: string, headers?: array<string, string>}>
     */
    private function multipartParts(Request $request): array
    {
        $parts = [];

        $addFields = function (string $name, mixed $value) use (&$parts, &$addFields): void {
            if (is_array($value)) {
                $isList = array_is_list($value);
                foreach ($value as $key => $item) {
                    $addFields($isList ? $name.'[]' : $name.'['.$key.']', $item);
                }

                return;
            }
            $parts[] = ['name' => $name, 'contents' => $value === null ? '' : (string) $value];
        };

        foreach ($request->request->all() as $name => $value) {
            $addFields((string) $name, $value);
        }

        $addFiles = function (string $name, mixed $file) use (&$parts, &$addFiles): void {
            if (is_array($file)) {
                $isList = array_is_list($file);
                foreach ($file as $key => $item) {
                    $addFiles($isList ? $name.'[]' : $name.'['.$key.']', $item);
                }

                return;
            }
            if (! $file instanceof \Illuminate\Http\UploadedFile || ! $file->isValid()) {
                return;
            }
            $parts[] = [
                'name' => $name,
                'contents' => fopen($file->getRealPath(), 'r'),
                'filename' => $file->getClientOriginalName(),
                'headers' => ['Content-Type' => $file->getClientMimeType()],
            ];
        };

        foreach ($request->allFiles() as $name => $file) {
            $addFiles((string) $name, $file);
        }

        return $parts;
    }
}
