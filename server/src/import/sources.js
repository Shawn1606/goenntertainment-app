/**
 * Welche Location wird woher gelesen.
 *
 * Bewusst eine Liste und keine Adapter-Datei je Haus: Die meisten Locations
 * liefern eines von drei Formaten, und dann ist eine neue Quelle fuenf Zeilen
 * Eintrag statt einer neuen Datei (siehe adapters/).
 *
 * WICHTIG – woher die Daten kommen duerfen:
 * Hier stehen nur die EIGENEN Seiten der Veranstalter, nicht fremde
 * Sammel-Kalender. Ein Veranstaltungsportal wie wasgehtingoettingen.de fuehrt
 * eine kuratierte Datenbank; die ist nach § 87b UrhG geschuetzt und ihre AGB
 * erlauben Kopien nur privat und nicht kommerziell. Die Seite eines Hauses zu
 * lesen, das seine eigenen Termine veroeffentlicht, ist ein anderer Fall – und
 * jedes Event traegt unten den Link zurueck zur Quelle (siehe normalize.js).
 *
 * Bevor eine Location dazukommt: kurz per Mail fragen. Die meisten Haeuser
 * freuen sich ueber die Reichweite, und die Zusage kostet eine Zeile im
 * Feld `permission`.
 */

export const SOURCES = [
  {
    slug: 'noergelbuff',
    name: 'Nörgelbuff',
    adapter: 'tribe',
    // The Events Calendar (WordPress). Liefert Titel, Beschreibung, Bild,
    // Kategorien, Ort UND utc_start_date – die vollstaendigste Quelle der Stadt.
    url: 'https://noergelbuff.de/wp-json/tribe/events/v1/events',
    defaultLocation: 'Nörgelbuff, Groner Straße 23, Göttingen',
    defaultLabel: 'Konzert Livemusik',
    host: {
      email: 'import+noergelbuff@goenntertainment.local',
      name: 'Nörgelbuff',
      username: 'noergelbuff',
    },
    website: 'https://noergelbuff.de',
    permission: 'offen – vor dem ersten Live-Lauf anfragen',
  },
];

/**
 * Locations ohne nutzbare Quelle – als Notiz und nicht als Kommentar-Grab, damit
 * nicht dreimal jemand dasselbe nachprueft.
 *
 * Stand 29.07.2026 sind rund 35 Adressen geprueft: Startseiten, Programmseiten,
 * WordPress-Inhaltstypen, REST-Endpunkte, JSON-LD, iCal und RSS. Das Ergebnis ist
 * unbequem, aber eindeutig: Goettinger Haeuser veroeffentlichen ihre Termine fast
 * nirgends maschinenlesbar. Der Engpass ist nicht der Code – ein neuer Adapter
 * bringt nichts, solange keine Daten herauskommen.
 *
 * `ask` steht dort, wo eine Anfrage die Quelle wirklich freischalten wuerde. Das
 * ist die Liste, an der sich Arbeit lohnt.
 */
export const UNAVAILABLE = [
  {
    name: 'Lokhalle',
    reason:
      'REST-Sammlung /wp-json/wp/v2/veranstaltungen ist offen und liefert Titel, Link, Bild und Genre – aber KEIN Termin-Datum: Die ACF-Felder sind nicht fuer REST freigegeben, und im HTML steht das Datum auch nicht (JetEngine rendert es per JavaScript).',
    ask: 'Beim Datums-Feld in ACF "Show in REST API" einschalten – dann genuegt hier ein Eintrag.',
  },
  {
    name: 'Stadthalle Göttingen',
    reason: 'Wie Lokhalle – dieselbe WordPress-/JetEngine-Installation, dasselbe fehlende Datum.',
    ask: 'Dieselbe Anfrage wie bei der Lokhalle; beide Seiten werden offenbar zusammen betreut.',
  },
  {
    name: 'Theater im OP',
    reason:
      'liefert per REST nur Produktionen (wp_theatre_prod); die einzelnen Termine liegen in wp_theatre_event und sind nicht freigegeben. Einen Termin-Feed hat das Plugin hier nicht (?wpt_events_feed liefert die Startseite).',
    ask: 'wp_theatre_event auf show_in_rest stellen – dann liegt der ganze Spielplan offen.',
  },
  {
    name: 'CinemaxX Göttingen',
    reason:
      'Next.js/Sitecore. Die Filmtitel stehen im __NEXT_DATA__ der Seite /kinoprogramm/gottingen/jetzt-im-kino (robots.txt erlaubt sie), die VORSTELLUNGSZEITEN kommen aber per Laufzeit-Aufruf, dessen Endpunkt sich nicht ermitteln liess. Ausserdem: Ein Kino macht 40-80 Vorstellungen am Tag – als einzelne Events wuerde das die App zuschuetten. Sinnvoll waere ein Eintrag je Film und Tag, nicht je Vorstellung.',
  },
  { name: 'Exil', reason: 'veröffentlicht nur auf Facebook – Scraping verstößt gegen dessen ToS' },
  {
    name: 'Alpenmax Göttingen',
    reason:
      'alpenmax.de ist eine geparkte Verkaufs-Domain (leitet auf webindex.org). Der echte Auftritt liegt auf alpenmax-goettingen.com und ist eine React-App; der Endpunkt fuer die Termine steckt in keinem der ausgelieferten Bundles (Haupt-Bundle 43 kB, keine CMS-Spuren).',
  },
  {
    name: 'Club Savoy',
    reason:
      'club-savoy.com (nicht .de) sperrt /wp-json mit 403. Im HTML nur JSON-LD vom Typ NightClub – Angaben zum Haus, keine Termine.',
  },
  { name: 'musa', reason: 'eigenes CMS, keine maschinenlesbare Ausgabe' },
  { name: 'Junges Theater', reason: 'WordPress ohne Termin-Inhaltstyp' },
  { name: 'Deutsches Theater', reason: 'REST-Schnittstelle abgeschaltet' },
  { name: 'KulturBahnhof Uslar', reason: 'RSS-Link im Kopf der Seite antwortet mit 404' },
  {
    name: 'Stadt Göttingen (Veranstaltungskalender)',
    reason:
      'Kalender-Seite ohne Event-Auszeichnung; der einzige Feed (portal/rss.xml) ist der allgemeine Nachrichten-Feed.',
  },
  {
    name: 'Universität Göttingen',
    reason: 'Termine nur im Seitenkopf eingebettet, kein Kalender-Feed gefunden.',
  },
];

export function sourceBySlug(slug) {
  return SOURCES.find((source) => source.slug === slug) ?? null;
}
