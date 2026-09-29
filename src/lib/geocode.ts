/**
 * Wandelt einen Orts-Text (z. B. „Stadtpark Köln") in Koordinaten um.
 * Nutzt den kostenlosen OpenStreetMap-Dienst Nominatim – kein API-Key nötig.
 *
 * Nominatim-Regeln: höchstens ~1 Anfrage/Sekunde und ein aussagekräftiger
 * User-Agent. Deshalb cachen wir Ergebnisse und fragen der Reihe nach an.
 *
 * Ein Ort wird in mehreren Schreibweisen probiert, siehe `placeQueries` in
 * src/domain/place-query.ts: „Nörgelbuff, Gronerstraße 23, Göttingen" findet
 * Nominatim als Ganzes NICHT, „Gronerstraße 23, Göttingen" schon. Ohne diese
 * Stufen bleibt die Karte für die übliche Schreibweise leer.
 */
import { placeQueries } from '@/domain/place-query';

export type Coords = { lat: number; lng: number };

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

// Cache pro App-Lauf: gleicher Orts-Text wird nur einmal angefragt.
const cache = new Map<string, Coords | null>();

// Verkettet Anfragen, damit wir nicht mehrere gleichzeitig abfeuern.
let queue: Promise<unknown> = Promise.resolve();

function normalize(location: string): string {
  return location.trim().toLowerCase();
}

async function fetchCoords(location: string): Promise<Coords | null> {
  const url = `${NOMINATIM}?format=jsonv2&limit=1&q=${encodeURIComponent(location)}`;
  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        // Nominatim möchte einen erkennbaren User-Agent.
        'User-Agent': 'Goenntertainment-App (activity map)',
      },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { lat: string; lon: string }[];
    const first = data[0];
    if (!first) return null;
    const lat = Number(first.lat);
    const lng = Number(first.lon);
    if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}

/**
 * Liefert Koordinaten für einen Orts-Text – oder `null`, wenn nichts gefunden
 * wurde. Ergebnisse werden gecacht; Anfragen laufen nacheinander (Rate-Limit).
 *
 * Gecacht wird unter dem ORIGINAL-Text, nicht unter der Schreibweise, die
 * geholfen hat: 143 Events im selben Haus tragen denselben Ortstext und sollen
 * eine einzige Anfrage auslösen, nicht 143.
 */
export async function geocode(location: string): Promise<Coords | null> {
  const key = normalize(location);
  if (!key) return null;
  if (cache.has(key)) return cache.get(key) ?? null;

  const run = queue.then(async () => {
    // Falls in der Zwischenzeit schon jemand anderes das Ergebnis geholt hat:
    if (cache.has(key)) return cache.get(key) ?? null;

    let coords: Coords | null = null;
    // Stufenweise gröber, bis etwas trifft. Die Pause liegt bei JEDER Anfrage,
    // auch der erfolglosen – das Rate-Limit zählt Anfragen, nicht Treffer.
    for (const query of placeQueries(location)) {
      coords = await fetchCoords(query);
      await new Promise((r) => setTimeout(r, 1100));
      if (coords) break;
    }

    cache.set(key, coords);
    return coords;
  });

  // Fehler in einem Lauf sollen die Warteschlange nicht blockieren.
  queue = run.catch(() => undefined);
  return run;
}
