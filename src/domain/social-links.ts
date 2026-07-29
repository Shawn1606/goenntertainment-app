/**
 * Social-Links eines Profils – reine Datenlogik, kein React.
 *
 * Zwei Aufgaben: aus einer bequemen Eingabe („goenn4fun", „@goenn4fun",
 * „instagram.com/goenn4fun") eine vollständige Adresse machen, und aus einer
 * Adresse wieder etwas Lesbares für die Anzeige.
 *
 * Warum das eine eigene Schicht ist und nicht im Screen steht: Diese Links
 * werden angetippt. Was hier durchrutscht, öffnet das Gerät – deshalb ist die
 * Prüfung auf `http`/`https` hier festgenagelt und mit Tests belegt, statt in
 * einem Formular verstreut zu stehen.
 *
 * BEWUSST ohne `new URL`: Hermes bringt die Klasse nicht überall mit, und die
 * Domänen-Schicht soll ohne Polyfill in Node-Tests wie in der App laufen.
 */

export type SocialPlatform =
  | 'instagram'
  | 'tiktok'
  | 'youtube'
  | 'x'
  | 'facebook'
  | 'twitch'
  | 'linkedin'
  | 'website';

/**
 * Beschreibung einer Plattform. Absichtlich OHNE Symbol: Welches Zeichen eine
 * Plattform bekommt, ist eine Frage der Anzeige und steht in
 * `src/components/ui/social-icon.tsx` – abgeleitet aus `key`. Ein zweites Feld
 * dafür hier wäre dieselbe Information an zwei Stellen.
 */
export type SocialPlatformInfo = {
  key: SocialPlatform;
  label: string;
  /**
   * Davor hängt das Handle. `null` bei der eigenen Seite: dort gibt es kein
   * Handle, sondern nur eine echte Adresse.
   */
  baseUrl: string | null;
  placeholder: string;
};

/** Reihenfolge = Anzeige-Reihenfolge im Profil. */
export const SOCIAL_PLATFORMS: readonly SocialPlatformInfo[] = [
  {
    key: 'instagram',
    label: 'Instagram',
    baseUrl: 'https://instagram.com/',
    placeholder: '@deinname',
  },
  {
    key: 'tiktok',
    label: 'TikTok',
    baseUrl: 'https://tiktok.com/@',
    placeholder: '@deinname',
  },
  {
    key: 'youtube',
    label: 'YouTube',
    baseUrl: 'https://youtube.com/@',
    placeholder: '@deinkanal',
  },
  { key: 'x', label: 'X', baseUrl: 'https://x.com/', placeholder: '@deinname' },
  {
    key: 'facebook',
    label: 'Facebook',
    baseUrl: 'https://facebook.com/',
    placeholder: 'deine.seite',
  },
  {
    key: 'twitch',
    label: 'Twitch',
    baseUrl: 'https://twitch.tv/',
    placeholder: 'deinkanal',
  },
  {
    key: 'linkedin',
    label: 'LinkedIn',
    baseUrl: 'https://linkedin.com/in/',
    placeholder: 'dein-profil',
  },
  {
    key: 'website',
    label: 'Eigene Seite',
    baseUrl: null,
    placeholder: 'deineseite.de',
  },
] as const;

/**
 * Pro Plattform genau ein Link – deshalb ist die Obergrenze die Länge der
 * Liste. Zwei Instagram-Links wären in der Anzeige nicht unterscheidbar.
 */
export const MAX_SOCIAL_LINKS = SOCIAL_PLATFORMS.length;

/** So lang darf eine gespeicherte Adresse werden (die Spalte fasst mehr). */
export const MAX_LINK_LENGTH = 200;

/** Ein Link, wie ihn Profil und API führen. */
export type SocialLink = { platform: string; url: string };

export type NormalizeResult = { ok: true; url: string } | { ok: false; error: string };

