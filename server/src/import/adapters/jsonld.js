/**
 * Adapter fuer schema.org-Auszeichnung im HTML (JSON-LD).
 *
 * Moderne Seiten legen fuer Google ohnehin `<script type="application/ld+json">`
 * mit `"@type": "Event"` ab. Das ist maschinenlesbar, ohne dass die Location
 * etwas Neues bauen muss – und es ist stabiler als HTML zu zerlegen, weil es
 * sich mit dem Layout nicht aendert.
 */
import { fetchText } from './http.js';

export async function fetchJsonLdEvents(source) {
  const html = await fetchText(source.url);
  return parseJsonLd(html, source);
}

/** Zieht alle JSON-LD-Bloecke aus dem HTML. Kaputte Bloecke werden uebersprungen. */
function jsonLdBlocks(html) {
  const blocks = [];
  const pattern = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

  for (const match of String(html).matchAll(pattern)) {
    try {
      blocks.push(JSON.parse(match[1].trim()));
    } catch {
      // Eine Seite mit einem fehlerhaften Block soll nicht die ganze Quelle kosten.
    }
  }
  return blocks;
}

/**
 * Sammelt alle Event-Knoten – egal wie tief sie liegen.
 *
 * Die Auszeichnung kommt in jeder denkbaren Verschachtelung: als einzelnes
 * Objekt, als Array, unter `@graph`, oder als `itemListElement` einer Liste.
 * Deshalb wird der Baum durchlaufen statt fester Pfade geraten.
 */
function collectEvents(node, found = []) {
  if (Array.isArray(node)) {
    for (const item of node) collectEvents(item, found);
    return found;
  }
  if (!node || typeof node !== 'object') return found;

  const types = [].concat(node['@type'] ?? []);
  if (types.some((type) => String(type).endsWith('Event'))) {
    found.push(node);
  }

  for (const key of ['@graph', 'itemListElement', 'item', 'subEvent', 'events']) {
    if (node[key]) collectEvents(node[key], found);
  }
  return found;
}

/** schema.org erlaubt ueberall Text ODER Objekt – hier auf Text gebracht. */
function textOf(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return textOf(value[0]);
  return value.name ?? value['@id'] ?? '';
}

function addressOf(place) {
  if (!place) return '';
  const address = place.address;
  const parts = [
    textOf(place),
    typeof address === 'string' ? address : address?.streetAddress,
    typeof address === 'object' ? address?.addressLocality : null,
  ];
  return [...new Set(parts.filter(Boolean))].join(', ');
}

export function parseJsonLd(html, source) {
  const nodes = jsonLdBlocks(html).flatMap((block) => collectEvents(block));

  return nodes.map((node) => {
    // startDate kommt als ISO-8601 – mit Offset ('2026-07-31T20:00:00+02:00'),
    // ohne Offset, oder nur als Datum. Mit Offset ist es ein echter Zeitpunkt,
    // ohne Offset ist es Wandzeit und muss durch die Zeitzonen-Rechnung.
    const startDate = String(node.startDate ?? '');
    const hasOffset = /(?:Z|[+-]\d{2}:?\d{2})$/.test(startDate);

    return {
      externalId: node['@id'] ?? node.url ?? `${startDate}-${textOf(node.name)}`,
      title: textOf(node.name),
      description: node.description ?? '',
      location: addressOf(node.location) || source.defaultLocation,
      startsAtUtc: hasOffset
        ? new Date(startDate).toISOString().slice(0, 19).replace('T', ' ')
        : null,
      startsAtWall: hasOffset ? null : startDate.replace('T', ' '),
      url: node.url ?? null,
      imageUrl: typeof node.image === 'string' ? node.image : (node.image?.url ?? null),
      labels: [].concat(node.genre ?? [], node.keywords ?? '', textOf(node.eventType)).filter(Boolean),
    };
  });
}
