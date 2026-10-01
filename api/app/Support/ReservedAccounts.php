<?php

namespace App\Support;

use RuntimeException;

/**
 * Usernames and e-mail domains that only the system may use (F-05): the admin and the venue and
 * import hosts it creates itself. The list is shared/reserved-accounts.json, which the Node
 * server reads too (server/src/reserved-accounts.js); its "about" lines say why it exists.
 *
 * Applied where a username or an address is chosen: sign-up and PATCH /user
 * (AuthController), the e-mail change (AccountController). Compared without regard to case,
 * like the database compares them.
 *
 * Without the file nothing is accepted (an exception instead of an empty list), like the
 * word filter: a check that silently goes missing is found only after the name is taken.
 */
final class ReservedAccounts
{
    public const MSG_USERNAME = 'Dieser Benutzername ist reserviert – bitte wähle einen anderen.';

    public const MSG_EMAIL = 'Diese E-Mail-Adresse kann nicht verwendet werden.';

    private static ?self $default = null;

    /**
     * @param  list<string>  $usernames  lower-case
     * @param  list<string>  $domains  lower-case
     */
    private function __construct(
        private readonly array $usernames,
        private readonly array $domains,
    ) {}

    public static function default(): self
    {
        return self::$default ??= self::fromFile(self::defaultPath());
    }

    /** shared/ sits next to api/ in the repository and in the image (/var/www/shared). */
    public static function defaultPath(): string
    {
        return dirname(__DIR__, 3).'/shared/reserved-accounts.json';
    }

    public static function fromFile(string $path): self
    {
        $raw = is_readable($path) ? file_get_contents($path) : false;
        if ($raw === false) {
            throw new RuntimeException("Reserved accounts list not readable: {$path}");
        }

        $data = json_decode($raw, true);
        $usernames = is_array($data) ? ($data['usernames'] ?? null) : null;
        $domains = is_array($data) ? ($data['email_domains'] ?? null) : null;
        if (! self::isListOfNames($usernames) || ! self::isListOfNames($domains)) {
            throw new RuntimeException("Reserved accounts list needs non-empty 'usernames' and 'email_domains' lists: {$path}");
        }

        return new self(
            array_values(array_map(self::lower(...), $usernames)),
            array_values(array_map(self::lower(...), $domains)),
        );
    }

    public function isReservedUsername(mixed $username): bool
    {
        return is_string($username) && in_array(self::lower(trim($username)), $this->usernames, true);
    }

    /** The address's domain is a reserved one or below it ('x@goenntertainment.local', 'x@a.goenntertainment.local'). */
    public function isReservedEmail(mixed $email): bool
    {
        if (! is_string($email)) {
            return false;
        }

        $at = strrpos($email, '@');
        if ($at === false) {
            return false;
        }

        $domain = rtrim(self::lower(trim(substr($email, $at + 1))), '.');
        foreach ($this->domains as $reserved) {
            if ($domain === $reserved || str_ends_with($domain, '.'.$reserved)) {
                return true;
            }
        }

        return false;
    }

    private static function lower(string $value): string
    {
        return mb_strtolower($value, 'UTF-8');
    }

    private static function isListOfNames(mixed $list): bool
    {
        if (! is_array($list) || $list === [] || ! array_is_list($list)) {
            return false;
        }
        foreach ($list as $name) {
            if (! is_string($name) || trim($name) === '') {
                return false;
            }
        }

        return true;
    }
}
