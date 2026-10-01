/**
 * Errors that are the client's fault, before any route runs: an unreadable or oversized request
 * body (body-parser in app.js) or multipart form (multer, uploads.js). They are answered with a
 * 4xx and a German message the app can show, and they are not logged (F-38): until this file they
 * ended as a 500, and the log line printed the error object, which carries the raw request text
 * (passwords included) in `err.body`.
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
 * `{ status, message }` when `err` is a client error from the body parser or multer, else null
 * (then it is a server error: logged, answered with 500).
 */
export function clientErrorFor(err) {
  if (!err || typeof err !== 'object') return null;
  if (err instanceof multer.MulterError) {
    return answer(Object.hasOwn(MULTER_ERRORS, err.code) ? MULTER_ERRORS[err.code] : [400, MSG_UNREADABLE]);
  }
  if (typeof err.type === 'string' && Object.hasOwn(BODY_ERRORS, err.type)) return answer(BODY_ERRORS[err.type]);
  // Any other body-parser error that is marked as the client's fault (http-errors: `expose`).
  const status = Number(err.status ?? err.statusCode);
  if (typeof err.type === 'string' && err.expose === true && status >= 400 && status < 500) {
    return answer([status, MSG_UNREADABLE]);
  }
  return null;
}
