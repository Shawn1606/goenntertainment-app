<?php

use App\Http\Controllers\AccountController;
use App\Http\Controllers\Admin;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\AvatarController;
use App\Http\Controllers\BookingController;
use App\Http\Controllers\ChatController;
use App\Http\Controllers\CheckinController;
use App\Http\Controllers\ClubController;
use App\Http\Controllers\FeatureController;
use App\Http\Controllers\GroupController;
use App\Http\Controllers\InterestController;
use App\Http\Controllers\MarketController;
use App\Http\Controllers\PartnerStaffController;
use App\Http\Controllers\PasswordController;
use App\Http\Controllers\SafetyController;
use App\Http\Controllers\TwoFactorController;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;

/**
 * Die API der App. Alle Pfade liegen unter /api (das Praefix setzt
 * bootstrap/app.php).
 *
 * Seit dem Marktplatz-Umbau bedient Laravel ALLES - das Node-Backend (server/)
 * und die Rueckfall-Route dorthin gibt es nicht mehr. A path that is not listed here answers 404.
 *
 * Every write route has a named limiter (config/ratelimits.php): the sign-in, sign-up, password
 * and two-factor routes a per-account cap across client addresses, every other write its write
 * class. The route table and its limits are pinned in tests/Feature/RouteThrottleCoverageTest.php,
 * so a new route fails that test until it is listed there. `throttle` is
 * App\Http\Middleware\ThrottleRequestsExactly (bootstrap/app.php): it checks and counts each
 * counter under a lock, so a cap also holds for requests that arrive at the same time.
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
| Anmeldung (ohne Token)
|---------------------------------------------------------------------------
|
| Every route that takes a password, a code or an e-mail address has a named limiter with a
| per-account cap across client addresses.
*/

Route::post('/register', [AuthController::class, 'register'])->middleware('throttle:register');
Route::post('/login', [AuthController::class, 'login'])->middleware('throttle:login');
Route::post('/forgot-password', [PasswordController::class, 'forgot'])->middleware('throttle:password-forgot');
Route::post('/reset-password', [PasswordController::class, 'reset'])->middleware('throttle:password-reset');
Route::get('/interests', [InterestController::class, 'index']);

/*
| Kalender-Datei einer Buchung - ohne Token, weil der Kalender des Handys den
| Link selbst oeffnet. Geschuetzt durch eine Signatur im Link
| (App\Support\BookingCalendar), die nur die App von der API bekommt.
*/
Route::get('/bookings/{id}/calendar.ics', [BookingController::class, 'calendar'])->whereNumber('id');

/*
| Zwei-Faktor-Anmeldung, zweiter Schritt. OHNE `auth:sanctum` - genau hier gibt
| es noch keinen Token; was die Anfrage traegt, ist der Vorgang (`challenge`)
| aus der Antwort von /login. Siehe TwoFactorController.
*/
Route::post('/login/two-factor', [TwoFactorController::class, 'verifyLogin'])->middleware('throttle:two-factor');
Route::post('/login/two-factor/resend', [TwoFactorController::class, 'resendLogin'])->middleware('throttle:two-factor-resend');

/*
|---------------------------------------------------------------------------
| Angemeldet
|---------------------------------------------------------------------------
|
| `banned` laeuft immer NACH `auth:sanctum` - erst dann steht fest, wer anfragt.
| Beides zusammen ist das, was zuvor eine einzige Middleware tat: Token pruefen
| und gesperrte Konten abweisen.
*/

