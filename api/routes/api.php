<?php

use App\Http\Controllers\AccountController;
use App\Http\Controllers\Admin;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\BookingController;
use App\Http\Controllers\ChatController;
use App\Http\Controllers\CheckinController;
use App\Http\Controllers\ClubController;
use App\Http\Controllers\GoogleController;
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
 * und die Rueckfall-Route dorthin gibt es nicht mehr.
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
    } catch (Throwable) {
        return response()->json(['ok' => false], 500);
    }
});

/*
|---------------------------------------------------------------------------
| Anmeldung (ohne Token)
|---------------------------------------------------------------------------
*/

Route::post('/register', [AuthController::class, 'register']);
Route::post('/login', [AuthController::class, 'login'])->middleware('throttle:login');
Route::post('/forgot-password', [PasswordController::class, 'forgot']);
Route::post('/reset-password', [PasswordController::class, 'reset']);
Route::post('/auth/google', [GoogleController::class, 'store']);
Route::get('/interests', [InterestController::class, 'index']);

/*
| Zwei-Faktor-Anmeldung, zweiter Schritt. OHNE `auth:sanctum` - genau hier gibt
| es noch keinen Token; was die Anfrage traegt, ist der Vorgang (`challenge`)
| aus der Antwort von /login bzw. /auth/google. Siehe TwoFactorController.
*/
Route::post('/login/two-factor', [TwoFactorController::class, 'verifyLogin'])->middleware('throttle:two-factor');
Route::post('/login/two-factor/resend', [TwoFactorController::class, 'resendLogin'])->middleware('throttle:two-factor-resend');

/*
|---------------------------------------------------------------------------
| Angemeldet
|---------------------------------------------------------------------------
|
| `banned` laeuft immer NACH `auth:sanctum` - erst dann steht fest, wer anfragt.
*/

