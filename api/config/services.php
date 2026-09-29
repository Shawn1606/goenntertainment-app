<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Third Party Services
    |--------------------------------------------------------------------------
    |
    | This file is for storing the credentials for third party services such
    | as Mailgun, Postmark, AWS and more. This file provides the de facto
    | location for this type of information, allowing packages to have
    | a conventional file to locate the various service credentials.
    |
    */

    'postmark' => [
        'key' => env('POSTMARK_API_KEY'),
    ],

    'resend' => [
        'key' => env('RESEND_API_KEY'),
    ],

    'ses' => [
        'key' => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
    ],

    'slack' => [
        'notifications' => [
            'bot_user_oauth_token' => env('SLACK_BOT_USER_OAUTH_TOKEN'),
            'channel' => env('SLACK_BOT_USER_DEFAULT_CHANNEL'),
        ],
    ],

    /*
    |--------------------------------------------------------------------------
    | Rueckfall auf das alte Node-Backend
    |--------------------------------------------------------------------------
    |
    | Solange das Backend etappenweise nach Laravel zieht, beantwortet Laravel
    | die schon portierten Pfade selbst und schickt alle anderen hierhin weiter
    | (siehe App\Http\Controllers\NodeFallbackController).
    |
    | LEER = der Umzug ist fertig. Dann gibt es keinen Rueckfall mehr, und ein
    | unbekannter Pfad ist ein 404. Das ist der Zustand, auf den das hinauslaeuft:
    | Diese Einstellung soll wieder verschwinden.
    |
    */

    'node_fallback' => [
        'url' => env('NODE_FALLBACK_URL', ''),
    ],

];
