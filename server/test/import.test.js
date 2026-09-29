/**
 * Prueft den quellen-unabhaengigen Teil des Event-Imports.
 *
 * Bewusst OHNE Datenbank und ohne Netz: Getestet wird das Umformen – HTML zu
 * Text, Wandzeit zu UTC, Kategorien zu Interessen, Roh-Event zu Aktivitaet. Das
 * ist der Teil mit den Sonderfaellen. Der Rest (store.js) ist SQL und braucht
 * MySQL; ein Test, der nur auf einem eingerichteten Rechner laeuft, wird als
 * Erster uebersprungen.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  LIMITS,
  contentHash,
  htmlToText,
  interestSlugsFor,
  isPast,
  normalizeEvent,
  truncate,
  wallTimeToUtc,
} from '../src/import/normalize.js';
import { parseIcal } from '../src/import/adapters/ical.js';
import { parseJsonLd } from '../src/import/adapters/jsonld.js';
import { SOURCES, UNAVAILABLE } from '../src/import/sources.js';

const SOURCE = {
  slug: 'testbuehne',
  name: 'Testbühne',
  defaultLocation: 'Testbühne, Göttingen',
  defaultLabel: 'Konzert',
};

test('htmlToText: Absaetze werden Zeilenumbrueche, nicht zusammengeklebt', () => {
  const text = htmlToText('<p>Erster Satz.</p><p>Zweiter Satz.</p>');
  assert.equal(text, 'Erster Satz.\nZweiter Satz.');
});

test('htmlToText: Skripte verschwinden samt Inhalt', () => {
  assert.equal(htmlToText('<script>var a = 1;</script><p>Text</p>'), 'Text');
});

test('htmlToText: Entities werden aufgeloest', () => {
  assert.equal(htmlToText('Tickets ab 22&nbsp;&euro; &amp; mehr &#8211; g&uuml;nstig'), 'Tickets ab 22 € & mehr – günstig');
});

test('truncate: schneidet an der Wortgrenze und markiert mit …', () => {
  const result = truncate('Ein sehr langer Titel mit vielen Worten', 20);
  assert.ok(result.length <= 20, `zu lang: ${result.length}`);
  assert.ok(result.endsWith('…'));
  assert.ok(!result.includes('vielen Wor'), 'darf nicht mitten im Wort enden');
});

test('truncate: kurze Werte bleiben unangetastet', () => {
  assert.equal(truncate('Kurz', 100), 'Kurz');
});

test('wallTimeToUtc: Sommerzeit zieht zwei Stunden ab', () => {
  assert.equal(wallTimeToUtc('2026-07-31 20:00:00'), '2026-07-31 18:00:00');
});

test('wallTimeToUtc: Winterzeit zieht eine Stunde ab', () => {
  assert.equal(wallTimeToUtc('2026-01-15 20:00:00'), '2026-01-15 19:00:00');
});

test('wallTimeToUtc: die Nacht der Zeitumstellung stimmt auf beiden Seiten', () => {
  // 2026: Umstellung auf Winterzeit in der Nacht zum 25.10.
  assert.equal(wallTimeToUtc('2026-10-24 23:00:00'), '2026-10-24 21:00:00');
  assert.equal(wallTimeToUtc('2026-10-25 23:00:00'), '2026-10-25 22:00:00');
});

test('wallTimeToUtc: unlesbare Angaben ergeben null statt eines falschen Datums', () => {
  assert.equal(wallTimeToUtc('demnächst'), null);
  assert.equal(wallTimeToUtc(''), null);
  assert.equal(wallTimeToUtc(null), null);
});

test('isPast: vergleicht gegen den uebergebenen Zeitpunkt', () => {
  const now = new Date('2026-07-29T12:00:00Z');
  assert.equal(isPast('2026-07-28 20:00:00', now), true);
  assert.equal(isPast('2026-07-30 20:00:00', now), false);
  assert.equal(isPast(null, now), true);
});

/**
 * Der erste Treffer ist die FUEHRENDE Kategorie – nach ihr unterteilt die App
 * ihre Listen. Diese Tests halten deshalb nicht bloss fest, DASS etwas
 * zugeordnet wird, sondern WOHIN es zuerst geht.
 */
