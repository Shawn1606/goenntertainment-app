/**
 * Multipart uploads: the one place that builds a multer instance (F-02).
 *
 * Every upload route takes exactly one image in one named field plus a few text fields. multer
 * (2.3 or later) and busboy enforce bounds on all of it before the route runs:
 *   - the file: at most MAX_UPLOAD_BYTES, one file, only in the route's field;
 *   - text fields: as many as the route reads (`maxFields`), each at most FIELD_VALUE_BYTES;
 *   - field names: at most FIELD_NAME_BYTES, at most one bracket level (`interests[]` is the
 *     deepest name the app sends, src/lib/api.ts), and no numeric array index above `maxFields`.
 *     Without that, one name such as `interests[4000000000]` made a sparse array of that length,
 *     and every loop over it ran for minutes (and older multer versions could be crashed);
 *   - header pairs per part.
 * A form that breaks a bound, or that busboy cannot read, is answered with 400 or 413 (an
 * oversized image keeps the route's own 422 message) and is never passed on as a 500.
 *
 * Laravel (api/) rebuilds every forwarded form from PHP's parsed fields
 * (NodeFallbackController::multipartParts): a list becomes `name[]`, other keys `name[key]`. So
 * these bounds also hold for whatever Laravel forwards.
 */
import multer from 'multer';
import { HttpError } from './validate.js';
import { clientErrorFor, MSG_UNREADABLE } from './client-errors.js';

/**
 * Largest image (5 MB). Named mirror: api/app/Http/Controllers/NodeFallbackController.php
 * (`$nodeLimit`), which tells the app this limit when PHP refuses a file first; checked by
 * scripts/ci/check-mirrors.mjs.
 */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** Largest text field in bytes: the longest text a route accepts is 2000 characters. */
export const FIELD_VALUE_BYTES = 16 * 1024;
/** Longest field name in bytes (`custom_interests[]` has 18). */
export const FIELD_NAME_BYTES = 64;
/** Bracket levels in a field name: `name[]` is one. */
export const FIELD_NESTING_DEPTH = 1;
/** Header lines per part (a browser or the app sends two: Content-Disposition, Content-Type). */
export const HEADER_PAIRS = 20;

export const MSG_IMAGE_TOO_BIG = 'Das Bild darf hoechstens 5 MB gross sein.';

/**
 * Middleware that reads a multipart form with one optional file in `fileField` and at most
 * `maxFields` text fields. `sizeMessage` is the 422 answer for an image over MAX_UPLOAD_BYTES (at
 * the file's field). Requests that are not multipart pass through untouched (multer's behaviour).
 */
export function singleUpload(fileField, { maxFields, sizeMessage = MSG_IMAGE_TOO_BIG }) {
  if (!Number.isInteger(maxFields) || maxFields < 1) throw new TypeError('singleUpload: maxFields must be a positive integer');
  const run = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: MAX_UPLOAD_BYTES,
      files: 1,
      fields: maxFields,
      parts: maxFields + 1,
      fieldSize: FIELD_VALUE_BYTES,
      fieldNameSize: FIELD_NAME_BYTES,
      headerPairs: HEADER_PAIRS,
      fieldNestingDepth: FIELD_NESTING_DEPTH,
      // An index can never be higher than the number of fields in a dense list.
      fieldArrayIndexLimit: maxFields,
    },
  }).single(fileField);

  const middleware = (req, res, next) =>
    run(req, res, (err) => next(err ? uploadError(err, fileField, sizeMessage) : undefined));
  middleware.uploadField = fileField;
  middleware.maxFields = maxFields;
  return middleware;
}

/** multer's and busboy's errors as HttpErrors: the client's fault, whatever went wrong in the form. */
function uploadError(err, field, sizeMessage) {
  if (err?.code === 'LIMIT_FILE_SIZE') return new HttpError(422, sizeMessage, { [field]: [sizeMessage] });
  const client = clientErrorFor(err);
  if (client) return new HttpError(client.status, client.message);
  // busboy's own parse errors (no boundary, a truncated form, a malformed part header) and an
  // aborted upload are plain Errors.
  return new HttpError(400, MSG_UNREADABLE);
}
