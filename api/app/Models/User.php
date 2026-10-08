<?php

namespace App\Models;

use App\Models\Concerns\SerializesMysqlDates;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Laravel\Sanctum\HasApiTokens;

/**
 * Ein Konto.
 *
 * ## Was hier ABSICHTLICH fehlt
 *
 * `Notifiable`. Der Zug ist verlockend, aber diese Anwendung hat eine eigene
 * Tabelle `notifications` mit eigenem Aufbau (user_id, actor_id, type, ref_id,
 * title, body, read_at - siehe schema.sql). Laravels Datenbank-Kanal erwartet
 * dort etwas voellig anderes (uuid, notifiable_type, data). Mit `Notifiable` am
 * Model zeigte `$user->notifications` auf dieselbe Tabelle mit falschen
 * Erwartungen - ein Fehler, der erst beim ersten Aufruf auffaellt. Die Glocke
 * bekommt darum ein eigenes Model.
 *
 * `is_admin` fehlt in `#[Fillable]`, und das ist der Kern der Rechtevergabe:
 * Sonst genuegte ein `is_admin: true` im Anmelde-Formular. Wo ein Admin gesetzt
 * wird, geschieht das durch ausdrueckliche Zuweisung im Admin-Bereich. Dasselbe
 * gilt fuer Club-Stufe und Credits: Die schreibt nur der Server selbst.
 */
#[Fillable([
    'name',
    'username',
    'email',
    'password',
    'account_type',
    'avatar',
    'banner',
    'terms_version',
    'terms_accepted_at',
])]
/**
 * Von der Zwei-Faktor-Anmeldung geht nur `two_factor_method` nach draussen - die
 * App muss wissen, OB und WIE, sonst nichts. Secret und Codes sind verschluesselt,
 * aber verschluesselt ist nicht dasselbe wie „darf raus": Jede Kopie ausserhalb
 * der DB ist eine, die man nicht zurueckholt. Dieselbe Liste steht in
 * `serializeUser` in server/src/auth.js.
 *
 * `google_id` is hidden too: Google sign-in was removed from both backends. The
 * column stays in the schema, inert (nothing reads or writes it), and neither
 * API returns it.
 */
#[Hidden([
    'password',
    'remember_token',
    'two_factor_secret',
    'two_factor_recovery_codes',
    'two_factor_confirmed_at',
    'two_factor_last_step',
    'google_id',
])]
class User extends Authenticatable
{
    use HasApiTokens, HasFactory, SerializesMysqlDates;

    /**
     * Ein „echter" Bann setzt `banned_until` weit in die Zukunft; ein Timeout
     * einen konkreten Zeitpunkt. NULL bedeutet aktiv.
     */
    public const PERMANENT_BAN_UNTIL = '9999-12-31 00:00:00';

    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
            'is_admin' => 'boolean',
            'banned_until' => 'datetime',
            'terms_accepted_at' => 'datetime',
            // The minimum age confirmed at sign-up and when (F-14). Not fillable: set by
            // AuthController::register from shared/legal.json, never from request data.
            'min_age_confirmed' => 'integer',
            'min_age_confirmed_at' => 'datetime',
            // Verschluesselt mit APP_KEY (siehe App\Support\TwoFactor). Die
            // Codes sind zusaetzlich einzeln gehasht - auch entschluesselt steht
            // dort nichts, das man eintippen koennte.
            'two_factor_secret' => 'encrypted',
            'two_factor_recovery_codes' => 'encrypted:array',
            'two_factor_confirmed_at' => 'datetime',
            'two_factor_last_step' => 'integer',
            // Club und Credits (Marktplatz). Geschrieben nur ueber
            // App\Support\ClubMembership und App\Support\Wallet.
            'club_since' => 'datetime',
            'club_renews_at' => 'datetime',
            'club_cancel_at_period_end' => 'boolean',
            'club_credits_next_at' => 'datetime',
            'credits_balance' => 'integer',
        ];
    }

    /** Die Partner, fuer die dieses Konto im Partner-Modus scannen darf. */
    public function staffPartners(): BelongsToMany
    {
        return $this->belongsToMany(Partner::class, 'partner_staff')->withPivot('role', 'created_at');
    }

    /** Die Gruppen, in denen dieses Konto Mitglied ist (auch die eigenen). */
    public function groups(): BelongsToMany
    {
        return $this->belongsToMany(Group::class, 'group_members', 'user_id', 'group_id')->withPivot('created_at');
    }

    /**
     * Die Kategorien dieses Kontos - nach Namen sortiert, wie bisher.
     *
     * `created_at`/`updated_at` und `pivot` blendet das Interest-Model aus, damit
     * genau die vier Felder herauskommen, die die App erwartet.
     */
    public function interests(): BelongsToMany
    {
        return $this->belongsToMany(Interest::class, 'interest_user')
            // Die Verknuepfungstabelle hat created_at/updated_at, und das vorige
            // Backend hat sie beim Anlegen gefuellt. Ohne diesen Zusatz blieben sie
            // NULL - ein stiller Unterschied in Zeilen, die niemand ansieht, bis
            // jemand nach dem Wann fragt.
            ->withTimestamps()
            ->orderBy('interests.name');
    }

    /** Ist das Konto aktuell gesperrt? (`banned_until` liegt in der Zukunft.) */
    public function isBanned(): bool
    {
        return $this->banned_until !== null && $this->banned_until->isFuture();
    }

    /**
     * Sperr-Details fuer die Anzeige beim Login: Grund, Ende und ob dauerhaft.
     *
     * `permanent` = das Ende liegt mehr als 100 Jahre in der Zukunft, also ein
     * echter Bann und kein Timeout. Dann bleibt `banned_until` bewusst leer: Ein
     * Datum im Jahr 9999 ist keine Auskunft, sondern Verwirrung.
     *
     * Das Datum kommt hier als ISO-8601 mit `Z`, nicht im Format der uebrigen
     * Zeitstempel - genau so lieferte es `banInfo()` in server/src/auth.js, und
     * die App liest daraus die Restdauer.
     */
    public function banInfo(): array
    {
        $until = $this->banned_until;
        $permanent = $until !== null
            && $until->greaterThan(CarbonImmutable::now()->addYears(100));

        return [
            'reason' => $this->ban_reason,
            'permanent' => $permanent,
            'banned_until' => ($permanent || $until === null)
                ? null
                : $until->format('Y-m-d\TH:i:s\Z'),
        ];
    }

    /**
     * Profil vollstaendig: Benutzername gesetzt und mindestens drei Kategorien
     * gewaehlt - daraus entstehen die Vorschlaege auf der Startseite. Die App
     * schickt sonst niemanden in die Anwendung.
     *
     * Die Kontostufe gehoert seit dem Marktplatz-Umbau nicht mehr dazu: Die alten
     * Stufen (Creator/Business) gibt es nicht mehr, und die Club-Stufe hat jedes
     * Konto von Anfang an (Free).
     */
    public function profileComplete(): bool
    {
        if ($this->username === null) {
            return false;
        }

        return $this->interests()->count() >= 3;
    }
}
