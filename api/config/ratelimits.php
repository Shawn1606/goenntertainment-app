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
| How long an account can be refused. The per-account scopes count every request, right or
| wrong, from any address, so whoever knows an account's e-mail address can use them up. A rule
| that is reached refuses until its window ends; the window starts with its first request. So
| the longest window of a scope is the longest refusal (tests/Feature/RateLimitRulesTest.php
| checks this list against the defaults):
|   register             up to 1 h
|   login                up to 24 h (50 requests an hour for four hours reach the 200 per
|                        24 hours; password sign-in is then refused until 24 hours after the
|                        first request, about 21 hours, and the same can be repeated every day.
|                        The hourly rule alone refuses about 55 minutes of every hour.)
|   password-forgot      up to 24 h (10 requests over about three hours; reset mails are then
|                        refused for about the remaining 21 hours)
|   password-reset       up to 1 h
|   two-factor           up to 1 h
|   two-factor-resend    up to 24 h
|   two-factor-failures  up to 15 min (wrong codes only)
| Sessions that are already signed in are not affected. The login and password-forgot account
| values (AUTH_LIMIT_LOGIN_ACCOUNT, AUTH_LIMIT_FORGOT_ACCOUNT) are the ones to confirm: dropping
| a daily rule shortens the longest refusal to its hourly window.
|
| The numbers are engineering defaults, not product decisions; each can be changed through the
| environment variable named next to it without a code change (api/.env.example lists them with
| their defaults; the production compose passes them all to the api service). Unset or empty
| means the default; a malformed value stops the application while it boots
| (App\Support\RateLimitRules). The counters live in the database cache store
| (CACHE_STORE=database). Each is checked and counted under a lock
| (App\Http\Middleware\ThrottleRequestsExactly), so a limit is exact for requests that arrive at
| the same time as well.
*/

use App\Support\RateLimitRules;

return [
    'register' => [
        'ip' => RateLimitRules::env('AUTH_LIMIT_REGISTER_IP', '10/600,30/3600'),
        'account' => RateLimitRules::env('AUTH_LIMIT_REGISTER_ACCOUNT', '5/3600'),
    ],
    'login' => [
        'account_ip' => RateLimitRules::env('AUTH_LIMIT_LOGIN_ACCOUNT_IP', '10/60'),
        'ip' => RateLimitRules::env('AUTH_LIMIT_LOGIN_IP', '30/60'),
        'account' => RateLimitRules::env('AUTH_LIMIT_LOGIN_ACCOUNT', '50/3600,200/86400'),
    ],
    'password-forgot' => [
        'ip' => RateLimitRules::env('AUTH_LIMIT_FORGOT_IP', '5/600,20/3600'),
        'account' => RateLimitRules::env('AUTH_LIMIT_FORGOT_ACCOUNT', '3/3600,10/86400'),
    ],
    'password-reset' => [
        'ip' => RateLimitRules::env('AUTH_LIMIT_RESET_IP', '10/600'),
        'account' => RateLimitRules::env('AUTH_LIMIT_RESET_ACCOUNT', '10/3600'),
    ],
    'two-factor' => [
        'challenge' => RateLimitRules::env('AUTH_LIMIT_2FA_CHALLENGE', '10/60'),
        'ip' => RateLimitRules::env('AUTH_LIMIT_2FA_IP', '30/60'),
        'account' => RateLimitRules::env('AUTH_LIMIT_2FA_ACCOUNT', '30/3600'),
    ],
    'two-factor-resend' => [
        'ip' => RateLimitRules::env('AUTH_LIMIT_2FA_RESEND_IP', '10/60'),
        'account' => RateLimitRules::env('AUTH_LIMIT_2FA_RESEND_ACCOUNT', '5/600,20/86400'),
    ],
    'two-factor-setup' => [
        'user' => RateLimitRules::env('AUTH_LIMIT_2FA_SETUP_USER', '10/60,30/3600'),
    ],
    'account-sensitive' => [
        'user' => RateLimitRules::env('AUTH_LIMIT_ACCOUNT_SENSITIVE_USER', '10/60,30/3600'),
    ],
    'profile' => [
        'user' => RateLimitRules::env('AUTH_LIMIT_PROFILE_USER', '30/60,300/3600'),
    ],

    // Not a route limiter: wrong second-factor codes per account, across every sign-in challenge
    // and step-up (App\Support\TwoFactor). At the cap no code is accepted and none is mailed
    // until the window has passed. The cap is exact: looking at it, checking a code and counting
    // it run under one lock per account, so requests at the same time cannot all slip in below
    // it. A code check accepts 3 of a million codes (one time step either side), so 10 guesses
    // per 15 minutes hit about once in 33,000 windows: one hit in roughly a year of non-stop
    // guessing.
    'two-factor-failures' => [
        'account' => RateLimitRules::env('AUTH_LIMIT_2FA_FAILURES', '10/900'),
    ],

    // Not a limit either: how many seconds a request waits for the lock that makes a check and
    // its count one step (App\Http\Middleware\ThrottleRequestsExactly, App\Support\TwoFactor).
    // A request that does not get it in time gets the 429 answer, and nothing is counted.
    'lock-wait' => RateLimitRules::env('AUTH_LIMIT_LOCK_WAIT', '5'),
];
