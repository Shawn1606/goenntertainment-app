/**
 * Social-Links: was der Server davon annimmt.
 *
 * Die App macht aus „@name" eine vollstaendige Adresse (src/domain/social-links.ts).
 * Hier steht bewusst NUR die Pruefung dessen, was ankommt – kein zweiter Satz
 * Handle-Praefixe, der irgendwann von dem der App abweicht. Gespeichert werden
 * ausschliesslich fertige http(s)-Adressen.
 *
 * Der Grund fuer die Schema-Pruefung: Diese Adressen werden in der App
 * angetippt und dann vom Geraet geoeffnet. „javascript:" oder „data:" duerfen
 * dort nie landen, auch nicht ueber die Schnittstelle vorbei an der App.
 */

/** Gleiche Schluessel wie SOCIAL_PLATFORMS in src/domain/social-links.ts. */
export const SOCIAL_PLATFORMS = [
  'instagram',
  'tiktok',
  'youtube',
  'x',
  'facebook',
  'twitch',
  'linkedin',
  'website',
];

/** Pro Plattform genau ein Link. */
export const MAX_SOCIAL_LINKS = SOCIAL_PLATFORMS.length;

/** So lang darf eine Adresse sein (die Spalte fasst mehr – das ist die Regel). */
export const MAX_LINK_LENGTH = 200;

const URL_RE = /^https?:\/\/[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+(:\d+)?([/?#][^\s]*)?$/i;

/**
 * The words of a link for the word filter (F-06): a link is shown on the profile like any text,
 * so a term in it is refused like one in a post. Without the scheme, percent-decoded (up to three
 * times, so an encoded term is read as such), and with the address' separators as spaces: the
 * filter then reads host, path and query as words ("www instagram com name") instead of one long
 * run of letters, in which a term could otherwise be found across two harmless parts.
 */
export function linkFilterText(url) {
  let text = String(url ?? '').replace(/^https?:\/\//i, '');
  for (let i = 0; i < 3; i += 1) {
    let decoded;
    try {
      decoded = decodeURIComponent(text);
    } catch {
      break;
    }
    if (decoded === text) break;
    text = decoded;
  }
  return text.replace(/[/?#&=._~+:@%,;!*'()[\]$-]+/g, ' ').trim();
}

/**
 * Prueft die komplette Liste (PUT-Semantik: was hier steht, ersetzt alles).
 *
 * @param {unknown} raw
 * @returns {{links: {platform: string, url: string}[], error: string|null}}
 */
export function parseLinkList(raw) {
  if (!Array.isArray(raw)) {
    return { links: [], error: 'Links muessen als Liste uebergeben werden.' };
  }
  if (raw.length > MAX_SOCIAL_LINKS) {
    return { links: [], error: `Hoechstens ${MAX_SOCIAL_LINKS} Links.` };
  }

  const links = [];
  const seen = new Set();

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') {
      return { links: [], error: 'Jeder Link braucht Plattform und Adresse.' };
    }

    const platform = String(entry.platform ?? '');
    // An address is text; any other JSON type is not an address (F-06).
    if (entry.url !== undefined && entry.url !== null && typeof entry.url !== 'string') {
      return { links: [], error: 'Jeder Link braucht Plattform und Adresse.' };
    }
    const url = String(entry.url ?? '').trim();

    // Leere Adresse = geloescht. Das ist kein Fehler, sondern der normale Weg,
    // wie ein Formular eine geleerte Zeile schickt.
    if (url === '') {
      continue;
    }
    if (!SOCIAL_PLATFORMS.includes(platform)) {
      return { links: [], error: `Unbekannte Plattform: ${platform.slice(0, 30)}.` };
    }
    if (seen.has(platform)) {
      return { links: [], error: 'Pro Plattform ist nur ein Link moeglich.' };
    }
    if (url.length > MAX_LINK_LENGTH) {
      return { links: [], error: `Die Adresse ist zu lang (hoechstens ${MAX_LINK_LENGTH} Zeichen).` };
    }
    if (!URL_RE.test(url)) {
      return { links: [], error: 'Bitte eine vollstaendige Adresse mit http:// oder https://.' };
    }

    seen.add(platform);
    links.push({ platform, url });
  }

  return { links, error: null };
}
