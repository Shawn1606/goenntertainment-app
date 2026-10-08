<?php

namespace Tests\Feature;

use App\Support\ImageCheck;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;
use Tests\AppFeatureTestCase;

/**
 * Uploaded images (App\Support\Uploads, App\Support\ImageCheck): only a decodable JPEG, PNG or WebP
 * gets in, and what is stored is a fresh encoding of its pixels - no metadata, nothing appended,
 * turned upright, with the extension of what the bytes are. The same rules as the former Node
 * backend's check (server/src/images.js and its tests), here on the profile image route; the admin
 * routes (partner, offer, evidence images) store through the same helper.
 *
 * The images are made with GD, which the api image installs (api/Dockerfile).
 */
class ImageUploadTest extends AppFeatureTestCase
{
    private const MESSAGE = 'Bitte ein Bild wählen (jpg, png oder webp, höchstens 5 MB).';

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('public');
        Storage::fake('private');
        $this->assertTrue(ImageCheck::supports('jpeg') && ImageCheck::supports('png') && ImageCheck::supports('webp'), 'GD with JPEG, PNG and WebP is needed');
    }

    private static function image(int $width, int $height, string $format): string
    {
        $image = imagecreatetruecolor($width, $height);
        imagefilledrectangle($image, 0, 0, $width - 1, $height - 1, (int) imagecolorallocate($image, 200, 40, 90));
        imagefilledrectangle($image, 0, 0, intdiv($width, 2), intdiv($height, 2), (int) imagecolorallocate($image, 20, 160, 60));
        ob_start();
        match ($format) {
            'jpeg' => imagejpeg($image, null, 90),
            'png' => imagepng($image),
            'webp' => imagewebp($image, null, 90),
        };
        imagedestroy($image);

        return (string) ob_get_clean();
    }

    /**
     * A JPEG with an EXIF segment right after its start marker: an ImageDescription (the marker
     * text) and, if given, an Orientation.
     */
    private static function jpegWithExif(string $jpeg, string $marker, ?int $orientation = null): string
    {
        $entries = [];
        $text = $marker."\0";
        $count = $orientation === null ? 1 : 2;
        $dataOffset = 8 + 2 + 12 * $count + 4;
        $entries[] = pack('nnNN', 0x010E, 2, strlen($text), $dataOffset);
        if ($orientation !== null) {
            $entries[] = pack('nnNnn', 0x0112, 3, 1, $orientation, 0);
        }
        $tiff = 'MM'.pack('nN', 42, 8).pack('n', $count).implode('', $entries).pack('N', 0).$text;
        $app1 = "Exif\0\0".$tiff;

        return substr($jpeg, 0, 2)."\xFF\xE1".pack('n', strlen($app1) + 2).$app1.substr($jpeg, 2);
    }

    private function upload(string $bytes, string $name): TestResponse
    {
        $user = $this->makeUser();

        return $this->withBearer($this->issueToken($user))->post('/api/user/avatar', [
            'image' => UploadedFile::fake()->createWithContent($name, $bytes),
        ], ['Accept' => 'application/json']);
    }

    /** The stored file of an accepted upload: [path, bytes]. */
    private function stored(TestResponse $response): array
    {
        $url = (string) $response->assertOk()->json('user.avatar');
        $this->assertMatchesRegularExpression('#/storage/avatars/[0-9a-f]{40}\.(jpg|png|webp)$#', $url);
        $path = 'avatars/'.basename($url);
        Storage::disk('public')->assertExists($path);

        return [$path, (string) Storage::disk('public')->get($path)];
    }

    public function test_every_accepted_format_is_stored_as_a_new_encoding_of_its_pixels(): void
    {
        foreach (['jpeg' => 'jpg', 'png' => 'png', 'webp' => 'webp'] as $format => $ext) {
            $bytes = self::image(64, 48, $format);
            [$path, $stored] = $this->stored($this->upload($bytes, "photo.{$ext}"));

            $this->assertStringEndsWith(".{$ext}", $path);
            $this->assertSame($format, ImageCheck::sniff($stored));
            $this->assertSame([64, 48], array_slice((array) getimagesizefromstring($stored), 0, 2));
        }
    }

    public function test_metadata_is_dropped(): void
    {
        $marker = 'GPS-FIXTURE-MARKER-'.bin2hex(random_bytes(4));
        $upload = self::jpegWithExif(self::image(40, 30, 'jpeg'), $marker);
        $this->assertStringContainsString($marker, $upload);

        [, $stored] = $this->stored($this->upload($upload, 'photo.jpg'));

        $this->assertStringNotContainsString($marker, $stored);
        $this->assertStringNotContainsString('Exif', $stored);
    }

    public function test_bytes_appended_after_the_image_are_not_stored(): void
    {
        $payload = '<?php echo "fixture-not-code"; ?>';

        [, $stored] = $this->stored($this->upload(self::image(32, 32, 'png').$payload, 'photo.png'));

        $this->assertStringNotContainsString('<?php', $stored);
    }

    public function test_the_extension_comes_from_the_bytes_not_from_the_name(): void
    {
        [$path] = $this->stored($this->upload(self::image(20, 20, 'png'), 'photo.jpg'));

        $this->assertStringEndsWith('.png', $path);
    }

    public function test_the_exif_orientation_is_applied_before_it_is_dropped(): void
    {
        if (! function_exists('exif_read_data')) {
            $this->fail('the exif extension is needed (the api image installs it)');
        }
        [, $stored] = $this->stored($this->upload(self::jpegWithExif(self::image(40, 20, 'jpeg'), 'turn', 6), 'photo.jpg'));

        $this->assertSame([20, 40], array_slice((array) getimagesizefromstring($stored), 0, 2));
    }

    public function test_what_is_no_decodable_image_is_refused_and_nothing_is_stored(): void
    {
        $jpeg = self::image(64, 64, 'jpeg');
        $cases = [
            'text named .jpg' => ['<?php echo "fixture-not-code"; ?>', 'photo.jpg'],
            'cut-off JPEG' => [substr($jpeg, 0, intdiv(strlen($jpeg), 2)), 'photo.jpg'],
            // A PNG header that announces 8000 x 7000 pixels (56 MP), refused before decoding.
            'over the pixel limit' => ["\x89PNG\r\n\x1A\n".pack('N', 13).'IHDR'.pack('NNCCCCC', 8000, 7000, 8, 2, 0, 0, 0).pack('N', 0).pack('N', 0).'IEND'.pack('N', 0), 'photo.png'],
        ];

        foreach ($cases as $label => [$bytes, $name]) {
            $this->upload($bytes, $name)->assertStatus(422)->assertJsonPath('errors.image', [self::MESSAGE]);
            $this->assertSame([], Storage::disk('public')->allFiles('avatars'), "{$label}: nothing stored");
        }
    }
}
