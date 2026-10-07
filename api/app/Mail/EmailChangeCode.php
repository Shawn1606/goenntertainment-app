<?php

namespace App\Mail;

use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;

/**
 * The mail with the 6-digit code that confirms a new e-mail address (F-04;
 * App\Support\AddressCode). It goes to the NEW address: the change takes effect only when the
 * code comes back, so the account can only move to an address whose mail its owner reads.
 *
 * Text only and not queued, like TwoFactorCode and PasswordResetCode, and neutral (no support
 * channel or contact). The last sentence matters most: whoever gets this unexpectedly can simply
 * ignore it, and nothing changes.
 */
class EmailChangeCode extends Mailable
{
    public function __construct(
        public readonly string $code,
        public readonly int $minutes,
    ) {}

    public function envelope(): Envelope
    {
        return new Envelope(subject: 'Dein GÖ4Fun-Code für deine neue E-Mail-Adresse');
    }

    public function content(): Content
    {
        return new Content(text: 'mail.email-change-code');
    }
}
