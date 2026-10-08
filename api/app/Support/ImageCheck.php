<?php

namespace App\Support;

use ErrorException;
use Throwable;

/**
 * Uploaded images: only real JPEG, PNG and WebP files get in, and what is stored is a fresh
 * encoding of their pixels, never the uploaded bytes. The same rules as the former Node backend's
 * check (server/src/images.js), for the uploads Laravel takes now (App\Support\Uploads):
 *
 *   1. The first bytes must be the signature of a JPEG, PNG or WebP file. The type the client
 *      declares only decides which message it gets; the stored extension comes from the bytes.
 *   2. GD decodes the whole image. Bytes that are not a decodable image of that very format (a
 *      cut-off file, a broken checksum, a container that says one format and holds another) are
 *      refused, and so is any warning of the decoder. Images over MAX_INPUT_PIXELS, or larger
 *      than the memory this request has left, are refused before they are decoded.
 *   3. The pixels are encoded again in the same format, turned upright first (a JPEG's EXIF
 *      orientation is applied, then dropped). The new file carries no metadata: no EXIF, no GPS
 *      position, no text chunks, nothing appended after the image. Pixel size stays as uploaded.
 *
 * Without GD (or without its JPEG, PNG or WebP support) every image is refused: nothing is ever
 * stored unchecked. The api image installs gd and exif (api/Dockerfile).
 */
final class ImageCheck
{
    /**
     * Largest accepted image in pixels (width x height), as in server/src/images.js: a resource
     * guard against images that are small as files but huge once decoded, not a quality limit.
     */
    public const MAX_INPUT_PIXELS = 50_000_000;

    /** The formats that get in, with the stored extension and the type the file is served as. */
    public const FORMATS = [
        'jpeg' => ['ext' => 'jpg', 'mime' => 'image/jpeg'],
        'png' => ['ext' => 'png', 'mime' => 'image/png'],
        'webp' => ['ext' => 'webp', 'mime' => 'image/webp'],
    ];

    /** Bytes per decoded pixel GD keeps for a true-colour image, plus room for the encoder. */
    private const BYTES_PER_PIXEL = 5;

    private const JPEG_QUALITY = 85;

    private const WEBP_QUALITY = 85;

    /** The format a file's signature names: 'jpeg', 'png', 'webp' or null. */
    public static function sniff(string $bytes): ?string
    {
        if (strlen($bytes) >= 3 && str_starts_with($bytes, "\xFF\xD8\xFF")) {
            return 'jpeg';
        }
        if (strlen($bytes) >= 8 && str_starts_with($bytes, "\x89PNG\r\n\x1A\n")) {
            return 'png';
        }
        if (strlen($bytes) >= 12 && substr($bytes, 0, 4) === 'RIFF' && substr($bytes, 8, 4) === 'WEBP') {
            return 'webp';
        }

        return null;
    }

    /**
     * Decodes $bytes completely and encodes the pixels again without metadata.
     *
     * @return array{bytes: string, ext: string, mime: string, width: int, height: int}
     *
     * @throws ImageRejected when the bytes are not an acceptable JPEG, PNG or WebP image
     */
    public static function reencode(string $bytes): array
    {
        $format = self::sniff($bytes);
        if ($format === null) {
            throw new ImageRejected('not a JPEG, PNG or WebP signature');
        }
        if (! self::supports($format)) {
            throw new ImageRejected("this server cannot decode {$format} (GD missing)");
        }

        $info = @getimagesizefromstring($bytes);
        $types = ['jpeg' => IMAGETYPE_JPEG, 'png' => IMAGETYPE_PNG, 'webp' => IMAGETYPE_WEBP];
        if (! is_array($info) || ($info[2] ?? null) !== $types[$format]) {
            throw new ImageRejected('the signature and the image header differ');
        }
        [$width, $height] = [(int) $info[0], (int) $info[1]];
        if ($width < 1 || $height < 1 || $width * $height > self::MAX_INPUT_PIXELS) {
            throw new ImageRejected('the image is larger than MAX_INPUT_PIXELS');
        }
        if (! self::memoryFor($width, $height)) {
            throw new ImageRejected('not enough memory left to decode the image');
        }

        // The signature and the header named the same format above; GD decodes the bytes as given.
        $image = self::quietly(fn () => imagecreatefromstring($bytes));
        if (! $image instanceof \GdImage) {
            throw new ImageRejected('the image could not be decoded');
        }

        try {
            if ($format === 'jpeg') {
                $image = self::upright($image, $bytes);
            }
            $out = self::quietly(fn () => self::encode($image, $format));
            if (! is_string($out) || $out === '') {
                throw new ImageRejected('the image could not be encoded again');
            }

            return [
                'bytes' => $out,
                'ext' => self::FORMATS[$format]['ext'],
                'mime' => self::FORMATS[$format]['mime'],
                'width' => imagesx($image),
                'height' => imagesy($image),
            ];
        } finally {
            imagedestroy($image);
        }
    }

