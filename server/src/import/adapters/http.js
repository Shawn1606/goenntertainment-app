/**
 * Der einzige Ort, an dem der Import nach draussen telefoniert.
 *
 * Warum eigener Helfer und nicht direkt `fetch`: Ein Importer, der im
 * Minutentakt ohne Kennung auf die Seite eines Vereins losgeht, wird zu Recht
 * gesperrt. Hier stehen die drei Dinge, die das verhindern – eine ehrliche
 * Kennung mit Kontaktadresse, ein Timeout und eine Pause zwischen Aufrufen.
 */

const USER_AGENT =
  'GoenntertainmentImporter/1.0 (+https://goenntertainment.de; Event-Import mit Verweis auf die Quelle)';

const REQUEST_TIMEOUT_MS = 20_000;

/** Pause zwischen zwei Aufrufen derselben Quelle. Reicht, um nicht aufzufallen. */
const POLITE_DELAY_MS = 800;

let lastRequestAt = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function throttle() {
  const waited = Date.now() - lastRequestAt;
  if (waited < POLITE_DELAY_MS) {
    await sleep(POLITE_DELAY_MS - waited);
  }
  lastRequestAt = Date.now();
}

/**
 * Holt eine URL als Text. Wirft mit sprechender Meldung, damit im CLI steht,
 * WELCHE Quelle klemmt – bei zehn Locations ist "fetch failed" nutzlos.
 */
export async function fetchText(url) {
  await throttle();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: { 'user-agent': USER_AGENT, accept: '*/*' },
      signal: controller.signal,
      redirect: 'follow',
    });

    if (!response.ok) {
      throw new Error(`${url} antwortete mit HTTP ${response.status}`);
    }
    return await response.text();
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`${url} antwortete nicht innerhalb von ${REQUEST_TIMEOUT_MS / 1000}s`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** Wie fetchText, aber mit JSON-Parsen und einer Meldung, die den Anfang der Antwort zeigt. */
export async function fetchJson(url) {
  const text = await fetchText(url);
  try {
    return JSON.parse(text);
  } catch {
    // Der haeufigste Fall: Die Seite liefert eine HTML-Fehlerseite mit Status 200.
    throw new Error(`${url} lieferte kein JSON, sondern: ${text.slice(0, 80).replace(/\s+/g, ' ')}…`);
  }
}
