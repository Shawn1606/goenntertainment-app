/**
 * Adapter fuer iCal-Feeds (.ics).
 *
 * Der wichtigste Adapter fuer den Ausbau: Eine Location, die keine
 * Schnittstelle hat, kann fast immer einen Kalender exportieren – Google
 * Calendar, Outlook, Nextcloud und die meisten CMS koennen das ab Werk. Damit
 * ist "die Location fragen" oft nur die Bitte um einen Link, nicht um ein
 * Software-Projekt.
 */
import { fetchText } from './http.js';

export async function fetchIcalEvents(source) {
  const text = await fetchText(source.url);
  return parseIcal(text, source);
}

/**
 * Hebt die Faltung auf, die der Standard vorschreibt (RFC 5545, 3.1).
 *
 * iCal bricht lange Zeilen nach 75 Zeichen um und rueckt die Fortsetzung mit
 * einem Leerzeichen ein. Wer das nicht zusammenfuegt, verliert bei jeder
 * laengeren Beschreibung den Rest – und genau die Beschreibungen sind lang.
 */
function unfold(text) {
  return String(text).replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
}

/** Text-Werte im iCal sind maskiert: \n, \, \; \\ zurueckwandeln. */
function unescapeValue(value) {
  return String(value)
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

/**
 * Zerlegt eine Zeile in Name, Parameter und Wert.
 * 'DTSTART;TZID=Europe/Berlin:20260731T200000' → { name, params, value }
 */
function parseLine(line) {
  const colon = line.indexOf(':');
  if (colon === -1) return null;

  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const [name, ...paramParts] = head.split(';');

  const params = {};
  for (const part of paramParts) {
    const eq = part.indexOf('=');
    if (eq > 0) params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
  }

  return { name: name.toUpperCase(), params, value };
}

/**
 * Uebersetzt einen iCal-Zeitwert in das, was normalizeEvent erwartet.
 *
 * Drei Formen kommen vor, und sie bedeuten Verschiedenes:
 *  - '…Z'                  → schon UTC, direkt uebernehmen
 *  - mit TZID              → Wandzeit in dieser Zone
 *  - ohne alles / nur Datum → Wandzeit in der Zone der Quelle
 */
function parseIcalTime(entry) {
  const value = entry.value.trim();
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(value);
  if (!match) return {};

  const [, y, mo, d, h = '00', mi = '00', s = '00', zulu] = match;
  const wall = `${y}-${mo}-${d} ${h}:${mi}:${s}`;

  if (zulu) return { startsAtUtc: wall };
  return { startsAtWall: wall, timeZone: entry.params.TZID || undefined };
}

export function parseIcal(text, source) {
  const lines = unfold(text).split('\n');
  const events = [];
  let current = null;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === 'BEGIN:VEVENT') {
      current = {};
      continue;
    }
    if (trimmed === 'END:VEVENT') {
      if (current) events.push(toRawEvent(current, source));
      current = null;
      continue;
    }
    if (!current) continue;

    const entry = parseLine(trimmed);
    if (!entry) continue;

    switch (entry.name) {
      case 'UID':
        current.uid = entry.value;
        break;
      case 'SUMMARY':
        current.title = unescapeValue(entry.value);
        break;
      case 'DESCRIPTION':
        current.description = unescapeValue(entry.value);
        break;
      case 'LOCATION':
        current.location = unescapeValue(entry.value);
        break;
      case 'URL':
        current.url = entry.value;
        break;
      case 'CATEGORIES':
        current.labels = entry.value.split(',').map(unescapeValue);
        break;
      case 'DTSTART':
        Object.assign(current, parseIcalTime(entry));
        break;
      default:
        break;
    }
  }

  return events;
}

function toRawEvent(event, source) {
  return {
    // Ohne UID auf Datum+Titel ausweichen: besser ein schwacher Schluessel als
    // bei jedem Lauf neue Dubletten (siehe externalKey in normalize.js).
    externalId: event.uid ?? `${event.startsAtWall ?? event.startsAtUtc ?? ''}-${event.title ?? ''}`,
    title: event.title,
    description: event.description,
    location: event.location || source.defaultLocation,
    startsAtUtc: event.startsAtUtc ?? null,
    startsAtWall: event.startsAtWall ?? null,
    timeZone: event.timeZone,
    url: event.url ?? null,
    imageUrl: null, // iCal kennt keine Bilder
    labels: event.labels ?? [],
  };
}
