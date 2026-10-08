<?php

namespace App\Support;

use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;

/**
 * Bilder speichern - Partner-Logos, Titelbilder, Angebotsbilder, Beweisfotos,
 * Profilbilder.
 *
 * Every image goes through App\Support\ImageCheck first: only a decodable JPEG, PNG or WebP gets
 * in, and what is stored is a fresh encoding of its pixels without metadata (no EXIF, no GPS
 * position, nothing appended), never the uploaded bytes. The stored name is random (40 hex
 * characters, the name the media file server and the edge allow, deploy/Caddyfile) with the
 * extension of the decoded format; in der Datenbank steht der relative Pfad, die Adresse baut
 * App\Support\Media bei jeder Antwort neu.
 *
 * Public folders live on the disk `public` (config/filesystems.php, UPLOADS_ROOT), which the media
 * file server hands out under /storage. Evidence images live on the disk `private`
 * (PRIVATE_MEDIA_ROOT), outside every public folder: only the admin route
 * GET /api/admin/evidence-files/{file} reads them (Admin\UserController::evidenceFile).
 *
 * Partner-, Angebots- und Beweisbilder laden nur Admins hoch; Nutzer:innen nur
 * ihr eigenes Profilbild (AvatarController). Eine KI-Pruefung gibt es nicht -
 * unpassende Profilbilder laufen ueber Melden und den Admin-Bereich.
 */
final class Uploads
{
    public const MAX_KB = 5120;

    public const MIMES = ['jpeg', 'jpg', 'png', 'webp'];

    public const PUBLIC_DISK = 'public';

    public const PRIVATE_DISK = 'private';

    /** Folders served as plain files (deploy/Caddyfile and deploy/Caddyfile.media allow exactly these). */
    public const PUBLIC_FOLDERS = ['avatars', 'partners', 'offers'];

    /** Folders that are never served as files. */
    public const PRIVATE_FOLDERS = ['evidence'];

    /** A stored file's name. */
    public const STORED_NAME = '/^[0-9a-f]{40}\.(jpg|png|webp)$/';

    /** Validierungsregel fuer ein Bildfeld (the first, cheap check; ImageCheck decides). */
    public static function rule(): array
    {
        return ['required', 'file', 'image', 'mimes:'.implode(',', self::MIMES), 'max:'.self::MAX_KB];
    }

    /**
     * Checks the image, encodes it again and stores it in $folder. A file that is no acceptable
     * image is refused with $message at $field (422), the message the route already uses for a
     * wrong file type.
     */
    public static function store(UploadedFile $file, string $folder, string $field = 'image', string $message = 'Bitte ein Bild wählen (jpg, png oder webp, höchstens 5 MB).'): string
    {
        if (! in_array($folder, [...self::PUBLIC_FOLDERS, ...self::PRIVATE_FOLDERS], true)) {
            throw new \LogicException("Uploads: unknown folder '{$folder}'.");
        }

        $bytes = (string) file_get_contents($file->getRealPath());
        try {
            $image = ImageCheck::reencode($bytes);
        } catch (ImageRejected) {
            throw ValidationException::withMessages([$field => [$message]]);
        }

        $path = $folder.'/'.bin2hex(random_bytes(20)).'.'.$image['ext'];
        if (! Storage::disk(self::diskFor($path))->put($path, $image['bytes'])) {
            throw new \RuntimeException('Uploads: the image could not be written.');
        }

        return $path;
    }

    /** Altes Bild entfernen - fremde Adressen und leere Werte fasst das nicht an. */
    public static function delete(?string $path): void
    {
        if (! self::isStored($path)) {
            return;
        }

        Storage::disk(self::diskFor($path))->delete($path);
    }

    /** A path this helper stores ('folder/name.ext' in a known folder), not a foreign address. */
    public static function isStored(mixed $path): bool
    {
        if (! is_string($path) || $path === '' || preg_match('#^https?://#i', $path) === 1 || str_contains($path, '..')) {
            return false;
        }
        $parts = explode('/', $path);

        return count($parts) === 2
            && in_array($parts[0], [...self::PUBLIC_FOLDERS, ...self::PRIVATE_FOLDERS], true)
            && preg_match(self::STORED_NAME, $parts[1]) === 1;
    }

    /** The disk a stored path lives on: private folders on the private disk, the rest on the public one. */
    public static function diskFor(string $path): string
    {
        return self::isPrivate($path) ? self::PRIVATE_DISK : self::PUBLIC_DISK;
    }

    public static function isPrivate(string $path): bool
    {
        return in_array(explode('/', $path, 2)[0], self::PRIVATE_FOLDERS, true);
    }

    /** The type a stored file is served as, from its extension. */
    public static function mimeFor(string $name): string
    {
        return match (strtolower(pathinfo($name, PATHINFO_EXTENSION))) {
            'png' => 'image/png',
            'webp' => 'image/webp',
            default => 'image/jpeg',
        };
    }
}
