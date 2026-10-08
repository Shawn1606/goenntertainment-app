<?php

use App\Models\User;
use App\Support\AdminAccount;
use App\Support\ClubMembership;
use App\Support\CreditReminders;
use App\Support\Retention;
use App\Support\Wallet;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Log;
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

/*
| The first admin account, before the public edge may start (F-05; App\Support\AdminAccount).
| Run once by the one-off `seed` service (deploy/README.md, First start), with ADMIN_EMAIL and
| ADMIN_PASSWORD set for that one run. Read from the process environment, not through config/:
| they are no setting of the app, and a cached configuration never holds them.
*/
Artisan::command('admin:create', function () {
    [$created, $message] = AdminAccount::create(getenv('ADMIN_EMAIL'), getenv('ADMIN_PASSWORD'));
    $created ? $this->info($message) : $this->error($message);

    return $created ? 0 : 1;
})->purpose('Das erste Admin-Konto anlegen (nur, wenn es noch keins gibt)');

/*
| The retention prune (F-16; App\Support\Retention): expired sign-in data and old evidence
| images go, every hour. Prints and logs counts only. Without settings outside production it
| prunes nothing; in production a missing or malformed setting stops it with an error in the log.
*/
Artisan::command('retention:prune', function () {
    $settings = Retention::settings();
    if ($settings === null) {
        $this->info('Retention prune: no retention settings; nothing was deleted.');

        return 0;
    }
    $counts = Retention::prune($settings['evidence_days'], $settings['token_days'], (int) config('sanctum.expiration'));
    $line = 'Retention prune: '.Retention::describe($counts);
    $this->info($line);
    $counts['filesFailed'] > 0 ? Log::warning($line) : Log::info($line);

    return 0;
})->purpose('Abgelaufene Anmeldedaten und alte Beweisbilder loeschen');

Schedule::command('retention:prune')->hourly()->withoutOverlapping();
