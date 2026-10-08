/**
 * The event list, page by page (F-12) – pure logic, no React, no network.
 *
 * GET /api/activities answers one page at a time and names the next one in `next_cursor`
 * (server/src/activity-pages.js). By default it lists the upcoming events: a dated event drops out
 * three hours after its start (the same rule as `LIVE_MS` in urgency.ts), a permanent offer never.
 * `mine` narrows that to the events you host or joined; `past` lists your own events that are over
 * instead – nobody gets other people's past events.
 *
 * The screens filter, rank and geocode the list on the device, so they need all of it:
 * `collectPages` follows `next_cursor` until the last page, and a screen never works on a first
 * page that silently stands in for the whole list. A server without pages (no `next_cursor`)
 * ends the walk after its one answer.
 */

/**
 * Events per request. The server's largest page (PAGE_SIZE_MAX in server/src/activity-pages.js);
 * a smaller maximum there only means more requests, never fewer events.
 */
export const ACTIVITY_PAGE_SIZE = 100;

/**
 * More pages than any real list has (100,000 events). Reaching it means the server keeps naming
 * new pages: the walk stops with an error instead of running on.
 */
export const MAX_ACTIVITY_PAGES = 1000;

export type ActivityListQuery = {
  /** Only the events you host or joined. */
  mine?: boolean;
  /** Your own events that are over (hosted or joined), latest first – instead of the upcoming ones. */
  past?: boolean;
};

/** One answer of GET /api/activities. Older servers send no `next_cursor`. */
export type ActivityPage<T> = { data: T[]; next_cursor?: string | null };

/** Path and query of one page: `/activities?limit=…[&past=1][&mine=1][&cursor=…]`. */
export function activityListPath(query: ActivityListQuery, cursor: string | null): string {
  const params = [`limit=${ACTIVITY_PAGE_SIZE}`];
  if (query.past) params.push('past=1');
  if (query.mine) params.push('mine=1');
  if (cursor) params.push(`cursor=${encodeURIComponent(cursor)}`);
  return `/activities?${params.join('&')}`;
}

/**
 * Every page, in order: asks for the first page, then for each `next_cursor` until an answer
 * names none. A cursor that comes back a second time would repeat pages forever: that is an
 * error, like more than MAX_ACTIVITY_PAGES pages, and never a shortened list.
 */
export async function collectPages<T>(fetchPage: (cursor: string | null) => Promise<ActivityPage<T>>): Promise<T[]> {
  const items: T[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  for (let pages = 0; pages < MAX_ACTIVITY_PAGES; pages += 1) {
    const page: ActivityPage<T> = await fetchPage(cursor);
    items.push(...page.data);
    const next = page.next_cursor ?? null;
    if (!next) return items;
    if (seen.has(next)) throw new Error('The event list named the same page twice.');
    seen.add(next);
    cursor = next;
  }
  throw new Error(`The event list has more than ${MAX_ACTIVITY_PAGES} pages.`);
}

/**
 * Several lists as one, each event once (the first copy wins). An event can be in two lists that
 * were loaded a moment apart, e.g. upcoming and past when its three hours ran out in between.
 */
export function mergeById<T extends { id: number }>(...lists: readonly (readonly T[])[]): T[] {
  const seen = new Set<number>();
  const merged: T[] = [];
  for (const list of lists) {
    for (const item of list) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      merged.push(item);
    }
  }
  return merged;
}
