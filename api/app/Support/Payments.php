<?php

namespace App\Support;

use App\Models\Payment;
use App\Models\User;
use Illuminate\Support\Str;
use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * Bezahlen - vorerst im Testmodus.
 *
 * ## Warum ein Testmodus
 *
 * Fuer echte Zahlungen fehlen noch Anbieter-Konto, Gewerbe und AGB. Der Ablauf in
 * der App (Credits kaufen, Club abschliessen, Buchung bezahlen) soll trotzdem
 * vollstaendig laufen und pruefbar sein. `charge` legt deshalb im Testmodus eine
 * Zahlung an, die sofort als bezahlt gilt - klar markiert mit provider `test`.
 *
 * Ein echter Anbieter (z. B. Stripe) kommt spaeter HIER hinein: `charge` gibt
 * dann erst nach dessen Bestaetigung eine Zahlung zurueck. Alles, was
 * Zahlungen nutzt, bleibt unveraendert.
 *
 * ## Sicherung
 *
 * `club.payments` = `test` | `off`. In Produktion ist die Vorgabe `off` - sonst
 * verschenkte ein vergessener Schalter Credits und Club-Stufen an jeden. Dann
 * antwortet jede Zahlung mit 503 und einer Meldung, die die App zeigt.
 */
final class Payments
{
    public static function mode(): string
    {
        return (string) config('club.payments');
    }

    public static function enabled(): bool
    {
        return self::mode() === 'test';
    }

    public static function charge(User $user, string $purpose, int $amountCents, string $description): Payment
    {
        if (! self::enabled()) {
            throw new HttpException(503, 'Bezahlen ist noch nicht freigeschaltet. Schau bald wieder vorbei!');
        }

        return Payment::create([
            'user_id' => $user->getKey(),
            'purpose' => $purpose,
            'amount_cents' => $amountCents,
            'provider' => 'test',
            'provider_ref' => 'test_'.Str::lower(Str::random(16)),
            'status' => 'succeeded',
            'description' => mb_substr($description, 0, 200),
        ]);
    }

    /** Erstattung - im Testmodus nur der Vermerk. */
    public static function refund(Payment $payment): void
    {
        $payment->update(['status' => 'refunded']);
    }
}