Route::middleware(['auth:sanctum', 'banned'])->group(function () {
    // Konto
    Route::post('/logout', [AuthController::class, 'logout']);
    Route::get('/user', [AuthController::class, 'show']);
    Route::patch('/user', [AuthController::class, 'update']);

    Route::middleware('throttle:account-sensitive')->group(function () {
        Route::put('/user/password', [AccountController::class, 'updatePassword']);
        Route::delete('/me', [AccountController::class, 'destroy']);
    });

    Route::middleware('throttle:two-factor-setup')->group(function () {
        Route::post('/user/two-factor/email', [TwoFactorController::class, 'startEmail']);
        Route::post('/user/two-factor/email/confirm', [TwoFactorController::class, 'confirmEmail']);
        Route::post('/user/two-factor/totp', [TwoFactorController::class, 'startTotp']);
        Route::post('/user/two-factor/totp/confirm', [TwoFactorController::class, 'confirmTotp']);
        Route::post('/user/two-factor/code', [TwoFactorController::class, 'sendConfirmCode']);
        Route::post('/user/two-factor/recovery-codes', [TwoFactorController::class, 'regenerateRecoveryCodes']);
        Route::delete('/user/two-factor', [TwoFactorController::class, 'disable']);
    });

    // Marktplatz: Partner und Angebote
    Route::get('/offers', [MarketController::class, 'offers']);
    Route::get('/offers/{offer}', [MarketController::class, 'offer']);
    Route::post('/offers/{offer}/quote', [MarketController::class, 'quote']);
    Route::get('/partners', [MarketController::class, 'partners']);
    Route::get('/partners/{partner}', [MarketController::class, 'partner']);

    // Buchungen
    Route::get('/bookings', [BookingController::class, 'index']);
    Route::post('/bookings', [BookingController::class, 'store'])->middleware('throttle:payments');
    Route::get('/bookings/{id}', [BookingController::class, 'show'])->whereNumber('id');
    Route::post('/bookings/{id}/cancel', [BookingController::class, 'cancel'])->whereNumber('id');
    Route::post('/bookings/{id}/redeem', [BookingController::class, 'redeem'])->whereNumber('id');

    // Club, Credits, Gutscheine
    Route::get('/club', [ClubController::class, 'show']);
    Route::post('/club/subscribe', [ClubController::class, 'subscribe'])->middleware('throttle:payments');
    Route::post('/club/cancel', [ClubController::class, 'cancel']);
    Route::get('/wallet', [ClubController::class, 'wallet']);
    Route::post('/wallet/purchase', [ClubController::class, 'purchase'])->middleware('throttle:payments');
    Route::post('/wallet/redeem', [ClubController::class, 'redeem'])->middleware('throttle:voucher-redeem');

    // Stempelkarte und Check-in
    Route::get('/stamps', [CheckinController::class, 'stamps']);
    Route::get('/pass', [CheckinController::class, 'pass']);
    Route::post('/checkins', [CheckinController::class, 'store'])->middleware('throttle:checkin');

    // Partner-Modus (Mitarbeitende eines Partners)
    Route::get('/partner/me', [PartnerStaffController::class, 'me']);
    Route::post('/partner/checkins', [PartnerStaffController::class, 'checkin'])->middleware('throttle:checkin');
    Route::get('/partner/bookings', [PartnerStaffController::class, 'bookings']);
    Route::post('/partner/bookings/{id}/redeem', [PartnerStaffController::class, 'redeem'])->whereNumber('id');

    // Gruppen und Gruppen-Chat
    Route::get('/groups', [GroupController::class, 'index']);
    Route::post('/groups', [GroupController::class, 'store']);
    Route::post('/groups/join', [GroupController::class, 'join'])->middleware('throttle:voucher-redeem');
    Route::get('/groups/invite/{code}', [GroupController::class, 'preview'])->middleware('throttle:voucher-redeem');
    Route::get('/groups/{id}', [GroupController::class, 'show'])->whereNumber('id');
    Route::patch('/groups/{id}', [GroupController::class, 'update'])->whereNumber('id');
    Route::delete('/groups/{id}', [GroupController::class, 'destroy'])->whereNumber('id');
    Route::post('/groups/{id}/invite-code', [GroupController::class, 'rotateCode'])->whereNumber('id');
    Route::delete('/groups/{id}/members/{userId}', [GroupController::class, 'removeMember'])->whereNumber(['id', 'userId']);
    Route::get('/groups/{id}/messages', [ChatController::class, 'index'])->whereNumber('id');
    Route::post('/groups/{id}/messages', [ChatController::class, 'store'])->whereNumber('id')->middleware('throttle:chat-send');
    Route::post('/groups/{id}/read', [ChatController::class, 'read'])->whereNumber('id');
    Route::delete('/messages/{id}', [ChatController::class, 'destroy'])->whereNumber('id');

    // Melden und Blockieren
    Route::post('/reports', [SafetyController::class, 'report']);
    Route::get('/blocks', [SafetyController::class, 'blocks']);
    Route::post('/blocks', [SafetyController::class, 'block']);
    Route::delete('/blocks/{userId}', [SafetyController::class, 'unblock'])->whereNumber('userId');

    /*
    |-----------------------------------------------------------------------
    | Admin
    |-----------------------------------------------------------------------
    */
    Route::middleware('admin')->prefix('admin')->group(function () {
        Route::get('/stats', [Admin\DashboardController::class, 'stats']);
        Route::get('/bookings', [Admin\DashboardController::class, 'bookings']);
        Route::get('/reports', [Admin\DashboardController::class, 'reports']);
        Route::patch('/reports/{id}', [Admin\DashboardController::class, 'updateReport'])->whereNumber('id');

        Route::get('/users', [Admin\UserController::class, 'index']);
        Route::patch('/users/{id}', [Admin\UserController::class, 'rename'])->whereNumber('id');
        Route::post('/users/{id}/ban', [Admin\UserController::class, 'ban'])->whereNumber('id');
        Route::post('/users/{id}/timeout', [Admin\UserController::class, 'timeout'])->whereNumber('id');
        Route::post('/users/{id}/unban', [Admin\UserController::class, 'unban'])->whereNumber('id');
        Route::post('/users/{id}/credits', [Admin\UserController::class, 'credits'])->whereNumber('id');
        Route::delete('/users/{id}', [Admin\UserController::class, 'destroy'])->whereNumber('id');
        Route::get('/evidence', [Admin\UserController::class, 'evidence']);

        Route::get('/partners', [Admin\PartnerController::class, 'index']);
        Route::post('/partners', [Admin\PartnerController::class, 'store']);
        Route::get('/partners/{partner}', [Admin\PartnerController::class, 'show']);
        Route::patch('/partners/{partner}', [Admin\PartnerController::class, 'update']);
        Route::delete('/partners/{partner}', [Admin\PartnerController::class, 'destroy']);
        Route::post('/partners/{partner}/image', [Admin\PartnerController::class, 'image']);
        Route::post('/partners/{partner}/rotate-token', [Admin\PartnerController::class, 'rotateToken']);
        Route::post('/partners/{partner}/staff', [Admin\PartnerController::class, 'addStaff']);
        Route::delete('/partners/{partner}/staff/{userId}', [Admin\PartnerController::class, 'removeStaff'])->whereNumber('userId');

        Route::get('/offers', [Admin\OfferController::class, 'index']);
        Route::post('/offers', [Admin\OfferController::class, 'store']);
        Route::patch('/offers/{offer}', [Admin\OfferController::class, 'update']);
        Route::delete('/offers/{offer}', [Admin\OfferController::class, 'destroy']);
        Route::post('/offers/{offer}/image', [Admin\OfferController::class, 'image']);

        Route::get('/voucher-batches', [Admin\VoucherController::class, 'index']);
        Route::post('/voucher-batches', [Admin\VoucherController::class, 'store']);
        Route::get('/voucher-batches/{batch}/codes.csv', [Admin\VoucherController::class, 'csv']);
        Route::post('/vouchers/disable', [Admin\VoucherController::class, 'disable']);
    });
});
