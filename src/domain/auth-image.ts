/**
 * Images that only the signed-in person may load (F-11): ban evidence and the image the AI
 * moderation refused (admins only). The API keeps them out of the public /storage and serves
 * them under /api/admin/evidence-files with the same bearer token as every other API call
 * (AppSupportMedia builds those addresses).
 *
 * The token goes ONLY to the API this app talks to: an address on another host (an imported
 * banner, a picture somewhere else) never gets it, and neither does a public /storage address,
 * which needs none. Pure logic here; the screens pass the result to expo-image as its source.
 */

/** What expo-image takes as `source`. */
export type AuthImageSource = { uri: string; headers?: Record<string, string> };

/** Default ports, so 'https://x:443' and 'https://x' are the same origin. */
const DEFAULT_PORT: Record<string, string> = { http: '80', https: '443' };

/** Scheme, host and port of an http(s) address in lower case, and its path; null otherwise. */
function splitAddress(address: string): { origin: string; path: string } | null {
  const match = /^(https?):\/\/([^/?#@]+)([^?#]*)/i.exec(address.trim());
  if (!match) return null;
  const scheme = match[1].toLowerCase();
  let host = match[2].toLowerCase();
  const port = /:(\d+)$/.exec(host)?.[1];
  if (port !== undefined && port === DEFAULT_PORT[scheme]) host = host.slice(0, -(port.length + 1));
  return { origin: `${scheme}://${host}`, path: match[3] || '/' };
}

/**
 * Whether `uri` is an address under `apiUrl` (the app's API base, e.g. https://host/api): same
 * scheme, host and port, and a path below the API's path. Dot segments are not allowed in such
 * an address at all, so '/api/../x' never counts as below '/api'.
 */
export function isApiAddress(uri: string, apiUrl: string): boolean {
  const target = splitAddress(uri);
  const api = splitAddress(apiUrl);
  if (!target || !api || target.origin !== api.origin) return false;
  const base = api.path.replace(/\/+$/, '');
  if (target.path.split('/').some((segment) => segment === '.' || segment === '..' || /%2e/i.test(segment))) {
    return false;
  }
  return target.path.startsWith(`${base}/`);
}

/**
 * The expo-image source for an image address: with `Authorization: Bearer <token>` when the
 * address is under the app's API and a token is there, otherwise the plain address.
 */
export function authImageSource(uri: string, token: string | null | undefined, apiUrl: string): AuthImageSource {
  if (typeof token === 'string' && token !== '' && isApiAddress(uri, apiUrl)) {
    return { uri, headers: { Authorization: `Bearer ${token}` } };
  }
  return { uri };
}