test('interestSlugsFor: ein Tanzabend fuehrt mit Tanzen, nicht mit Musik', () => {
  // Genau der Fall, an dem die alte Zuordnung scheiterte: Alles Musikalische
  // landete in „Musik", und damit lagen 143 Termine in einer Kategorie.
  assert.equal(interestSlugsFor(['Salsa en sotano'])[0], 'tanzen');
  assert.equal(interestSlugsFor(['Lindy Hop Tanzabend'])[0], 'tanzen');
  assert.equal(interestSlugsFor(['Tango Milonga'])[0], 'tanzen');
});

test('interestSlugsFor: ein Konzert fuehrt mit Konzerte', () => {
  assert.equal(interestSlugsFor(['Konzert', 'Rock/Pop'])[0], 'konzerte');
  assert.equal(interestSlugsFor(['Noergelbuff Houseband'])[0], 'konzerte');
  assert.equal(interestSlugsFor(['Deep in the groove - Jazzsession'])[0], 'konzerte');
});

test('interestSlugsFor: eine Party fuehrt mit Party & Club', () => {
  assert.equal(interestSlugsFor(['Inventur Party'])[0], 'party-club');
  assert.equal(interestSlugsFor(['Top Ten Charts-Party'])[0], 'party-club');
});

test('interestSlugsFor: Comedy geht nicht an Theater', () => {
  // „Komische Nacht" ist Comedy, obwohl sie auf einer Buehne stattfindet.
  assert.equal(interestSlugsFor(['23. Komische Nacht'])[0], 'comedy-kabarett');
  assert.equal(interestSlugsFor(['Kabarett-Abend'])[0], 'comedy-kabarett');
});

test('interestSlugsFor: die weiteren Arten treffen ihre Kategorie', () => {
  const fuehrend = (label) => interestSlugsFor([label])[0];
  assert.equal(fuehrend('Liebe sucht ein Zuhause (Theater im OP)'), 'theater-buhne');
  assert.equal(fuehrend('Vorlesen in der Zweigstelle'), 'lesung-literatur');
  assert.equal(fuehrend('Spider-Man im Kino'), 'film-kino');
  assert.equal(fuehrend('Ab aufs Rad – Ausstellung'), 'ausstellung-museum');
  assert.equal(fuehrend('Flohmarkt Kaufland'), 'markt-flohmarkt');
  assert.equal(fuehrend('KWP Festival, Tag 1'), 'festival');
  assert.equal(fuehrend('Swing Tanze lernen – Workshop'), 'tanzen');
  assert.equal(fuehrend('WeinKlang – Weinprobe'), 'essen-trinken');
  assert.equal(fuehrend('Offene Folksession'), 'konzerte');
  assert.equal(fuehrend('CHEERS TO THE QUEERS'), 'queer');
  assert.equal(fuehrend('Mitmachgeschichte fuer Kinder'), 'familie-kinder');
  assert.equal(fuehrend('OBJECTION! JURA PROFS PARTY'), 'party-club');
});

test('interestSlugsFor: die weiten Kategorien greifen nur, wenn nichts Genaueres passt', () => {
  // „Rock" allein ist keine Veranstaltungsart – dann ist „Musik" richtig.
  assert.equal(interestSlugsFor(['Rock/Pop'])[0], 'musik');
  assert.equal(interestSlugsFor(['Stammtisch'])[0], 'soziales-community');
});

test('interestSlugsFor: eine zweite Kategorie kommt mit, wenn sie zutrifft', () => {
  // Fuer die Filter nuetzlich, fuer die Unterteilung zaehlt nur die erste.
  const slugs = interestSlugsFor(['Salsa-Party mit Live-Band']);
  assert.equal(slugs[0], 'tanzen');
  assert.ok(slugs.length > 1, 'Party und Konzert sollten mitkommen');
});

test('interestSlugsFor: nie mehr als fuenf – das Limit der Schnittstelle', () => {
  const many = interestSlugsFor([
    'Konzert', 'Theater', 'Stammtisch', 'Weinprobe', 'Lauftreff', 'Yoga', 'Fotografie',
    'Flohmarkt', 'Kino', 'Lesung', 'Party', 'Workshop',
  ]);
  assert.ok(many.length <= 5, `zu viele: ${many.length}`);
});

