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
 *   4. The AI moderation sends the model that image, or a smaller copy of it when the image is over
 *      the provider's limits (imageForModel); the stored file is never the copy.
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
 * The longest side of the image the AI moderation's model gets (F-06): the largest image the
 * default model reads at full detail (2576 px on the long edge). The provider scales a larger image
 * down itself and refuses one over 8000 px on a side, so a larger copy only adds bytes.
 */
export const MODEL_IMAGE_MAX_EDGE = 2576;

/** The provider's size limit for one image, counted on its base64 text: 5 MB. */
export const MODEL_IMAGE_MAX_BASE64 = 5 * 1024 * 1024;

/** Ever smaller encodings of the model's copy, tried in order until one fits. */
const MODEL_COPY_STEPS = Object.freeze([
  Object.freeze({ edge: MODEL_IMAGE_MAX_EDGE, quality: 85 }),
  Object.freeze({ edge: MODEL_IMAGE_MAX_EDGE, quality: 70 }),
  Object.freeze({ edge: MODEL_IMAGE_MAX_EDGE, quality: 55 }),
  Object.freeze({ edge: 1568, quality: 70 }),
  Object.freeze({ edge: 1024, quality: 60 }),
]);

const base64Length = (bytes) => Math.ceil(bytes / 3) * 4;

/**
 * The image the AI moderation sends to the model, within the provider's documented limits (F-06).
 * A processed image that is at most MODEL_IMAGE_MAX_EDGE px on each side and at most
 * MODEL_IMAGE_MAX_BASE64 as base64 goes as it is. Otherwise the model gets a copy, scaled down to
 * fit and encoded again: a JPEG as JPEG, a PNG or WebP as WebP, which keeps transparency (a PNG's
 * lossless encoding can be many times larger than the upload it came from). The stored image is
 * not touched and keeps its pixel size; only the copy is smaller.
 *
 * @param {object} image  an image from processImageUpload()
 * @returns {Promise<{buffer: Buffer, mimetype: string, width: number, height: number}>}
 * @throws {ImageRejected} when not even the smallest step fits
 */
export async function imageForModel(image) {
  if (!isProcessedImage(image)) throw new TypeError('imageForModel: the image must come from processImageUpload()');
  const { buffer, mimetype, width, height } = image;
  if (width <= MODEL_IMAGE_MAX_EDGE && height <= MODEL_IMAGE_MAX_EDGE && base64Length(buffer.length) <= MODEL_IMAGE_MAX_BASE64) {
    return { buffer, mimetype, width, height };
  }
  const format = mimetype === IMAGE_FORMATS.jpeg.mime ? 'jpeg' : 'webp';
  for (const { edge, quality } of MODEL_COPY_STEPS) {
    const resized = sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS }).resize({
      width: edge,
      height: edge,
      fit: 'inside',
      withoutEnlargement: true,
    });
    const encoder = format === 'jpeg' ? resized.jpeg({ quality }) : resized.webp({ quality });
    const { data, info } = await encoder.toBuffer({ resolveWithObject: true });
    if (base64Length(data.length) <= MODEL_IMAGE_MAX_BASE64) {
      return { buffer: data, mimetype: IMAGE_FORMATS[format].mime, width: info.width, height: info.height };
    }
  }
  throw new ImageRejected('no copy of the image fits the model limits');
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
