<?php

/*
|--------------------------------------------------------------------------
| Trusted proxies (F-31)
|--------------------------------------------------------------------------
|
| The addresses (IPs or CIDR ranges, comma-separated) of the reverse proxies in front of
| Laravel - in production Caddy, whose fixed address the compose sets from APP_NET_PREFIX.
| Only a request whose TCP peer is one of them may set X-Forwarded-For, -Host and -Proto;
| from anyone else those headers are ignored and $request->ip() is the peer itself.
|
| Empty = trust nobody (development: `php artisan serve` has no proxy in front). Never '*':
| then every client could choose the address the rate limits count and that Node receives.
| bootstrap/app.php names the headers; this file only the addresses, read at request time.
|
| Empty or unset gives an empty list, never null: Laravel's TrustProxies reads null as "trust
| every proxy" when the request's Host ends in .on-forge.com or .on-vapor.com, or when
| LARAVEL_CLOUD=1 is set, and the client chooses its Host header (tests/Feature/
| TrustedProxiesTest.php).
|
*/

return [
    'proxies' => env('TRUSTED_PROXIES') ?: [],
];
