import { HttpError } from './validate.js';

/**
 * What GET /api/activities lists, and how it pages (F-12).
 *
 * ## Which events
 *
 * By default the list holds the upcoming events:
 *   - every permanent offer (`is_permanent = 1`): it has no date; its `starts_at` only carries the
 *     time it was created (server/schema.sql), so it never becomes past;
 *   - every dated event whose start is less than PAST_AFTER_HOURS hours ago.
 * The database stores no end and no duration. The app assumes three hours: an event shows
 * "Läuft jetzt" until three hours after its start and "Vorbei" from then on, and the feed and the
 * search hide it from then on (src/domain/urgency.ts LIVE_MS). The server applies the same rule: a
 * dated event counts as past from exactly three hours after its start. Both sides compare in UTC
 * (`starts_at` is stored in UTC; UTC_TIMESTAMP() does not depend on the session's time zone).
 *
 * `past=1` lists the events that are over instead, and only the viewer's own ones: those they
 * host or have joined. That is the history the app shows (the profile's "Erstellt" and "Dabei"
 * tabs, and "Warst schon bei … dabei" in the feed's suggestions); nobody gets other people's past
 * events, with their participants, any more. `mine=1` narrows the upcoming list the same way.
 * Both flags take `1` (or `0`); any other value is refused.
 *
 * ## Pages
 *
 * One answer holds at most `limit` events: PAGE_SIZE_DEFAULT without `limit`, and never more than
 * PAGE_SIZE_MAX, whatever is asked for (the same lenient reading as the chat's pages: a value that
 * is not a number means the default). The answer is `{ data, next_cursor }`; `next_cursor` is null
 * on the last page, and passed back as `cursor` it gives the next one. Clients that know nothing
 * of `next_cursor` get the first page.
 *
 * The cursor is the position of the last event served (its start and its id), not an offset. The
 * order is start, then id: upcoming events earliest first, past ones latest first. The next page
 * starts strictly after that position, so an event that is added, deleted or leaves the time
 * window between two requests never makes the next page skip or repeat another one. A cursor that
 * is not one this route made is refused (422), so a broken client cannot loop back to the start.
 */

/** Hours after its start from which a dated event counts as past (src/domain/urgency.ts LIVE_MS). */
export const PAST_AFTER_HOURS = 3;

/** Events per page without `limit`. */
export const PAGE_SIZE_DEFAULT = 50;

/** Events per page at most, whatever `limit` asks for. */
export const PAGE_SIZE_MAX = 100;

const MSG_BAD_QUERY = 'Ungueltige Angabe fuer die Event-Liste.';

/** A cursor this route makes is about 40 characters; anything longer is not one. */
const CURSOR_MAX_LENGTH = 64;

/**
 * The decoded cursor: `starts_at` as the database returns it, a bar, the event's id (at most 15
 * digits, so it stays an exact JavaScript number).
 */
const CURSOR_FORMAT = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\|([1-9]\d{0,14})$/;

const refuse = (field) => new HttpError(422, MSG_BAD_QUERY, { [field]: [MSG_BAD_QUERY] });

/** Page size from the `limit` query value, held between 1 and PAGE_SIZE_MAX. */
export function pageSize(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return PAGE_SIZE_DEFAULT;
  const n = Number(raw);
  if (!Number.isFinite(n)) return PAGE_SIZE_DEFAULT;
  return Math.min(PAGE_SIZE_MAX, Math.max(1, Math.floor(n)));
}

function flag(raw, field) {
  if (raw === undefined || raw === '0') return false;
  if (raw === '1') return true;
  throw refuse(field);
}

/** The cursor of the next page: the position of `row`, the last event of this page. */
export function encodeCursor(row) {
  return Buffer.from(`${row.starts_at}|${row.id}`, 'utf8').toString('base64url');
}

/** The position a cursor names, or null for the first page; anything else is refused (422). */
export function decodeCursor(raw) {
  if (raw === undefined || raw === '') return null;
  if (typeof raw !== 'string' || raw.length > CURSOR_MAX_LENGTH || !/^[A-Za-z0-9_-]+$/.test(raw)) {
    throw refuse('cursor');
  }
  const match = CURSOR_FORMAT.exec(Buffer.from(raw, 'base64url').toString('utf8'));
  // A date that does not exist (month 13, 25 o'clock) would reach MySQL as an invalid value.
  const at = match ? new Date(`${match[1].replace(' ', 'T')}Z`) : null;
  if (!at || Number.isNaN(at.getTime()) || at.toISOString().slice(0, 19).replace('T', ' ') !== match[1]) {
    throw refuse('cursor');
  }
  return { startsAt: match[1], id: Number(match[2]) };
}

/** Reads the query of GET /api/activities: `{ limit, past, mine, cursor }`, or a 422. */
export function parseListQuery(query) {
  return {
    limit: pageSize(query.limit),
    past: flag(query.past, 'past'),
    mine: flag(query.mine, 'mine'),
    cursor: decodeCursor(query.cursor),
  };
}

/**
 * The SQL of one page for `viewerId`: activities aliased `a`, the conditions in `where` (fixed
 * fragments; every value is a bound parameter), the order and one row more than the page, which
 * tells whether a next page exists. `extraWhere` is a further code-made condition (or '').
 */
export function pageQuery({ limit, past, mine, cursor }, viewerId, extraWhere = '') {
  const where = [];
  const params = [];
  if (extraWhere) where.push(extraWhere);
  if (past) {
    where.push('a.is_permanent = 0 AND a.starts_at <= UTC_TIMESTAMP() - INTERVAL ? HOUR');
  } else {
    where.push('(a.is_permanent = 1 OR a.starts_at > UTC_TIMESTAMP() - INTERVAL ? HOUR)');
  }
  params.push(PAST_AFTER_HOURS);
  if (past || mine) {
    where.push(
      '(a.user_id = ? OR EXISTS (SELECT 1 FROM activity_user au WHERE au.activity_id = a.id AND au.user_id = ?))',
    );
    params.push(viewerId, viewerId);
  }
  const direction = past ? 'DESC' : 'ASC';
  const beyond = past ? '<' : '>';
  if (cursor) {
    where.push(`(a.starts_at ${beyond} ? OR (a.starts_at = ? AND a.id ${beyond} ?))`);
    params.push(cursor.startsAt, cursor.startsAt, cursor.id);
  }
  return {
    sql: `SELECT a.* FROM activities a
           WHERE ${where.join('\n             AND ')}
           ORDER BY a.starts_at ${direction}, a.id ${direction}
           LIMIT ?`,
    params: [...params, limit + 1],
  };
}

/** Splits the rows of pageQuery() into the page and the cursor of the next one (null: last page). */
export function splitPage(rows, limit) {
  const page = rows.slice(0, limit);
  return { page, nextCursor: rows.length > limit ? encodeCursor(page[page.length - 1]) : null };
}
