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
         * Die oeffentlichen Uploads - Partner-Logos und -Titelbilder, Angebotsbilder
         * und Profilbilder (App\Support\Uploads::PUBLIC_FOLDERS).
         *
         * Am PC liegt der Ordner weiter unter server/storage, wo die alten
         * Dateien schon sind (api/public/storage verweist dorthin). In the containers,
         * deploy/docker-compose.yml sets UPLOADS_ROOT to the `uploads` volume, mounted into api
         * outside Apache's docroot; the media file server hands it out under /storage, never PHP.
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
            'root' => env('UPLOADS_ROOT') ?: base_path('../server/storage'),
            'url' => rtrim(env('PUBLIC_URL') ?: env('APP_URL', 'http://localhost'), '/').'/storage',
            'visibility' => 'public',
            'throw' => false,
            'report' => false,
        ],

        /**
         * Private uploads: ban and timeout evidence (App\Support\Uploads::PRIVATE_FOLDERS). Never
         * served as files and never under a public folder; only the admin route
         * GET /api/admin/evidence-files/{file} reads them. In the containers
         * deploy/docker-compose.yml sets PRIVATE_MEDIA_ROOT to the `private-media` volume, which no
         * file server mounts.
         *
         * Files 0640, folders 0750: the owner (www-data, api and the scheduler) and its group. The
         * nightly backup reads the volume as root without any capability, so only through the
         * www-data group (group_add in deploy/docker-compose.yml); Laravel's default for private
         * files (0600) would make every backup run fail. Nobody else gets anything.
         */
        'private' => [
            'driver' => 'local',
            'root' => env('PRIVATE_MEDIA_ROOT') ?: base_path('../server/storage-private'),
            'serve' => false,
            'visibility' => 'private',
            'permissions' => [
                'file' => ['public' => 0640, 'private' => 0640],
                'dir' => ['public' => 0750, 'private' => 0750],
            ],
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
