<?php

namespace App\Mail;

use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;

/**
 * The mail with the 6-digit code an account without a password (created by the removed Google
 * sign-in) needs before it sets its first one (F-04; App\Support\AddressCode). It goes to the
 * account's own address: a session alone must not be able to give the account a password.
 *
 * Text only and not queued, like the other code mails, and neutral (no support channel or
 * contact).
 */
class FirstPasswordCode extends Mailable
{
    public function __construct(
        public readonly string $code,
        public readonly int $minutes,
    ) {}

    public function envelope(): Envelope
    {
        return new Envelope(subject: 'Dein GÖ4Fun-Code für dein erstes Passwort');
    }

    public function content(): Content
    {
        return new Content(text: 'mail.first-password-code');
    }
}