test('interestSlugsFor: ohne Treffer eine leere Liste, kein Rateschuss', () => {
  assert.deepEqual(interestSlugsFor(['Betriebsversammlung']), []);
});

test('contentHash: gleicher Inhalt gleicher Wert, geaenderter Inhalt anderer', () => {
  const base = { title: 'A', description: 'B', location: 'C', starts_at: '2026-07-31 18:00:00' };
  assert.equal(contentHash(base), contentHash({ ...base }));
  assert.notEqual(contentHash(base), contentHash({ ...base, title: 'A2' }));
  assert.notEqual(contentHash(base), contentHash({ ...base, starts_at: '2026-07-31 19:00:00' }));
});

test('contentHash: eine geaenderte Kategorie-Zuordnung gilt als Aenderung', () => {
  // Sonst blieben schon importierte Events still in der alten Kategorie, wenn
  // INTEREST_RULES geschaerft wird – der Code saegte dann etwas anderes als die DB.
  const base = { title: 'A', description: 'B', location: 'C', starts_at: '2026-07-31 18:00:00' };
  assert.notEqual(
    contentHash({ ...base, interestSlugs: ['musik'] }),
    contentHash({ ...base, interestSlugs: ['tanzen'] }),
  );
});

test('contentHash: ein neues Plakat gilt als Aenderung', () => {
  // Sonst meldete der naechste Lauf "unveraendert" und das Bild blieb das alte.
  const base = { title: 'A', description: 'B', location: 'C', starts_at: '2026-07-31 18:00:00' };
  assert.notEqual(
    contentHash({ ...base, banner_path: 'https://example.org/alt.jpg' }),
    contentHash({ ...base, banner_path: 'https://example.org/neu.jpg' }),
  );
});

test('normalizeEvent: das Bild der Quelle wird verlinkt, nicht kopiert', () => {
  const event = normalizeEvent(
    {
      externalId: 5705,
      title: 'jules',
      startsAtUtc: '2026-07-31 18:00:00',
      imageUrl: 'https://noergelbuff.de/wp-content/uploads/2026/06/detailEvent_2536013.jpg',
    },
    SOURCE,
  );
  assert.equal(
    event.banner_path,
    'https://noergelbuff.de/wp-content/uploads/2026/06/detailEvent_2536013.jpg',
  );
});

test('normalizeEvent: ohne Bild bleibt banner_path null', () => {
  const event = normalizeEvent(
    { externalId: 1, title: 'Ohne Bild', startsAtUtc: '2026-07-31 18:00:00' },
    SOURCE,
  );
  assert.equal(event.banner_path, null);
});

test('normalizeEvent: eine zu lange Adresse wird verworfen, nicht abgeschnitten', () => {
  // VARCHAR(255) – abgeschnitten zeigte die URL ins Nichts. Ohne Bild springt in
  // der App das Zeichen des Veranstalters ein, und das ist der bessere Ausgang.
  const event = normalizeEvent(
    {
      externalId: 2,
      title: 'Langer Pfad',
      startsAtUtc: '2026-07-31 18:00:00',
      imageUrl: `https://example.org/${'x'.repeat(260)}.jpg`,
    },
    SOURCE,
  );
  assert.equal(event.banner_path, null);
});

test('normalizeEvent: nur http(s) wird uebernommen', () => {
  for (const bad of ['/relativ/bild.jpg', 'data:image/png;base64,AAA', 'javascript:alert(1)']) {
    const event = normalizeEvent(
      { externalId: 3, title: 'T', startsAtUtc: '2026-07-31 18:00:00', imageUrl: bad },
      SOURCE,
    );
    assert.equal(event.banner_path, null, `${bad} haette nicht durchgehen duerfen`);
  }
});

