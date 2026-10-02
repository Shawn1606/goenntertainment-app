/**
 * Uploaded images (F-11): only real JPEG, PNG and WebP files get in, and what is stored or sent to
 * the AI moderation is a fresh encoding of their pixels, never the uploaded bytes.
 *
 * Every upload route (event banner, avatar, profile banner, post image, story image, ban and
 * timeout evidence) runs its file through processImageUpload() before anything else looks at it:
 *   1. The first bytes must be the signature of a JPEG, PNG or WebP file. The type the client
 *      declares only decides which message it gets; the stored extension and the type sent to the
 *      model come from the bytes.
 *   2. sharp (libvips) decodes the whole image. Bytes that are not a decodable image of that very
 *      format (a cut-off file, a broken checksum, a container that says one format and holds
 *      another) are refused. Images over MAX_INPUT_PIXELS are refused before they are decoded.
 *   3. The pixels are encoded again in the same format, turned upright first (the EXIF
 *      orientation is applied, then dropped). The new file carries no metadata: no EXIF, no GPS
 *      position, no text chunks, nothing appended after the image. Pixel size stays as uploaded.
 *
 * Decoding and encoding run on libuv's thread pool, so a large photo does not block the event loop.
 */
import sharp from 'sharp';
import { HttpError } from './validate.js';

// A long-running server should not keep decoded images in sharp's cache.
sharp.cache(false);

/**
 * Largest accepted image in pixels (width x height): a resource guard against images that are
 * small as files but huge once decoded, not a quality limit. 50 MP is above every phone camera.
 */
export const MAX_INPUT_PIXELS = 50_000_000;

/** Declared types the upload routes accept (a first, cheap check; the bytes decide). */
export const ALLOWED_MIME = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

/** The formats that get in, with the stored extension and the type the model is told. */
export const IMAGE_FORMATS = {
  jpeg: { ext: 'jpg', mime: 'image/jpeg' },
  png: { ext: 'png', mime: 'image/png' },
  webp: { ext: 'webp', mime: 'image/webp' },
};

/** The bytes were not an acceptable image. The message is for logs and tests, never for users. */
export class ImageRejected extends Error {}

/** Marks the objects processImageUpload() returns; storage.js and moderation.js accept only those. */
const PROCESSED = Symbol('processed image');

/** Did this image come out of processImageUpload()? */
export function isProcessedImage(image) {
  return Boolean(image && image[PROCESSED] === true && Buffer.isBuffer(image.buffer));
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** The format a file's signature names: 'jpeg', 'png', 'webp' or null. */
export function sniffImageFormat(buf) {
  if (!Buffer.isBuffer(buf)) return null;
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIGNATURE)) return 'png';
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
    return 'webp';
  }
  return null;
}

/**
 * Decodes an uploaded file completely and encodes it again without metadata.
 *
 * @param {{buffer: Buffer}} file  multer's file object (memory storage)
 * @returns {Promise<{buffer: Buffer, mimetype: string, ext: string, width: number, height: number}>}
 * @throws {ImageRejected} when the bytes are not an acceptable JPEG, PNG or WebP image
 */
export async function processImageUpload(file) {
  const input = file?.buffer;
  const format = sniffImageFormat(input);
  if (!format) throw new ImageRejected('not a JPEG, PNG or WebP signature');

  let output;
  try {
    // failOn 'error': corrupt or cut-off pixel data is refused; a decoder's mere warning (common in
    // camera files) is not. animated: false reads the first frame only.
    const image = sharp(input, { failOn: 'error', limitInputPixels: MAX_INPUT_PIXELS, animated: false });
    const meta = await image.metadata();
    if (meta.format !== format) throw new ImageRejected('the signature and the decoded format differ');
    const upright = image.rotate();
    const encoder =
      format === 'jpeg' ? upright.jpeg({ quality: 85 }) : format === 'png' ? upright.png() : upright.webp({ quality: 85 });
    output = await encoder.toBuffer({ resolveWithObject: true });
  } catch (err) {
    if (err instanceof ImageRejected) throw err;
    // libvips' own message can name internals; the caller only needs to know that it failed.
    throw new ImageRejected('the image could not be decoded');
  }

  return Object.freeze({
    [PROCESSED]: true,
    buffer: output.data,
    mimetype: IMAGE_FORMATS[format].mime,
    ext: IMAGE_FORMATS[format].ext,
    width: output.info.width,
    height: output.info.height,
  });
}

/**
 * processImageUpload() for a route: a refused file becomes a 422 with the route's own message at
 * its form field (the message the route already used for a wrong file type).
 */
export async function processImageOr422(file, field, message) {
  try {
    return await processImageUpload(file);
  } catch (err) {
    if (err instanceof ImageRejected) throw new HttpError(422, message, { [field]: [message] });
    throw err;
  }
}