    /** Whether this PHP can decode and encode $format. */
    public static function supports(string $format): bool
    {
        if (! function_exists('gd_info')) {
            return false;
        }
        $gd = gd_info();

        return match ($format) {
            'jpeg' => ($gd['JPEG Support'] ?? false) === true,
            'png' => ($gd['PNG Support'] ?? false) === true,
            'webp' => ($gd['WebP Support'] ?? false) === true,
            default => false,
        };
    }

    private static function encode(\GdImage $image, string $format): string|false
    {
        ob_start();
        try {
            $ok = match ($format) {
                'jpeg' => imagejpeg($image, null, self::JPEG_QUALITY),
                'png' => (function () use ($image): bool {
                    imagealphablending($image, false);
                    imagesavealpha($image, true);

                    return imagepng($image);
                })(),
                'webp' => (function () use ($image): bool {
                    imagealphablending($image, false);
                    imagesavealpha($image, true);

                    return imagewebp($image, null, self::WEBP_QUALITY);
                })(),
            };
            $out = ob_get_contents();
        } finally {
            ob_end_clean();
        }

        return $ok ? $out : false;
    }

    /**
     * Applies a JPEG's EXIF orientation to the pixels (the tag is dropped with all other
     * metadata, so the stored image must already stand upright). Without the exif extension the
     * image stays as decoded.
     */
    private static function upright(\GdImage $image, string $bytes): \GdImage
    {
        if (! function_exists('exif_read_data')) {
            return $image;
        }
        $stream = fopen('php://memory', 'r+b');
        if ($stream === false) {
            return $image;
        }
        try {
            fwrite($stream, $bytes);
            rewind($stream);
            $exif = @exif_read_data($stream);
        } finally {
            fclose($stream);
        }
        $orientation = is_array($exif) ? (int) ($exif['Orientation'] ?? 1) : 1;

        $steps = [
            2 => [0, IMG_FLIP_HORIZONTAL],
            3 => [180, null],
            4 => [0, IMG_FLIP_VERTICAL],
            5 => [270, IMG_FLIP_HORIZONTAL],
            6 => [270, null],
            7 => [90, IMG_FLIP_HORIZONTAL],
            8 => [90, null],
        ][$orientation] ?? null;
        if ($steps === null) {
            return $image;
        }

        [$angle, $flip] = $steps;
        if ($angle !== 0) {
            $rotated = imagerotate($image, $angle, 0);
            if (! $rotated instanceof \GdImage) {
                throw new ImageRejected('the image could not be turned upright');
            }
            imagedestroy($image);
            $image = $rotated;
        }
        if ($flip !== null) {
            imageflip($image, $flip);
        }

        return $image;
    }

    /** Whether decoding a $width x $height image fits into the memory this request has left. */
    private static function memoryFor(int $width, int $height): bool
    {
        $limit = self::bytes((string) ini_get('memory_limit'));
        if ($limit < 0) {
            return true;
        }

        return memory_get_usage() + $width * $height * self::BYTES_PER_PIXEL < $limit;
    }

    /** php.ini shorthand ('256M') in bytes; -1 for no limit. */
    private static function bytes(string $value): int
    {
        $value = trim($value);
        if ($value === '' || $value === '-1') {
            return -1;
        }
        $number = (int) $value;

        return match (strtolower(substr($value, -1))) {
            'g' => $number * 1024 ** 3,
            'm' => $number * 1024 ** 2,
            'k' => $number * 1024,
            default => $number,
        };
    }

    /**
     * Runs a GD call with every warning turned into a refusal: GD reports a cut-off or corrupt
     * file as a warning and may still return pixels.
     */
    private static function quietly(callable $call): mixed
    {
        set_error_handler(static function (int $severity, string $message): bool {
            throw new ErrorException($message, 0, $severity);
        });
        try {
            return $call();
        } catch (ImageRejected $e) {
            throw $e;
        } catch (Throwable) {
            throw new ImageRejected('the image could not be decoded');
        } finally {
            restore_error_handler();
        }
    }
}
