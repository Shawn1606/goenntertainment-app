<?php

namespace App\Mail;

use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use InvalidArgumentException;

/**
 * A notice that a security setting of the account changed (F-04, F-19): the e-mail address (sent
 * to the PREVIOUS address), or the two-factor sign-in (switched on, switched off, new recovery
 * codes). The owner's only signal that someone else may have done it.
 *
 * Text only and not queued, like TwoFactorCode. Neutral wording: it names no support channel or
 * contact (that is the operator's decision, not the code's).
 */
class AccountSecurityNotice extends Mailable
{
    public const EMAIL_CHANGED = 'email_changed';

    public const TWO_FACTOR_ENABLED = 'two_factor_enabled';

    public const TWO_FACTOR_DISABLED = 'two_factor_disabled';

    public const RECOVERY_CODES_RENEWED = 'recovery_codes_renewed';

    private const SUBJECTS = [
        self::EMAIL_CHANGED => 'Deine E-Mail-Adresse bei GÖ4Fun wurde geändert',
        self::TWO_FACTOR_ENABLED => 'Zwei-Faktor-Anmeldung eingeschaltet',
        self::TWO_FACTOR_DISABLED => 'Zwei-Faktor-Anmeldung ausgeschaltet',
        self::RECOVERY_CODES_RENEWED => 'Neue Wiederherstellungscodes',
    ];

    /** The text of the mail (one paragraph per line). */
    public readonly string $text;

    /**
     * @param  string|null  $maskedAddress  for EMAIL_CHANGED: the new address, masked (TwoFactor::maskEmail)
     */
    public function __construct(
        public readonly string $kind,
        ?string $maskedAddress = null,
    ) {
        if (! array_key_exists($kind, self::SUBJECTS)) {
            throw new InvalidArgumentException("Unknown account security notice: {$kind}");
        }

        $this->text = implode("\n\n", match ($kind) {
            self::EMAIL_CHANGED => [
                'Die E-Mail-Adresse deines GÖ4Fun-Kontos wurde gerade auf '.($maskedAddress ?? '***').' geändert. Alle anderen Geräte wurden abgemeldet.',
                'Falls du das nicht warst, kennt jemand anderes dein Passwort.',
            ],
            self::TWO_FACTOR_ENABLED => [
                'Für dein GÖ4Fun-Konto ist die Zwei-Faktor-Anmeldung jetzt eingeschaltet. Andere Geräte wurden abgemeldet.',
                'Falls du das nicht warst, ändere sofort dein Passwort.',
            ],
            self::TWO_FACTOR_DISABLED => [
                'Für dein GÖ4Fun-Konto ist die Zwei-Faktor-Anmeldung jetzt ausgeschaltet. Andere Geräte wurden abgemeldet.',
                'Falls du das nicht warst, ändere sofort dein Passwort.',
            ],
            self::RECOVERY_CODES_RENEWED => [
                'Für dein GÖ4Fun-Konto wurden neue Wiederherstellungscodes erstellt; die alten gelten nicht mehr. Andere Geräte wurden abgemeldet.',
                'Falls du das nicht warst, ändere sofort dein Passwort.',
            ],
        });
    }

    public function envelope(): Envelope
    {
        return new Envelope(subject: self::SUBJECTS[$this->kind]);
    }

    public function content(): Content
    {
        return new Content(text: 'mail.account-security-notice');
    }
}
