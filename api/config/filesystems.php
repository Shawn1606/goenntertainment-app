<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Default Filesystem Disk
    |--------------------------------------------------------------------------
    |
    | Here you may specify the default filesystem disk that should be used
    | by the framework. The "local" disk, as well as a variety of cloud
    | based disks are available to your application for file storage.
    |
    */

    'default' => env('FILESYSTEM_DISK', 'local'),

    /*
    |--------------------------------------------------------------------------
    | Filesystem Disks
    |--------------------------------------------------------------------------
    |
    | Below you may configure as many filesystem disks as necessary, and you
    | may even configure multiple disks for the same driver. Examples for
    | most supported storage drivers are configured here for reference.
    |
    | Supported drivers: "local", "ftp", "sftp", "s3"
    |
    */

    'disks' => [

        'local' => [
            'driver' => 'local',
            'root' => storage_path('app/private'),
            // No routes for this disk: the app stores nothing here, and with `true` Laravel would
            // register GET and PUT storage/{path} (signed URLs) that no client uses.
            'serve' => false,
            'throw' => false,
            'report' => false,
        ],

        /**
         * Die Nutzer-Uploads - Profilbilder, Banner, Storys, Beitragsbilder.
         *
         * `root` zeigt ABSICHTLICH nicht in dieses Projekt, sondern auf den
         * Ordner, den schon das Node-Backend benutzt (server/storage). Solange
         * beide Server laufen, muessen beide dieselben Dateien sehen: Eine Kopie
         * liefe sofort auseinander - ein Profilbild, das ueber Laravel
         * hochgeladen wird, waere fuer die noch nicht portierten Routen
         * unsichtbar und umgekehrt. Ein Ordner, zwei Leser.
         *
         * In der DB stehen relative Pfade ('avatars/ab12cd.jpg'); die fertige
         * Adresse baut App\Support\Media bei jeder Antwort neu.
         *
         * `url` kommt hier NICHT aus APP_URL, sondern aus derselben Quelle wie
         * die Bild-Adressen der API - sonst zeigten Storage::url() und die
         * API-Antwort auf verschiedene Hosts.
         */
        'public' => [
            'driver' => 'local',
            'root' => base_path('../server/storage'),
            'url' => rtrim(env('PUBLIC_URL') ?: env('APP_URL', 'http://localhost'), '/').'/storage',
            'visibility' => 'public',
            'throw' => false,
            'report' => false,
        ],

        's3' => [
            'driver' => 's3',
            'key' => env('AWS_ACCESS_KEY_ID'),
            'secret' => env('AWS_SECRET_ACCESS_KEY'),
            'region' => env('AWS_DEFAULT_REGION'),
            'bucket' => env('AWS_BUCKET'),
            'url' => env('AWS_URL'),
            'endpoint' => env('AWS_ENDPOINT'),
            'use_path_style_endpoint' => env('AWS_USE_PATH_STYLE_ENDPOINT', false),
            'throw' => false,
            'report' => false,
        ],

    ],

    /*
    |--------------------------------------------------------------------------
    | Symbolic Links
    |--------------------------------------------------------------------------
    |
    | Here you may configure the symbolic links that will be created when the
    | `storage:link` Artisan command is executed. The array keys should be
    | the locations of the links and the values should be their targets.
    |
    */

    'links' => [
        public_path('storage') => storage_path('app/public'),
    ],

];