/** Erlaubte Zeichen in einem Handle – absichtlich eng. */
const HANDLE_RE = /^[A-Za-z0-9._-]{1,50}$/;
/** Eine Domain: mindestens ein Punkt, keine Leerzeichen. */
const HOST_RE = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
/** Vollständige Adresse mit erlaubtem Schema. */
const URL_RE = /^https?:\/\/[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+(:\d+)?([/?#][^\s]*)?$/i;
/** Irgendein Schema am Anfang („javascript:", „ftp:", „https:"). */
const SCHEME_RE = /^[A-Za-z][A-Za-z0-9+.-]*:/;

/** Beschreibung einer Plattform; null, wenn wir sie nicht kennen. */
export function platformInfo(platform: string): SocialPlatformInfo | null {
  return SOCIAL_PLATFORMS.find((p) => p.key === platform) ?? null;
}

/**
 * Macht aus einer Eingabe eine vollständige, anklickbare Adresse.
 *
 * Erlaubt sind: ein Handle („name", „@name"), eine nackte Domain (nur bei der
 * eigenen Seite) und eine vollständige http(s)-Adresse. Alles andere – vor
 * allem fremde Schemata – wird abgelehnt.
 */
export function normalizeSocialInput(platform: string, raw: string): NormalizeResult {
  const info = platformInfo(platform);
  if (!info) {
    return { ok: false, error: 'Diese Plattform kennen wir nicht.' };
  }

  const value = (raw ?? '').trim();
  if (value === '') {
    return { ok: false, error: 'Bitte etwas eintragen.' };
  }
  if (value.length > MAX_LINK_LENGTH) {
    return { ok: false, error: `Das ist zu lang (höchstens ${MAX_LINK_LENGTH} Zeichen).` };
  }

  // Steht schon ein Schema davor, muss es http oder https sein. Diese Prüfung
  // kommt VOR allem anderen: „javascript:…" darf nie als Handle durchgehen.
  if (SCHEME_RE.test(value)) {
    if (!URL_RE.test(value)) {
      return { ok: false, error: 'Bitte eine vollständige Adresse mit http:// oder https://.' };
    }
    return { ok: true, url: value };
  }

  // Ohne Schema: eine Domain wird zur https-Adresse ergänzt.
  const [host] = value.split('/');
  if (HOST_RE.test(host)) {
    const url = `https://${value}`;
    return URL_RE.test(url)
      ? { ok: true, url }
      : { ok: false, error: 'Diese Adresse können wir nicht lesen.' };
  }

  // Bleibt das Handle. Die eigene Seite kennt keins.
  if (!info.baseUrl) {
    return { ok: false, error: 'Bitte eine Adresse angeben, zum Beispiel deineseite.de.' };
  }
  const handle = value.startsWith('@') ? value.slice(1) : value;
  if (!HANDLE_RE.test(handle)) {
    return { ok: false, error: 'Das sieht nicht nach einem Namen aus (nur Buchstaben, Zahlen, . _ -).' };
  }
  return { ok: true, url: `${info.baseUrl}${handle}` };
}

/**
 * Kurzform für die Anzeige: bei Handle-Plattformen „@name", bei der eigenen
 * Seite die Domain ohne Schema. Unlesbares bleibt unverändert stehen – lieber
 * eine hässliche Zeile als eine leere.
 */
export function displaySocialLink(platform: string, url: string): string {
  const value = (url ?? '').trim();
  const withoutScheme = value.replace(/^https?:\/\//i, '');
  const info = platformInfo(platform);

  if (!info || !info.baseUrl) {
    return withoutScheme.replace(/^www\./i, '').replace(/\/$/, '');
  }

  const path = withoutScheme.split('?')[0].replace(/\/$/, '');
  const last = path.split('/').filter(Boolean).pop();
  if (!last || last === path) {
    // Kein Pfad – also auch kein Handle, das wir zeigen könnten.
    return withoutScheme.replace(/\/$/, '');
  }
  return last.startsWith('@') ? last : `@${last}`;
}

/**
 * Bringt Links in die Reihenfolge der Plattform-Liste. Unbekannte Plattformen
 * (etwa aus einer älteren Version) rutschen ans Ende, statt zu verschwinden.
 */
export function sortLinks<T extends SocialLink>(links: readonly T[]): T[] {
  const rank = (platform: string) => {
    const index = SOCIAL_PLATFORMS.findIndex((p) => p.key === platform);
    return index === -1 ? SOCIAL_PLATFORMS.length : index;
  };
  return [...links].sort((a, b) => rank(a.platform) - rank(b.platform));
}
