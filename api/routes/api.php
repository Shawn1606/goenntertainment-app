<?php

use App\Http\Controllers\AccountController;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\InterestController;
use App\Http\Controllers\NodeFallbackController;
use App\Http\Controllers\PasswordController;
use App\Http\Controllers\ProgressController;
use App\Http\Controllers\TwoFactorController;
use App\Support\OwnedRoutes;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;

/**
 * Die API der App. Alle Pfade liegen unter /api (das Praefix setzt
 * bootstrap/app.php).
 *
 * ## Uebergangszustand
 *
 * Das Backend zieht Stueck fuer Stueck von Node/Express hierher. Was hier schon
 * steht, bedient Laravel; alles andere faengt die Rueckfall-Route am Ende der
 * Datei auf und schickt es unveraendert an den alten Server weiter. So ist die
 * App zu jedem Zeitpunkt vollstaendig bedient, und jede Etappe ist einzeln
 * pruefbar.
 */

/**
 * Gesundheitspruefung. Bewusst MIT Datenbank-Abfrage: Ein Server, der steht,
 * aber die Datenbank nicht erreicht, ist fuer die App nicht gesund - und genau
 * dieser Fall soll auffallen, bevor die App ihn als Anmelde-Fehler zeigt.
 */
Route::get('/health', function () {
    try {
        DB::select('select 1');

        return response()->json(['ok' => true]);
    } catch (\Throwable) {
        return response()->json(['ok' => false], 500);
    }
});

/*
|---------------------------------------------------------------------------
| Etappe 1: Anmeldung, Konto, Kategorien, Fortschritt
|---------------------------------------------------------------------------
|
| `banned` laeuft immer NACH `auth:sanctum` - erst dann steht fest, wer anfragt.
| Beides zusammen ist das, was zuvor eine einzige Middleware tat: Token pruefen
| und gesperrte Konten abweisen.
*/

// Every route that takes a password, a code or an e-mail address has a named limiter with a
// per-account cap across client addresses (config/ratelimits.php). The route table and its
// limits are pinned in tests/Feature/RouteThrottleCoverageTest.php.
Route::post('/register', [AuthController::class, 'register'])->middleware('throttle:register');
Route::post('/login', [AuthController::class, 'login'])->middleware('throttle:login');
Route::post('/forgot-password', [PasswordController::class, 'forgot'])->middleware('throttle:password-forgot');
Route::post('/reset-password', [PasswordController::class, 'reset'])->middleware('throttle:password-reset');
Route::get('/interests', [InterestController::class, 'index']);

/*
| Zwei-Faktor-Anmeldung, zweiter Schritt. OHNE `auth:sanctum` - genau hier gibt
| es noch keinen Token; was die Anfrage traegt, ist der Vorgang (`challenge`)
| aus der Antwort von /login. Siehe TwoFactorController.
*/
Route::post('/login/two-factor', [TwoFactorController::class, 'verifyLogin'])->middleware('throttle:two-factor');
Route::post('/login/two-factor/resend', [TwoFactorController::class, 'resendLogin'])->middleware('throttle:two-factor-resend');

Route::middleware(['auth:sanctum', 'banned'])->group(function () {
    Route::post('/logout', [AuthController::class, 'logout']);
    Route::get('/user', [AuthController::class, 'show']);
    Route::patch('/user', [AuthController::class, 'update'])->middleware('throttle:profile');
    Route::get('/me/progress', [ProgressController::class, 'progress']);
    Route::get('/leaderboard', [ProgressController::class, 'leaderboard']);

    // Passwort aendern, Konto loeschen. DELETE /me prueft hier und loescht in
    // Node (AccountController::destroy erklaert, warum). One shared budget: each checks the password.
    Route::middleware('throttle:account-sensitive')->group(function () {
        Route::put('/user/password', [AccountController::class, 'updatePassword']);
        // E-Mail-Adresse aendern: only here, with the password (and code); F-04.
        Route::put('/user/email', [AccountController::class, 'updateEmail']);
        Route::delete('/me', [AccountController::class, 'destroy']);
    });

    // Zwei-Faktor-Anmeldung ein- und ausschalten.
    Route::middleware('throttle:two-factor-setup')->group(function () {
        Route::post('/user/two-factor/email', [TwoFactorController::class, 'startEmail']);
        Route::post('/user/two-factor/email/confirm', [TwoFactorController::class, 'confirmEmail']);
        Route::post('/user/two-factor/totp', [TwoFactorController::class, 'startTotp']);
        Route::post('/user/two-factor/totp/confirm', [TwoFactorController::class, 'confirmTotp']);
        Route::post('/user/two-factor/code', [TwoFactorController::class, 'sendConfirmCode']);
        Route::post('/user/two-factor/recovery-codes', [TwoFactorController::class, 'regenerateRecoveryCodes']);
        Route::delete('/user/two-factor', [TwoFactorController::class, 'disable']);
    });
});

/**
 * ---------------------------------------------------------------------------
 * Rueckfall - MUSS die letzte Route dieser Datei bleiben
 * ---------------------------------------------------------------------------
 *
 * Alles, was oben nicht steht, geht an das alte Node-Backend (siehe
 * NodeFallbackController). Diese Route verschwindet, wenn die letzte Etappe
 * portiert ist.
 *
 * ## Warum `Route::any` und nicht `Route::fallback`
 *
 * `Route::fallback` greift nur bei unbekannten ADRESSEN. Waehrend des Umzugs
 * gibt es aber Adressen, von denen erst ein Teil hier liegt: Ist etwa
 * `GET /user` schon portiert und `PATCH /user` noch nicht, dann kennt Laravel
 * die Adresse - und antwortet auf PATCH mit 405 „Methode nicht erlaubt",
 * statt weiterzuleiten. Die App bekaeme einen Fehler fuer eine Funktion, die
 * es laengst gibt. `Route::any` mit `.*` fasst dagegen jede Methode auf jeder
 * Adresse und laesst nur das durch, was oben ausdruecklich steht.
 *
 * It never forwards a path Laravel owns, in any spelling and for any method: the controller
 * checks the normalised path against Laravel's whole route table (App\Support\OwnedRoutes, which
 * skips this route by its name). Keep the name.
 */
Route::any('/{path?}', NodeFallbackController::class)
    ->where('path', '.*')
    ->name(OwnedRoutes::FALLBACK_ROUTE);
