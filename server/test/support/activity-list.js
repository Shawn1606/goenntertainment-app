/**
 * Every page of GET /api/activities for one viewer (F-12).
 *
 * The route answers one page and names the next one in `next_cursor` (src/activity-pages.js).
 * A test that looks for its own event in the list walks every page, so the answer does not depend
 * on how many other events the shared test database holds. The walk fails on a cursor it has seen
 * before and after MAX_PAGES pages, so a route that loops fails the test instead of hanging it. An
 * answer without `next_cursor` (a server that lists everything at once) ends the walk.
 */

/** More pages than any test database holds. */
export const MAX_PAGES = 10000;

/**
 * The answers to GET /api/activities?<query>, page by page: an array of `{ data, next_cursor }`.
 * `query` is a query string or an object of parameters (without `cursor`).
 */
export async function activityPages(base, token, query = '') {
  const pages = [];
  const seen = new Set();
  let cursor = null;
  while (pages.length < MAX_PAGES) {
    const params = new URLSearchParams(query);
    if (cursor !== null) params.set('cursor', cursor);
    const search = params.toString();
    const res = await fetch(`${base}/api/activities${search ? `?${search}` : ''}`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    if (res.status !== 200) throw new Error(`GET /api/activities answered ${res.status}: ${body?.message}`);
    pages.push(body);
    cursor = body.next_cursor ?? null;
    if (cursor === null) return pages;
    if (seen.has(cursor)) throw new Error('GET /api/activities named the same page twice');
    seen.add(cursor);
  }
  throw new Error(`GET /api/activities had more than ${MAX_PAGES} pages`);
}

/** Every event GET /api/activities?<query> lists, all pages in order. */
export async function listedActivities(base, token, query = '') {
  return (await activityPages(base, token, query)).flatMap((page) => page.data);
}
