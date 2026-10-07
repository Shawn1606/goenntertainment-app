<?php

namespace App\Support;

use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * Bilder speichern - Partner-Logos, Titelbilder, Angebotsbilder, Beweisfotos,
 * Profilbilder.
 *
 * Alles landet auf der Platte `public` (config/filesystems.php) unter einem
 * zufaelligen Namen; in der Datenbank steht der relative Pfad, die Adresse baut
 * App\Support\Media bei jeder Antwort neu.
 *
 * Partner-, Angebots- und Beweisbilder laden nur Admins hoch; Nutzer:innen nur
 * ihr eigenes Profilbild (AvatarController). Eine KI-Pruefung gibt es nicht -
 * unpassende Profilbilder laufen ueber Melden und den Admin-Bereich.
 */
final class Uploads
{
    public const MAX_KB = 5120;

    public const MIMES = ['jpeg', 'jpg', 'png', 'webp'];

    /** Validierungsregel fuer ein Bildfeld. */
    public static function rule(): array
    {
        return ['required', 'file', 'image', 'mimes:'.implode(',', self::MIMES), 'max:'.self::MAX_KB];
    }

    public static function store(UploadedFile $file, string $folder): string
    {
        $extension = strtolower($file->extension() ?: 'jpg');
        $name = Str::lower(Str::random(40)).'.'.($extension === 'jpeg' ? 'jpg' : $extension);

        Storage::disk('public')->putFileAs($folder, $file, $name);

        return $folder.'/'.$name;
    }

    /** Altes Bild entfernen - fremde Adressen und leere Werte fasst das nicht an. */
    public static function delete(?string $path): void
    {
        if ($path === null || $path === '' || preg_match('#^https?://#i', $path) === 1 || str_contains($path, '..')) {
            return;
        }

        Storage::disk('public')->delete($path);
    }
}
