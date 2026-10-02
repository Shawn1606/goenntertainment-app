/**
 * The one place where server code writes to the console (F-38).
 *
 * Every other module logs through these functions; test/logging.test.js checks that no file under
 * src/ (except the operator-run CLIs seed.js and import/) calls console.* or writes to
 * process.stdout/stderr itself.
 *
 * What never reaches the log, whatever a caller hands in:
 *   - request bodies: no function here takes a request body, and an error from the body parser
 *     carries the raw text in `err.body` - only its name and type are printed;
 *   - SQL text, bound values and driver messages: mysql2 errors carry the statement in `sql` and
 *     the server's message (which quotes values, e.g. a duplicate entry) in `message` and
 *     `sqlMessage` - only the error code, errno and SQLSTATE are printed; any other error with a
 *     numeric errno (file system, network, zlib) is printed as its code and errno only;
 *   - snippets of parsed input: JSON.parse errors (SyntaxError) quote the text they failed on -
 *     only the name is printed;
 *   - the error object's own properties: it is never handed to console.* as an object, which
 *     would print all of them.
 * A request is described by its method and the route PATTERN (`/posts/:id`), never by its URL,
 * whose path and query carry user input (search terms, names).
 *
 * Other error messages are printed shortened to one line of at most MAX_MESSAGE characters, and
 * the stack trace only as its "at ..." frames (the first lines of `err.stack` repeat the message).
 */

/** Longest error message printed (characters). */
export const MAX_MESSAGE = 300;

/** Control characters (line breaks included) become spaces: one log entry stays one line. */
function oneLine(text) {
  let out = '';
  for (const char of String(text)) {
    const code = char.codePointAt(0);
    out += code < 0x20 || code === 0x7f ? ' ' : char;
  }
  return out;
}

function shorten(text) {
  const line = oneLine(text);
  return line.length > MAX_MESSAGE ? `${line.slice(0, MAX_MESSAGE)}...` : line;
}

/** A database error from mysql2: it carries the statement, or the server's SQLSTATE and message. */
const isDriverError = (err) => err.sqlState !== undefined || err.sqlMessage !== undefined || err.sql !== undefined;

/**
 * Any other error with a numeric errno: a system error (file system, network, zlib) or a driver
 * error without SQL fields. Its message can quote a path or an address, so it is described by code
 * and errno only - without the SQLSTATE label, which would point the reader at the database.
 */
const isSystemError = (err) => typeof err.errno === 'number';

const isBodyParserError = (err) => typeof err.type === 'string' && (err.body !== undefined || 'expose' in err);

/**
 * A short, safe description of an error (see the module comment for what is left out). A string
 * is taken as a message made by the code and printed on one line, unshortened.
 */
export function describeError(err) {
  if (err === null || err === undefined) return 'no error object';
  if (typeof err !== 'object' && typeof err !== 'function') return oneLine(err);

  const name = oneLine(typeof err.name === 'string' && err.name !== '' ? err.name : 'Error');
  if (isDriverError(err)) {
    return `${name} code=${oneLine(err.code ?? '?')} errno=${oneLine(err.errno ?? '?')} sqlState=${oneLine(err.sqlState ?? '?')}`;
  }
  if (isSystemError(err)) return `${name} code=${oneLine(err.code ?? '?')} errno=${oneLine(err.errno)}`;
  if (isBodyParserError(err)) {
    return `${name} type=${oneLine(err.type)} status=${oneLine(err.status ?? err.statusCode ?? '?')}`;
  }
  if (err instanceof SyntaxError) return name;
  const code = typeof err.code === 'string' || typeof err.code === 'number' ? ` code=${oneLine(err.code)}` : '';
  return `${name}${code}: ${shorten(err.message ?? '')}`;
}

/** The "at ..." lines of the stack, without the message lines in front of them. */
export function stackFrames(err) {
  const stack = typeof err?.stack === 'string' ? err.stack : '';
  return stack
    .split('\n')
    .filter((line) => /^\s+at /.test(line))
    .slice(0, 20)
    .map((line) => shorten(line.trimEnd()))
    .join('\n');
}

/** "POST /api/posts/:id/comments": method and route pattern, never the URL itself. */
export function describeRequest(req) {
  if (!req) return '';
  const method = oneLine(req.method ?? '?');
  const pattern = req.route?.path;
  if (typeof pattern !== 'string') return `${method} (no route)`;
  // routeMount: set by every router (router.js), because at the central error handler
  // req.baseUrl is the app's ('') again.
  const mount = typeof req.routeMount === 'string' ? req.routeMount : (req.baseUrl ?? '');
  return `${method} ${oneLine(mount)}${oneLine(pattern)}`;
}

/**
 * Logs an error: `[error] <context> <route>: <description>` plus the stack frames.
 * `err` may also be a string made by the code (never one built from input).
 */
export function logError(context, err, req = null) {
  const where = req ? ` ${describeRequest(req)}` : '';
  console.error(`[error] ${oneLine(context)}${where}: ${describeError(err)}`);
  const frames = typeof err === 'object' && err !== null ? stackFrames(err) : '';
  if (frames) console.error(frames);
}

/** Logs a warning without a stack: `[warn] <context>: <description>`. */
export function logWarn(context, detail = null) {
  const suffix = detail === null || detail === undefined ? '' : `: ${describeError(detail)}`;
  console.warn(`[warn] ${oneLine(context)}${suffix}`);
}

/** A status line made by the code (start-up, counts); never request data. */
export function logInfo(message) {
  console.log(oneLine(message));
}
