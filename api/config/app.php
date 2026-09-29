<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Application Name
    |--------------------------------------------------------------------------
    |
    | This value is the name of your application, which will be used when the
    | framework needs to place the application's name in a notification or
    | other UI elements where an application name needs to be displayed.
    |
    */

    'name' => env('APP_NAME', 'Laravel'),

    /*
    |--------------------------------------------------------------------------
    | Application Environment
    |--------------------------------------------------------------------------
    |
    | This value determines the "environment" your application is currently
    | running in. This may determine how you prefer to configure various
    | services the application utilizes. Set this in your ".env" file.
    |
    */

    'env' => env('APP_ENV', 'production'),

    /*
    |--------------------------------------------------------------------------
    | Application Debug Mode
    |--------------------------------------------------------------------------
    |
    | When your application is in debug mode, detailed error messages with
    | stack traces will be shown on every error that occurs within your
    | application. If disabled, a simple generic error page is shown.
    |
    */

    'debug' => (bool) env('APP_DEBUG', false),

    /*
    |--------------------------------------------------------------------------
    | Application URL
    |--------------------------------------------------------------------------
    |
    | This URL is used by the console to properly generate URLs when using
    | the Artisan command line tool. You should set this to the root of
    | the application so that it's available within Artisan commands.
    |
    */

    'url' => env('APP_URL', 'http://localhost'),

    /*
    |--------------------------------------------------------------------------
    | Basis fuer oeffentliche Datei-Adressen
    |--------------------------------------------------------------------------
    |
    | Leer heisst: Die Adresse der Bilder entsteht bei jeder Antwort aus der
    | Anfrage selbst (Schema + Host). Das braucht die Entwicklung, denn der Host
    | ist dort die wechselnde WLAN-IP des Rechners. In Produktion steht hier die
    | feste oeffentliche Adresse. Ausgewertet in App\Support\Media.
    |
    | Bewusst getrennt von APP_URL: APP_URL zeigt auf die Anwendung, dieser Wert
    | auf die Stelle, unter der ihre Dateien erreichbar sind - das kann ein
    | anderer Host sein (CDN), und APP_URL hat ausserdem einen Vorgabewert
    | ('http://localhost'), der als Bild-Adresse still alles kaputt machen wuerde.
    |
    */

    'public_url' => env('PUBLIC_URL', ''),

    /*
    |--------------------------------------------------------------------------
    | Application Timezone
    |--------------------------------------------------------------------------
    |
    | Here you may specify the default timezone for your application, which
    | will be used by the PHP date and date-time functions. The timezone
    | is set to "UTC" by default as it is suitable for most use cases.
    |
    */

    /**
     * Europe/Berlin - und das ist eine bewusste Abweichung von Laravels UTC.
     *
     * ## Warum
     *
     * Die Datenbank ist voll, und die vorhandenen Zeitstempel stehen in ORTSZEIT.
     * Das vorige Backend schrieb sie mit MySQLs `NOW()`, und der MySQL-Server
     * laeuft auf `time_zone = SYSTEM`, also Europe/Berlin. Nachgemessen:
     *
     *   MySQL NOW()          2026-07-31 10:36:00   <- so steht es in allen Tabellen
     *   MySQL UTC_TIMESTAMP  2026-07-31 08:36:00
     *
     * Bliebe hier UTC, traege jede neue Zeile einen Zeitstempel zwei Stunden VOR
     * den bestehenden. Das ist kein Anzeigefehler, sondern beschaedigt Daten:
     *
     *  - Ein neuer Chat-Beitrag sortierte sich zwei Stunden zurueck, also mitten in
     *    das Gespraech von vorhin statt an dessen Ende.
     *  - Eine Story lief zwei Stunden zu frueh ab (`expires_at` = jetzt + 24 h).
     *  - Ein Hervorheben endete zwei Stunden zu frueh.
     *  - Beim Vergleich „laeuft noch" gegen bestehende Zeilen entstuende ein
     *    Zeitfenster von zwei Stunden, in dem etwas gleichzeitig vorbei und nicht
     *    vorbei ist.
     *
     * Sauber waere UTC ueberall - in der Datenbank, in PHP, in der App. Das ist
     * aber eine Umstellung der BESTANDSDATEN und gehoert nicht in einen Umzug des
     * Frameworks: Solange 42 Tabellen in Ortszeit stehen, ist Ortszeit hier die
     * richtige Antwort. Wer das aendert, muss die vorhandenen Werte mitnehmen.
     */
    'timezone' => env('APP_TIMEZONE', 'Europe/Berlin'),

    /*
    |--------------------------------------------------------------------------
    | Application Locale Configuration
    |--------------------------------------------------------------------------
    |
    | The application locale determines the default locale that will be used
    | by Laravel's translation / localization methods. This option can be
    | set to any locale for which you plan to have translation strings.
    |
    */

    'locale' => env('APP_LOCALE', 'en'),

    'fallback_locale' => env('APP_FALLBACK_LOCALE', 'en'),

    'faker_locale' => env('APP_FAKER_LOCALE', 'en_US'),

    /*
    |--------------------------------------------------------------------------
    | Encryption Key
    |--------------------------------------------------------------------------
    |
    | This key is utilized by Laravel's encryption services and should be set
    | to a random, 32 character string to ensure that all encrypted values
    | are secure. You should do this prior to deploying the application.
    |
    */

    'cipher' => 'AES-256-CBC',

    'key' => env('APP_KEY'),

    'previous_keys' => [
        ...array_filter(
            explode(',', (string) env('APP_PREVIOUS_KEYS', ''))
        ),
    ],

    /*
    |--------------------------------------------------------------------------
    | Maintenance Mode Driver
    |--------------------------------------------------------------------------
    |
    | These configuration options determine the driver used to determine and
    | manage Laravel's "maintenance mode" status. The "cache" driver will
    | allow maintenance mode to be controlled across multiple machines.
    |
    | Supported drivers: "file", "cache"
    |
    */

    'maintenance' => [
        'driver' => env('APP_MAINTENANCE_DRIVER', 'file'),
        'store' => env('APP_MAINTENANCE_STORE', 'database'),
    ],

];
