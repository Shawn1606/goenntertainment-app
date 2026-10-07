<?php

namespace App\Support;

use Illuminate\Database\ConnectionInterface;
use RuntimeException;

/**
 * Usernames and e-mail domains that only the system may use (F-05): the admin and the venue and
 * import hosts it creates itself. The list is shared/reserved-accounts.json, which the Node
 * server reads too (server/src/reserved-accounts.js); its "about" lines say why it exists.
 *
 * Applied where a username or an address is chosen: sign-up and PATCH /user
 * (AuthController), the e-mail change (AccountController). Usernames are compared without
 * regard to case; e-mail domains the way the database compares addresses
 * (isReservedEmailInDatabase).
 *
 * Without the file nothing is accepted (an exception instead of an empty list), like the
 * word filter: a check that silently goes missing is found only after the name is taken.
 */
final class ReservedAccounts
{
    public const MSG_USERNAME = 'Dieser Benutzername ist reserviert – bitte wähle einen anderen.';

    public const MSG_EMAIL = 'Diese E-Mail-Adresse kann nicht verwendet werden.';

    /**
     * The collation of users.email (server/schema.sql, the table's default). Named mirror:
     * tests/Feature/ReservedAccountsTest.php compares it with the column.
     */
    public const EMAIL_COLLATION = 'utf8mb4_unicode_ci';

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

    /**
     * The address's domain is a reserved one or below it ('x@goenntertainment.local',
     * 'x@a.goenntertainment.local'), compared after lower-casing. A quick check without the
     * database; sign-up and the e-mail change use isReservedEmailInDatabase(), which also
     * catches the spellings the database treats as equal.
     */
    public function isReservedEmail(mixed $email): bool
    {
        foreach (self::domainSuffixes($email) as $suffix) {
            if (in_array(self::lower($suffix), $this->domains, true)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Whether the address's domain is a reserved one or below it, as the database compares
     * addresses. The seed and the import find their accounts with a plain `email = ?`,
     * which compares under users.email's collation: it ignores case and accents, treats
     * full-width letters as their plain ones and expands ligatures such as œ to oe. A byte
     * comparison misses those, so an address that only looks different would be accepted and
     * later adopted as the system account. So MySQL itself compares each suffix of the domain
     * with each reserved domain under that collation (never a LIKE: a pattern does not apply the
     * expansions).
     *
     * A suffix counts when the character before it is one the database treats as a dot: besides
     * '.', the collation also equates the full-width full stop, so 'x@a．goenntertainment.local'
     * is an address below the reserved domain too. separatedSuffixes() lists the candidates.
     *
     * An address that is not valid UTF-8 cannot be compared, or stored, and is refused.
     */
    public function isReservedEmailInDatabase(mixed $email, ConnectionInterface $db): bool
    {
        if ($this->isReservedEmail($email)) {
            return true;
        }

        $domains = self::domainSuffixes($email);
        if ($domains === []) {
            return false;
        }
        if (! mb_check_encoding($domains[0], 'UTF-8')) {
            return true;
        }

        $candidates = self::separatedSuffixes($domains[0]);
        $rows = implode(' UNION ALL ', array_fill(
            0,
            count($candidates),
            'SELECT CONVERT(? USING utf8mb4) AS separator_char, CONVERT(? USING utf8mb4) AS suffix',
        ));
        $collation = self::EMAIL_COLLATION;
        $reserved = implode(', ', array_fill(0, count($this->domains), '?'));
        $hits = $db->selectOne(
            "SELECT COUNT(*) AS hits FROM ({$rows}) AS candidates "
            ."WHERE separator_char COLLATE {$collation} = '.' AND suffix COLLATE {$collation} IN ({$reserved})",
            [...array_merge(...$candidates), ...$this->domains],
        );

        return (int) ($hits->hits ?? 0) > 0;
    }

    /**
     * The whole domain (with '.' as its separator) and, after every character that may be a dot
     * to the database ('.' and every character outside ASCII), that character and the rest of the
     * domain: 'a．b.c' gives [['.', 'a．b.c'], ['．', 'b.c'], ['.', 'c']]. The database then keeps
     * the rows whose separator it treats as '.'. $domain must be valid UTF-8.
     *
     * @return list<array{string, string}>
     */
    public static function separatedSuffixes(string $domain): array
    {
        $candidates = [['.', $domain]];
        $characters = mb_str_split($domain, 1, 'UTF-8');
        $offset = 0;
        foreach ($characters as $character) {
            $offset += strlen($character);
            if ($character !== '.' && strlen($character) === 1) {
                continue;
            }
            $rest = substr($domain, $offset);
            if ($rest !== '') {
                $candidates[] = [$character, $rest];
            }
        }

        return $candidates;
    }

    /**
     * The domain of an address and every dot-suffix of it, longest first: 'x@a.b.c' gives
     * ['a.b.c', 'b.c', 'c']. The domain is the part after the last '@', trimmed, without
     * trailing dots. No '@' or no domain: an empty list.
     *
     * @return list<string>
     */
    public static function domainSuffixes(mixed $email): array
    {
        if (! is_string($email)) {
            return [];
        }

        $at = strrpos($email, '@');
        if ($at === false) {
            return [];
        }

        $domain = rtrim(trim(substr($email, $at + 1)), '.');
        if ($domain === '') {
            return [];
        }

        $suffixes = [$domain];
        for ($dot = strpos($domain, '.'); $dot !== false; $dot = strpos($domain, '.', $dot + 1)) {
            $suffix = substr($domain, $dot + 1);
            if ($suffix !== '') {
                $suffixes[] = $suffix;
            }
        }

        return $suffixes;
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
