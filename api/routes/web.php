<?php

use App\Http\Responses\OpenAppPage;
use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    return view('welcome');
});

/*
| Die Adressen auf Aufklebern und Einladungslinks.
|
| Die App liest sie selbst, wenn man mit ihr scannt. Scannt jemand mit der
| normalen Kamera (oder hat die App noch nicht), landet er hier: eine kleine
| Seite, die die App oeffnet - oder sagt, wo es sie gibt (mit eigener
| Sicherheitsrichtlinie, App\Http\Responses\OpenAppPage).
*/
Route::get('/c/{token}', fn (string $token) => OpenAppPage::make(
    'Stempel sammeln',
    'Öffne GÖ4Fun, um bei diesem Partner einzuchecken und deinen Stempel zu holen.',
    'goenntertainmentapp://c/'.rawurlencode($token),
))->where('token', '[A-Za-z0-9]{16,40}');

Route::get('/g/{code}', fn (string $code) => OpenAppPage::make(
    'Gruppeneinladung',
    'Du wurdest in eine Gruppe eingeladen. Öffne GÖ4Fun, um beizutreten.',
    'goenntertainmentapp://join/'.rawurlencode($code),
))->where('code', '[A-Za-z0-9-]{4,20}');
