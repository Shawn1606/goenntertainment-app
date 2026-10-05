<?php

use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    return view('welcome');
});

/*
| Die Adressen auf Aufklebern und Einladungslinks.
|
| Die App liest sie selbst, wenn man mit ihr scannt. Scannt jemand mit der
| normalen Kamera (oder hat die App noch nicht), landet er hier: eine kleine
| Seite, die die App oeffnet - oder sagt, wo es sie gibt.
*/
Route::get('/c/{token}', fn (string $token) => view('open-app', [
    'title' => 'Stempel sammeln',
    'line' => 'Öffne GÖ4Fun, um bei diesem Partner einzuchecken und deinen Stempel zu holen.',
    'deepLink' => 'goenntertainmentapp://c/'.rawurlencode($token),
]))->where('token', '[A-Za-z0-9]{16,40}');

Route::get('/g/{code}', fn (string $code) => view('open-app', [
    'title' => 'Gruppeneinladung',
    'line' => 'Du wurdest in eine Gruppe eingeladen. Öffne GÖ4Fun, um beizutreten.',
    'deepLink' => 'goenntertainmentapp://join/'.rawurlencode($code),
]))->where('code', '[A-Za-z0-9-]{4,20}');
