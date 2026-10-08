<?php

namespace App\Support;

use RuntimeException;

/**
 * The bytes were not an acceptable image (App\Support\ImageCheck). The message is for logs and
 * tests, never for users: the upload route answers with its own message at its form field.
 */
final class ImageRejected extends RuntimeException {}
