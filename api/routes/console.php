<?php

use App\Models\User;
use App\Support\ClubMembership;
use App\Support\CreditReminders;
use App\Support\Wallet;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

/*
| Club-Abos verlaengern bzw. auslaufen lassen. Laeuft stuendlich, damit ein Abo
| nicht bis zum naechsten Tag „haengt"; bearbeitet werden nur faellige.
*/
Artisan::command('club:renew', function () {
    $count = ClubMembership::renewDue();
    $this->info("{$count} Abo(s) bearbeitet.");
})->purpose('Faellige Club-Abos verlaengern oder auslaufen lassen');

Schedule::command('club:renew')->hourly()->withoutOverlapping();

/*
| Credits verfallen je Gutschrift nach validDays (shared/club.json). Wallet bucht
| faellige Posten auch vor jeder Bewegung aus; der Zeitplan sorgt dafuer, dass
| der Stand in der Kopfzeile auch ohne Bewegung stimmt.
*/
Artisan::command('credits:expire', function () {
    $count = Wallet::expireDue();
    $this->info("{$count} Konto/Konten mit verfallenen Credits bearbeitet.");
})->purpose('Verfallene Credits ausbuchen');

Schedule::command('credits:expire')->everyFiveMinutes()->withoutOverlapping();

/*
| Verfall-Erinnerung per Mail, 30 und 7 Tage vorher (App\Support\CreditReminders).
| Einmal am Vormittag - niemand soll nachts Post von uns bekommen.
*/
Artisan::command('credits:remind', function () {
    $sent = CreditReminders::sendDue();
    $this->info("{$sent} Erinnerung(en) verschickt.");
})->purpose('An bald verfallende Credits erinnern');

Schedule::command('credits:remind')->dailyAt('10:00')->withoutOverlapping();

/*
| Ein Konto zum Admin machen - der einzige Weg dorthin. Die App vergibt keine
| Admin-Rechte, und `is_admin` ist nicht per Formular setzbar (App\Models\User).
|
|   php artisan admin:grant name@example.com
*/
Artisan::command('admin:grant {email} {--revoke}', function (string $email) {
    $user = User::where('email', $email)->first();
    if ($user === null) {
        $this->error("Kein Konto mit {$email}.");

        return 1;
    }

    $user->forceFill(['is_admin' => ! $this->option('revoke')])->save();
    $this->info($this->option('revoke') ? "{$email} ist kein Admin mehr." : "{$email} ist jetzt Admin.");

    return 0;
})->purpose('Admin-Rechte vergeben oder entziehen');