Route::middleware(['auth:sanctum', 'banned'])->group(function () {
    // Konto
    Route::post('/logout', [AuthController::class, 'logout']);
    Route::get('/user', [AuthController::class, 'show']);
    Route::patch('/user', [AuthController::class, 'update'])->middleware('throttle:profile');
    // The image goes through App\Support\Uploads: decoded and encoded again, without metadata.
    Route::post('/user/avatar', [AvatarController::class, 'store'])->middleware('throttle:avatar');
    Route::delete('/user/avatar', [AvatarController::class, 'destroy'])->middleware('throttle:profile');

    // Passwort aendern, E-Mail-Adresse aendern, Konto loeschen. One shared budget: each checks the
    // password, or a code that only a password-checked request or the account's mailbox gets.
    Route::middleware('throttle:account-sensitive')->group(function () {
        Route::put('/user/password', [AccountController::class, 'updatePassword']);
        // An account without a password: a code to its address before its first one (F-04).
        Route::post('/user/password/code', [AccountController::class, 'sendFirstPasswordCode']);
        // E-Mail-Adresse aendern: only here, with the password (and code); F-04. The new address
        // takes effect only with the code mailed to it.
        Route::put('/user/email', [AccountController::class, 'updateEmail']);
        Route::post('/user/email/confirm', [AccountController::class, 'confirmEmail']);
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

    // Marktplatz: Partner und Angebote. The quote computes a price and writes nothing.
    Route::get('/offers', [MarketController::class, 'offers']);
    Route::get('/offers/{offer}', [MarketController::class, 'offer']);
    Route::post('/offers/{offer}/quote', [MarketController::class, 'quote']);
    Route::get('/offers/{offer}/availability', [BookingController::class, 'availability']);
    Route::get('/partners', [MarketController::class, 'partners']);
    Route::get('/partners/{partner}', [MarketController::class, 'partner']);

    // Buchungen. Whatever moves money or credits shares the `payments` limiter; redeeming at the
    // sticker shares `checkin` with the check-ins (both send a sticker's token).
    Route::get('/bookings', [BookingController::class, 'index']);
    Route::post('/bookings', [BookingController::class, 'store'])->middleware('throttle:payments');
    Route::get('/bookings/{id}', [BookingController::class, 'show'])->whereNumber('id');
    Route::post('/bookings/{id}/cancel', [BookingController::class, 'cancel'])->whereNumber('id')->middleware('throttle:payments');
    Route::post('/bookings/{id}/redeem', [BookingController::class, 'redeem'])->whereNumber('id')->middleware('throttle:checkin');
    Route::post('/bookings/{id}/feedback', [BookingController::class, 'feedback'])->whereNumber('id')->middleware('throttle:payments');

    // Abzeichen
    Route::get('/badges', [ClubController::class, 'badges']);

    // Club, Credits, Gutscheine
    Route::get('/club', [ClubController::class, 'show']);
    Route::post('/club/subscribe', [ClubController::class, 'subscribe'])->middleware('throttle:payments');
    Route::post('/club/cancel', [ClubController::class, 'cancel'])->middleware('throttle:payments');
    Route::get('/wallet', [ClubController::class, 'wallet']);
    Route::post('/wallet/purchase', [ClubController::class, 'purchase'])->middleware('throttle:payments');
    Route::post('/wallet/redeem', [ClubController::class, 'redeem'])->middleware('throttle:voucher-redeem');

    // Funktions-Schalter (App\Support\Features) und das Stadt-Bingo, sobald es freigeschaltet ist.
    Route::get('/features', [FeatureController::class, 'show']);
    Route::get('/bingo', [FeatureController::class, 'bingo']);
    Route::post('/bingo/claim', [FeatureController::class, 'claimBingo'])->middleware('throttle:payments');

    // Stempelkarte und Check-in
    Route::get('/stamps', [CheckinController::class, 'stamps']);
    Route::get('/pass', [CheckinController::class, 'pass']);
    Route::post('/checkins', [CheckinController::class, 'store'])->middleware('throttle:checkin');

    // Partner-Modus (Mitarbeitende eines Partners)
    Route::get('/partner/me', [PartnerStaffController::class, 'me']);
    Route::post('/partner/checkins', [PartnerStaffController::class, 'checkin'])->middleware('throttle:checkin');
    Route::get('/partner/bookings', [PartnerStaffController::class, 'bookings']);
    Route::post('/partner/bookings/{id}/redeem', [PartnerStaffController::class, 'redeem'])->whereNumber('id')->middleware('throttle:checkin');

    // Gruppen und Gruppen-Chat
    Route::get('/groups', [GroupController::class, 'index']);
    Route::post('/groups', [GroupController::class, 'store'])->middleware('throttle:write-content');
    Route::post('/groups/join', [GroupController::class, 'join'])->middleware('throttle:voucher-redeem');
    Route::get('/groups/invite/{code}', [GroupController::class, 'preview'])->middleware('throttle:voucher-redeem');
    Route::get('/groups/{id}', [GroupController::class, 'show'])->whereNumber('id');
    Route::patch('/groups/{id}', [GroupController::class, 'update'])->whereNumber('id')->middleware('throttle:write-content');
    Route::delete('/groups/{id}', [GroupController::class, 'destroy'])->whereNumber('id')->middleware('throttle:write-content');
    Route::post('/groups/{id}/invite-code', [GroupController::class, 'rotateCode'])->whereNumber('id')->middleware('throttle:write-content');
    Route::delete('/groups/{id}/members/{userId}', [GroupController::class, 'removeMember'])->whereNumber(['id', 'userId'])->middleware('throttle:write-content');
    Route::get('/groups/{id}/messages', [ChatController::class, 'index'])->whereNumber('id');
    Route::post('/groups/{id}/messages', [ChatController::class, 'store'])->whereNumber('id')->middleware('throttle:chat-send');
    Route::post('/groups/{id}/read', [ChatController::class, 'read'])->whereNumber('id')->middleware('throttle:write-state');
    Route::delete('/messages/{id}', [ChatController::class, 'destroy'])->whereNumber('id')->middleware('throttle:write-content');

    // Melden und Blockieren
    Route::post('/reports', [SafetyController::class, 'report'])->middleware('throttle:write-report');
    Route::get('/blocks', [SafetyController::class, 'blocks']);
    Route::post('/blocks', [SafetyController::class, 'block'])->middleware('throttle:write-block');
    Route::delete('/blocks/{userId}', [SafetyController::class, 'unblock'])->whereNumber('userId')->middleware('throttle:write-block');

    /*
    |-----------------------------------------------------------------------
    | Admin
    |-----------------------------------------------------------------------
    |
    | Every admin write shares the `write-admin` limiter: it caps what a stolen admin token can do
    | in a hurry.
    */
    Route::middleware('admin')->prefix('admin')->group(function () {
        Route::get('/stats', [Admin\DashboardController::class, 'stats']);
        Route::get('/bookings', [Admin\DashboardController::class, 'bookings']);
        Route::get('/reports', [Admin\DashboardController::class, 'reports']);
        Route::get('/users', [Admin\UserController::class, 'index']);
        Route::get('/users/{id}', [Admin\UserController::class, 'show'])->whereNumber('id');
        Route::get('/evidence', [Admin\UserController::class, 'evidence']);
        // Evidence images live outside every public folder (App\Support\Uploads::PRIVATE_DISK);
        // only this admin route reads them.
        Route::get('/evidence-files/{file}', [Admin\UserController::class, 'evidenceFile'])
            ->where('file', '[0-9a-f]{40}\.(jpg|png|webp)');
        Route::get('/partners', [Admin\PartnerController::class, 'index']);
        Route::get('/partners/{partner}', [Admin\PartnerController::class, 'show']);
        Route::get('/offers', [Admin\OfferController::class, 'index']);
        Route::get('/voucher-batches', [Admin\VoucherController::class, 'index']);
        Route::get('/voucher-batches/{batch}/codes.csv', [Admin\VoucherController::class, 'csv']);
        Route::get('/features', [Admin\FeatureController::class, 'show']);
        Route::get('/testphase', [Admin\TestPhaseController::class, 'show']);

        Route::middleware('throttle:write-admin')->group(function () {
            Route::patch('/reports/{id}', [Admin\DashboardController::class, 'updateReport'])->whereNumber('id');

            Route::patch('/users/{id}', [Admin\UserController::class, 'rename'])->whereNumber('id');
            Route::post('/users/{id}/ban', [Admin\UserController::class, 'ban'])->whereNumber('id');
            Route::post('/users/{id}/timeout', [Admin\UserController::class, 'timeout'])->whereNumber('id');
            Route::post('/users/{id}/unban', [Admin\UserController::class, 'unban'])->whereNumber('id');
            Route::post('/users/{id}/credits', [Admin\UserController::class, 'credits'])->whereNumber('id');
            Route::post('/users/{id}/stamps', [Admin\UserController::class, 'stamps'])->whereNumber('id');
            Route::delete('/users/{id}', [Admin\UserController::class, 'destroy'])->whereNumber('id');

            Route::post('/partners', [Admin\PartnerController::class, 'store']);
            Route::patch('/partners/{partner}', [Admin\PartnerController::class, 'update']);
            Route::delete('/partners/{partner}', [Admin\PartnerController::class, 'destroy']);
            Route::post('/partners/{partner}/image', [Admin\PartnerController::class, 'image']);
            Route::post('/partners/{partner}/rotate-token', [Admin\PartnerController::class, 'rotateToken']);
            Route::post('/partners/{partner}/staff', [Admin\PartnerController::class, 'addStaff']);
            Route::delete('/partners/{partner}/staff/{userId}', [Admin\PartnerController::class, 'removeStaff'])->whereNumber('userId');

            Route::post('/offers', [Admin\OfferController::class, 'store']);
            Route::patch('/offers/{offer}', [Admin\OfferController::class, 'update']);
            Route::delete('/offers/{offer}', [Admin\OfferController::class, 'destroy']);
            Route::post('/offers/{offer}/image', [Admin\OfferController::class, 'image']);

            Route::post('/voucher-batches', [Admin\VoucherController::class, 'store']);
            Route::post('/vouchers/disable', [Admin\VoucherController::class, 'disable']);

            // Funktions-Schalter: für alle Nutzer bzw. nur für das eigene Konto (Vorschau).
            Route::put('/features/{key}', [Admin\FeatureController::class, 'update']);
            Route::put('/features/{key}/preview', [Admin\FeatureController::class, 'preview']);

            // Testphase: Bingo, Challenges, Serie - nur fuer Admins (App\Support\TestPhase).
            Route::post('/testphase/claim', [Admin\TestPhaseController::class, 'claim']);
            Route::post('/testphase/challenges', [Admin\TestPhaseController::class, 'store']);
            Route::delete('/testphase/challenges/{id}', [Admin\TestPhaseController::class, 'destroy'])->whereNumber('id');
            Route::post('/testphase/examples', [Admin\TestPhaseController::class, 'examples']);
            Route::post('/testphase/choose', [Admin\TestPhaseController::class, 'choose']);
            Route::post('/testphase/wishes', [Admin\TestPhaseController::class, 'storeWish']);
            Route::post('/testphase/wishes/{id}/vote', [Admin\TestPhaseController::class, 'voteWish'])->whereNumber('id');
            Route::delete('/testphase/wishes/{id}', [Admin\TestPhaseController::class, 'destroyWish'])->whereNumber('id');
            Route::post('/testphase/shares', [Admin\TestPhaseController::class, 'storeShares']);
            Route::post('/testphase/shares/{id}/pay', [Admin\TestPhaseController::class, 'payShare'])->whereNumber('id');
            Route::post('/testphase/shares/{id}/decline', [Admin\TestPhaseController::class, 'declineShare'])->whereNumber('id');
            Route::post('/testphase/polls', [Admin\TestPhaseController::class, 'storePoll']);
            Route::post('/testphase/polls/{id}/vote', [Admin\TestPhaseController::class, 'votePoll'])->whereNumber('id');
            Route::post('/testphase/polls/{id}/close', [Admin\TestPhaseController::class, 'closePoll'])->whereNumber('id');
        });
    });
});