test('normalizeEvent: baut aus einem Tribe-Event eine Aktivitaet', () => {
  const event = normalizeEvent(
    {
      externalId: 5705,
      title: 'jules',
      description: '<p>Veranstaltung des Göttinger Kultursommer 2026:</p><p>Pop aus Stuttgart.</p>',
      location: 'Nörgelbuff, Gronerstraße 23, Göttingen',
      startsAtUtc: '2026-07-31 18:00:00',
      url: 'https://noergelbuff.de/events/jules/',
      imageUrl: 'https://noergelbuff.de/bild.jpg',
      labels: ['Im Vorverkauf', 'Konzert'],
    },
    SOURCE,
  );

  assert.equal(event.title, 'jules');
  assert.equal(event.starts_at, '2026-07-31 18:00:00');
  assert.equal(event.location, 'Nörgelbuff, Gronerstraße 23, Göttingen');
  assert.equal(event.externalKey, 'testbuehne:5705');
  assert.ok(event.description.startsWith('Veranstaltung des Göttinger Kultursommer'));
  assert.equal(event.interestSlugs[0], 'konzerte', 'ein Konzert fuehrt mit Konzerte, nicht mit Musik');
});

test('normalizeEvent: die Quelle wird in der Beschreibung verlinkt', () => {
  const event = normalizeEvent(
    { externalId: 1, title: 'Konzert', description: 'Text', startsAtUtc: '2026-12-01 19:00:00', url: 'https://example.org/e/1' },
    SOURCE,
  );
  assert.ok(
    event.description.includes('https://example.org/e/1'),
    'ohne Rueckverweis waere die Uebernahme nicht fair – und der Link fuehrt zu den Tickets',
  );
});

test('normalizeEvent: haelt das Beschreibungs-Limit INKLUSIVE Quell-Link ein', () => {
  const event = normalizeEvent(
    {
      externalId: 2,
      title: 'Langer Text',
      description: 'Wort '.repeat(900),
      startsAtUtc: '2026-12-01 19:00:00',
      url: 'https://example.org/sehr/langer/pfad/zu/dem/event/damit/es/zaehlt',
    },
    SOURCE,
  );
  assert.ok(
    event.description.length <= LIMITS.description,
    `Beschreibung ist ${event.description.length} Zeichen, erlaubt sind ${LIMITS.description}`,
  );
  assert.ok(event.description.includes('https://example.org/sehr/langer'), 'der Link darf nicht wegfallen');
});

test('normalizeEvent: ohne Titel oder Datum gibt es null statt Muell', () => {
  assert.equal(normalizeEvent({ externalId: 1, title: '', startsAtUtc: '2026-12-01 19:00:00' }, SOURCE), null);
  assert.equal(normalizeEvent({ externalId: 1, title: 'Ohne Datum' }, SOURCE), null);
});

test('normalizeEvent: fehlender Ort fällt auf die Adresse der Location zurueck', () => {
  const event = normalizeEvent(
    { externalId: 3, title: 'Konzert', startsAtWall: '2026-12-01 20:00:00' },
    SOURCE,
  );
  assert.equal(event.location, SOURCE.defaultLocation);
  assert.equal(event.starts_at, '2026-12-01 19:00:00', 'Wandzeit muss nach UTC gerechnet werden');
});

test('parseIcal: gefaltete Zeilen werden wieder zusammengesetzt', () => {
  const ics = [
    'BEGIN:VEVENT',
    'UID:abc-123',
    'SUMMARY:Ein Konzert',
    'DESCRIPTION:Dies ist eine sehr lange Beschreibung, die der Standard nach 75',
    '  Zeichen umbricht und mit einem Leerzeichen fortsetzt.',
    'DTSTART;TZID=Europe/Berlin:20260731T200000',
    'LOCATION:Nörgelbuff',
    'END:VEVENT',
  ].join('\r\n');

  const [event] = parseIcal(ics, SOURCE);
  assert.equal(event.externalId, 'abc-123');
  assert.ok(
    event.description.includes('75 Zeichen umbricht'),
    'die Fortsetzungszeile darf nicht verloren gehen',
  );
  assert.equal(event.startsAtWall, '2026-07-31 20:00:00');
  assert.equal(event.timeZone, 'Europe/Berlin');
});

test('parseIcal: UTC-Zeiten (…Z) werden nicht noch einmal umgerechnet', () => {
  const ics = 'BEGIN:VEVENT\r\nUID:z1\r\nSUMMARY:X\r\nDTSTART:20260731T180000Z\r\nEND:VEVENT';
  const [event] = parseIcal(ics, SOURCE);
  assert.equal(event.startsAtUtc, '2026-07-31 18:00:00');
  assert.equal(event.startsAtWall, null);
});

