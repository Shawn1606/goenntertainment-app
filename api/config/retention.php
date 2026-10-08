<?php

/*
|--------------------------------------------------------------------------
| Retention in days (F-16)
|--------------------------------------------------------------------------
|
| How long evidence images and expired sign-in data are kept before the retention prune deletes
| them (App\Support\Retention, `php artisan retention:prune`, every hour from the schedule). An
| operator decision without a default: production requires both (deploy/docker-compose.yml gives
| them to the scheduler, deploy/.env.example says who decides); elsewhere both or none, and none
| prunes nothing. Whole days, at least 1.
*/

return [
    'evidence_days' => env('EVIDENCE_RETENTION_DAYS'),
    'token_days' => env('TOKEN_RETENTION_DAYS'),
];
