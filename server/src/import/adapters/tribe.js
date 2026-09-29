/**
 * Adapter fuer "The Events Calendar" – das WordPress-Plugin, das im deutschen
 * Kulturbetrieb am haeufigsten laeuft. Es bringt eine offene REST-Schnittstelle
 * mit (/wp-json/tribe/events/v1/events), und die liefert alles, was die App
 * braucht, inklusive UTC-Zeiten.
 *
 * Ein Adapter, beliebig viele Locations: Neue Quelle = Eintrag in sources.js.
 */
import { fetchJson } from './http.js';

const PER_PAGE = 50;

/** Hoechstzahl an Seiten je Lauf – Bremse gegen einen Feed, der nie endet. */
const MAX_PAGES = 20;

export async function fetchTribeEvents(source, { from = new Date() } = {}) {
  const raw = [];
  // Nur ab heute: Vergangenes wuerde der Import ohnehin verwerfen (isPast),
  // aber es erst gar nicht zu holen spart der Location die halbe Last.
  const startDate = from.toISOString().slice(0, 10);

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = `${source.url}?per_page=${PER_PAGE}&page=${page}&start_date=${startDate}`;
    const payload = await fetchJson(url);
    const events = Array.isArray(payload.events) ? payload.events : [];

    for (const event of events) {
      raw.push(toRawEvent(event, source));
    }

    // `total_pages` bezieht sich auf per_page, ist also die verlaessliche Grenze.
    if (events.length < PER_PAGE || page >= (payload.total_pages ?? 1)) break;
  }

  return raw;
}

function toRawEvent(event, source) {
  const venue = event.venue ?? {};
  // Adresse aus den Teilen, die da sind: Manche Haeuser fuellen nur den Namen.
  const address = [venue.venue, venue.address, venue.city].filter(Boolean).join(', ');

  return {
    externalId: event.id,
    title: event.title,
    description: event.description,
    location: address || source.defaultLocation,
    // Das Plugin liefert die UTC-Zeit fertig mit – die nehmen wir, statt selbst
    // aus Wandzeit + Zeitzone zu rechnen. Weniger Gelegenheit, es falsch zu machen.
    startsAtUtc: event.utc_start_date ? event.utc_start_date.slice(0, 19) : null,
    startsAtWall: event.start_date ?? null,
    timeZone: event.timezone ?? undefined,
    url: event.url ?? null,
    imageUrl: event.image?.url ?? null,
    labels: [
      ...(event.categories ?? []).map((category) => category.name),
      ...(event.tags ?? []).map((tag) => tag.name),
      event.cost ?? '',
    ].filter(Boolean),
  };
}
