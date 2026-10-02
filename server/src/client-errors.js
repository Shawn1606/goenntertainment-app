/**
 * Errors that are the client's fault, before any route runs: an unreadable or oversized request
 * body (body-parser in app.js) or multipart form (multer, uploads.js), and a route parameter that
 * is not valid percent-encoding (Express decodes parameters while it matches a route). They are
 * answered with a 4xx and a German message the app can show, and they are not logged (F-38): until
 * this file they ended as a 500, and the log line printed the error object, which carries the raw
 * request text (passwords included) in `err.body` - or, for a parameter, in the error message.
 */
import multer from 'multer';

export const MSG_NOT_JSON = 'Die Anfrage ist kein gültiges JSON.';
export const MSG_TOO_LARGE = 'Die Anfrage ist zu groß.';
export const MSG_UNSUPPORTED = 'Dieses Format wird nicht unterstützt.';
export const MSG_UNREADABLE = 'Die Anfrage konnte nicht gelesen werden.';

/** body-parser (1.20) error types -> status and message. */
const BODY_ERRORS = {
  'entity.parse.failed': [400, MSG_NOT_JSON],
  'entity.too.large': [413, MSG_TOO_LARGE],
  'parameters.too.many': [413, MSG_TOO_LARGE],
  'charset.unsupported': [415, MSG_UNSUPPORTED],
  'encoding.unsupported': [415, MSG_UNSUPPORTED],
  'request.aborted': [400, MSG_UNREADABLE],
  'request.size.invalid': [400, MSG_UNREADABLE],
  'querystring.parse.rangeError': [400, MSG_UNREADABLE],
};

/** multer (2.x) error codes -> status and message; LIMIT_FILE_SIZE is the route's own (uploads.js). */
const MULTER_ERRORS = {
  LIMIT_FILE_SIZE: [413, MSG_TOO_LARGE],
  LIMIT_PART_COUNT: [413, MSG_TOO_LARGE],
  LIMIT_FILE_COUNT: [413, MSG_TOO_LARGE],
  LIMIT_FIELD_COUNT: [413, MSG_TOO_LARGE],
  LIMIT_FIELD_VALUE: [413, MSG_TOO_LARGE],
  LIMIT_FIELD_KEY: [413, MSG_TOO_LARGE],
  LIMIT_FIELD_NESTING: [400, MSG_UNREADABLE],
  LIMIT_FIELD_ARRAY_INDEX: [400, MSG_UNREADABLE],
  LIMIT_UNEXPECTED_FILE: [400, MSG_UNREADABLE],
  MISSING_FIELD_NAME: [400, MSG_UNREADABLE],
  INVALID_FIELD_NAME: [400, MSG_UNREADABLE],
  STREAM_DESTROYED: [400, MSG_UNREADABLE],
};

const answer = ([status, message]) => ({ status, message });

/**
 * `{ status, message }` when `err` is a client error from the body parser, multer or Express's
 * parameter decoding, else null (then it is a server error: logged, answered with 500).
 * The routes' own errors (HttpError) are answered before this is asked (app.js handleError).
 */
export function clientErrorFor(err) {
  if (!err || typeof err !== 'object') return null;
  if (err instanceof multer.MulterError) {
    return answer(Object.hasOwn(MULTER_ERRORS, err.code) ? MULTER_ERRORS[err.code] : [400, MSG_UNREADABLE]);
  }
  if (typeof err.type === 'string' && Object.hasOwn(BODY_ERRORS, err.type)) return answer(BODY_ERRORS[err.type]);
  const status = Number(err.status ?? err.statusCode);
  const is4xx = Number.isInteger(status) && status >= 400 && status < 500;
  // Any other error marked as the client's fault (http-errors: `expose`), with or without a
  // `type`: body-parser wraps a compressed body that zlib cannot unpack (gzip or deflate) in
  // createError(400, zlibError), which has no `type`.
  if (is4xx && err.expose === true) return answer([status, MSG_UNREADABLE]);
  // Express's router could not percent-decode a route parameter: a URIError with status 400 whose
  // message quotes the raw parameter text. A URIError without that status is the code's own.
  if (err instanceof URIError && status === 400) return answer([400, MSG_UNREADABLE]);
  return null;
}
