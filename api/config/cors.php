<?php

/**
 * CORS - ohne diese Header ist die App im BROWSER blind.
 *
 * Der Web-Zielbau laeuft unter localhost:8081/8082, das Backend unter :8000 -
 * zwei verschiedene Origins. Der `Authorization`-Header macht aus jedem Aufruf
 * eine Anfrage mit Vorabfrage (OPTIONS). Auf dem Handy faellt das nie auf, weil
 * React Native kein CORS kennt.
 *
 * `*` als Origin ist hier bewusst und sicher: Dieses Backend authentifiziert
 * ausschliesslich ueber einen Bearer-Token im Header, nicht ueber Cookies. Der
 * Browser schickt Header nie von allein mit - eine fremde Seite kann also nichts
 * im Namen der Nutzer:in tun, egal welche Origin erlaubt ist. Genau deshalb
 * steht `supports_credentials` auf false: Mit Cookies waere `*` ein Loch.
 *
 * Die Kopfzeilen-Liste ist genau die, die die App schickt (siehe
 * src/lib/api.ts) - dort ist ausdruecklich festgehalten, dass keine eigenen
 * Header verwendet werden, um Vorabfragen zu vermeiden.
 */
return [

    'paths' => ['api/*', 'storage/*'],

    'allowed_methods' => ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],

    'allowed_origins' => ['*'],

    'allowed_origins_patterns' => [],

    'allowed_headers' => ['Authorization', 'Content-Type', 'Accept'],

    'exposed_headers' => [],

    // Eine Vorabfrage darf 24 h gelten - sonst fragt der Browser vor jedem
    // einzelnen Aufruf erneut nach.
    'max_age' => 86400,

    'supports_credentials' => false,

];
