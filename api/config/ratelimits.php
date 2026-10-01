<?php

/*
|--------------------------------------------------------------------------
| Rate limits of the sign-in, sign-up, password and two-factor routes
|--------------------------------------------------------------------------
|
| One entry per named limiter (App\Providers\AppServiceProvider). Each scope is a key the limiter
| counts by, and its value a list of "max/seconds" rules, comma-separated: "10/600,30/3600" means
| at most 10 requests in 10 minutes and at most 30 in an hour. Every rule is its own counter.
|
| Scopes:
|   ip          the client address (IPv6 grouped per /64), as Laravel trusts it (TRUSTED_PROXIES)
|   account     the account the request is about, across all addresses: the user id when the
|               e-mail address (or the two-factor sign-in) belongs to an account, otherwise a hash
|               of the normalised address. Sign-in counts every attempt, right or wrong.
|   account_ip  account and address together
|   challenge   one two-factor sign-in in progress
|   user        the signed-in account
|
| The numbers are engineering defaults, not product decisions; each can be changed through the
| environment variable named next to it without a code change (api/.env.example lists them).
| The counters live in the database cache store (CACHE_STORE=database).
*/

return [
    'register' => [
        'ip' => env('AUTH_LIMIT_REGISTER_IP', '10/600,30/3600'),
        'account' => env('AUTH_LIMIT_REGISTER_ACCOUNT', '5/3600'),
    ],
    'login' => [
        'account_ip' => env('AUTH_LIMIT_LOGIN_ACCOUNT_IP', '10/60'),
        'ip' => env('AUTH_LIMIT_LOGIN_IP', '30/60'),
        'account' => env('AUTH_LIMIT_LOGIN_ACCOUNT', '50/3600,200/86400'),
    ],
    'password-forgot' => [
        'ip' => env('AUTH_LIMIT_FORGOT_IP', '5/600,20/3600'),
        'account' => env('AUTH_LIMIT_FORGOT_ACCOUNT', '3/3600,10/86400'),
    ],
    'password-reset' => [
        'ip' => env('AUTH_LIMIT_RESET_IP', '10/600'),
        'account' => env('AUTH_LIMIT_RESET_ACCOUNT', '10/3600'),
    ],
    'two-factor' => [
        'challenge' => env('AUTH_LIMIT_2FA_CHALLENGE', '10/60'),
        'ip' => env('AUTH_LIMIT_2FA_IP', '30/60'),
        'account' => env('AUTH_LIMIT_2FA_ACCOUNT', '30/3600'),
    ],
    'two-factor-resend' => [
        'ip' => env('AUTH_LIMIT_2FA_RESEND_IP', '10/60'),
        'account' => env('AUTH_LIMIT_2FA_RESEND_ACCOUNT', '5/600,20/86400'),
    ],
    'two-factor-setup' => [
        'user' => env('AUTH_LIMIT_2FA_SETUP_USER', '10/60,30/3600'),
    ],
    'account-sensitive' => [
        'user' => env('AUTH_LIMIT_ACCOUNT_SENSITIVE_USER', '10/60,30/3600'),
    ],
    'profile' => [
        'user' => env('AUTH_LIMIT_PROFILE_USER', '30/60,300/3600'),
    ],
];