test('parseIcal: maskierte Kommas und Umbrueche werden entpackt', () => {
  const ics = 'BEGIN:VEVENT\r\nUID:e1\r\nSUMMARY:Rock\\, Pop\\nund mehr\r\nDTSTART:20260731T180000Z\r\nEND:VEVENT';
  const [event] = parseIcal(ics, SOURCE);
  assert.equal(event.title, 'Rock, Pop\nund mehr');
});

test('parseIcal: ohne UID entsteht ein Ersatz-Schluessel statt undefined', () => {
  const ics = 'BEGIN:VEVENT\r\nSUMMARY:Ohne UID\r\nDTSTART:20260731T180000Z\r\nEND:VEVENT';
  const [event] = parseIcal(ics, SOURCE);
  assert.ok(event.externalId.includes('Ohne UID'));
});

test('parseJsonLd: findet Events auch tief in @graph', () => {
  const html = `<script type="application/ld+json">${JSON.stringify({
    '@graph': [
      { '@type': 'WebSite', name: 'Egal' },
      {
        '@type': 'MusicEvent',
        name: 'Jazz im Keller',
        startDate: '2026-08-14T20:00:00+02:00',
        url: 'https://example.org/jazz',
        location: { '@type': 'Place', name: 'Kleiner Ratskeller', address: { streetAddress: 'Markt 9', addressLocality: 'Göttingen' } },
      },
    ],
  })}</script>`;

  const [event] = parseJsonLd(html, SOURCE);
  assert.equal(event.title, 'Jazz im Keller');
  assert.equal(event.startsAtUtc, '2026-08-14 18:00:00', 'der Offset +02:00 gehoert herausgerechnet');
  assert.equal(event.location, 'Kleiner Ratskeller, Markt 9, Göttingen');
});

test('parseJsonLd: ohne Offset gilt die Zeit als Wandzeit', () => {
  const html = `<script type="application/ld+json">${JSON.stringify({
    '@type': 'Event', name: 'Lesung', startDate: '2026-08-14T19:00:00',
  })}</script>`;

  const [event] = parseJsonLd(html, SOURCE);
  assert.equal(event.startsAtWall, '2026-08-14 19:00:00');
  assert.equal(event.startsAtUtc, null);
});

test('parseJsonLd: ein kaputter Block kostet nicht die ganze Seite', () => {
  const html =
    '<script type="application/ld+json">{ kaputt </script>' +
    `<script type="application/ld+json">${JSON.stringify({ '@type': 'Event', name: 'Heil', startDate: '2026-08-14T19:00:00' })}</script>`;

  const events = parseJsonLd(html, SOURCE);
  assert.equal(events.length, 1);
  assert.equal(events[0].title, 'Heil');
});

test('sources: jede Quelle hat Adapter, URL und ein eigenes Gastgeber-Konto', () => {
  for (const source of SOURCES) {
    assert.ok(source.slug, 'slug fehlt');
    assert.ok(['tribe', 'ical', 'jsonld'].includes(source.adapter), `unbekannter Adapter bei ${source.slug}`);
    assert.match(source.url, /^https:\/\//, `${source.slug} muss über https laufen`);
    assert.ok(source.host?.email, `${source.slug} braucht ein Gastgeber-Konto`);
    assert.ok(source.defaultLocation, `${source.slug} braucht eine Anschrift als Rueckfall`);
  }
});

test('sources: Slugs und Gastgeber-Mails sind eindeutig', () => {
  const slugs = SOURCES.map((source) => source.slug);
  const emails = SOURCES.map((source) => source.host.email);
  assert.equal(new Set(slugs).size, slugs.length, 'doppelter Slug – der Import wuerde Events vermischen');
  assert.equal(new Set(emails).size, emails.length, 'doppelte Gastgeber-Mail – zwei Locations unter einem Konto');
});

test('sources: keine Location steht in beiden Listen', () => {
  const active = new Set(SOURCES.map((source) => source.name));
  for (const entry of UNAVAILABLE) {
    assert.ok(!active.has(entry.name), `${entry.name} gilt gleichzeitig als verfügbar und als ohne Quelle`);
  }
});
