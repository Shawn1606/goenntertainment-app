/**
 * Der quellen-unabhaengige Teil des Event-Imports: aus dem, was eine Location
 * liefert, wird ein Datensatz, den `activities` annimmt.
 *
 * Bewusst OHNE Datenbank und ohne Netz – nur Funktionen auf Werten. Das ist der
 * Teil mit den vielen Sonderfaellen (HTML in Beschreibungen, Zeitzonen,
 * Feld-Laengen), und genau der laesst sich so ohne MySQL testen
 * (siehe test/import.test.js).
 */

/** Grenzen aus routes/activities.js – hier gespiegelt, damit der Import nicht am Validator scheitert. */
export const LIMITS = {
  title: 255,
  description: 2000,
  location: 255,
};

/**
 * Zeitzone der Quellen. Alle Locations liegen in Deutschland; Feeds nennen ihre
 * Zeitzone aber nicht immer mit, und dann ist das hier die richtige Annahme.
 */
export const SOURCE_TIMEZONE = 'Europe/Berlin';

const ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  euro: '€',
  szlig: 'ß',
  auml: 'ä',
  ouml: 'ö',
  uuml: 'ü',
  Auml: 'Ä',
  Ouml: 'Ö',
  Uuml: 'Ü',
};

/**
 * Macht aus dem HTML einer Quelle Fliesstext.
 *
 * Warum nicht bloss `replace(/<[^>]+>/g, '')`: Absaetze und `<br>` sind die
 * einzige Gliederung, die in einer Event-Beschreibung steckt. Wer sie ersatzlos
 * entfernt, klebt Saetze aneinander ("…November 2025 statt.Tickets ab 22 €").
 * Deshalb werden Block-Enden zuerst zu Zeilenumbruechen.
 */
export function htmlToText(html) {
  if (!html) return '';

  return String(html)
    // Skripte/Styles samt Inhalt weg, bevor irgendwas anderes passiert.
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, name) => ENTITIES[name] ?? match)
    // Mehr als eine Leerzeile traegt keine Information und kostet nur vom Limit.
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^[ \t]+|[ \t]+$/gm, '')
    .trim();
}

/**
 * Kuerzt auf `max` Zeichen, aber an einer Wortgrenze und mit '…'.
 *
 * Hart abschneiden wuerde mitten im Wort enden; bei Beschreibungen ist das die
 * Sorte Fehler, die man erst in der App sieht.
 */
export function truncate(value, max) {
  const text = String(value ?? '').trim();
  if (text.length <= max) return text;

  const cut = text.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  // Nur an der Wortgrenze schneiden, wenn dabei nicht die Haelfte verloren geht.
  const body = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${body.trimEnd()}…`;
}

/**
 * Offset einer Zeitzone zu genau EINEM Zeitpunkt, in Millisekunden.
 *
 * Umweg ueber Intl statt einer fest verdrahteten "+2 Stunden im Sommer"-Regel:
 * Sommerzeit-Umstellungen sind Datumsabhaengig, und ein Import laeuft ueber
 * Monate im Voraus – der 25.10. braucht einen anderen Offset als der 24.10.
 */
function timezoneOffsetMs(instantMs, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instantMs));

  const get = (type) => Number(parts.find((part) => part.type === type)?.value);
  const asIfUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24, // Intl liefert fuer Mitternacht je nach Version 24
    get('minute'),
    get('second'),
  );
  return asIfUtc - instantMs;
}

/**
 * Liest eine WANDZEIT ('2026-07-31 20:00:00') als Zeit in `timeZone` und gibt
 * den UTC-Zeitpunkt im DB-Format zurueck ('2026-07-31 18:00:00').
 *
 * Das ist die Stelle, an der ein Import sonst still zwei Stunden falsch liegt:
 * `activities.starts_at` steht in UTC (siehe die Notiz in db.js), Feeds nennen
 * aber die oertliche Zeit. Ohne Umrechnung stehen alle Konzerte zu frueh.
 *
 * Zweimal korrigieren, weil der Offset selbst vom Zeitpunkt abhaengt: Der erste
 * Durchgang trifft die richtige Seite der Umstellung, der zweite den Offset dort.
 */
export function wallTimeToUtc(wallTime, timeZone = SOURCE_TIMEZONE) {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ]?(\d{2})?:?(\d{2})?:?(\d{2})?/.exec(
    String(wallTime ?? '').trim(),
  );
  if (!match) return null;

  const [, y, mo, d, h = '00', mi = '00', s = '00'] = match;
  const naive = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));

  let utcMs = naive;
  for (let pass = 0; pass < 2; pass += 1) {
    utcMs = naive - timezoneOffsetMs(utcMs, timeZone);
  }
  return new Date(utcMs).toISOString().slice(0, 19).replace('T', ' ');
}

/** Ist der Zeitpunkt (UTC-String) schon vorbei? Vergangenes importieren wir nicht. */
export function isPast(utcString, now = new Date()) {
  if (!utcString) return true;
  return new Date(`${utcString.replace(' ', 'T')}Z`).getTime() < now.getTime();
}

/**
 * Ordnet die Kategorien/Schlagworte einer Quelle den Kategorien der App zu.
 *
 * Zugeordnet wird ueber Stichworte im Klartext und nicht ueber IDs der Quelle:
 * Jede Location benennt ihre Rubriken anders ("Konzert", "Live", "Rock/Pop"),
 * aber die Woerter wiederholen sich.
 *
 * ## Die Reihenfolge ist die halbe Zuordnung
 *
 * Der erste Treffer wird zur FUEHRENDEN Kategorie – und nach der unterteilt die
 * App ihre Listen (siehe src/domain/interest-group.ts). Deshalb stehen die
 * spezifischen Arten oben und die weiten unten: Ein Salsa-Abend soll unter
 * „Tanzen" landen und nicht unter „Musik", obwohl beides zutrifft.
 *
 * Vorher lag genau hier der Fehler: `musik` stand mit einem Muster, das auch
 * `salsa`, `tanz`, `party` und `dj` enthielt, an erster Stelle. Ergebnis waren
 * 143 Termine in einer einzigen Kategorie und ein Regal, in dem niemand etwas
 * findet.
 *
 * Ein Event darf hoechstens fuenf Kategorien tragen (Grenze der Schnittstelle);
 * die erste zaehlt fuer die Unterteilung, die weiteren fuer die Filter.
 */
const INTEREST_RULES = [
  // Zuerst die klar umrissenen Veranstaltungsarten.
  ['tanzen', /salsa|tango|swing|lindy|discofox|standardtanz|tanzkurs|tanzabend|tanzbar|tanzen|tanzt|ballett|milonga|bachata|kizomba/i],
  // `\bhouse\b` und nicht `house`: Sonst wird die „Noergelbuff Houseband" zur
  // Party, weil ihr Name das Wort enthaelt. Der Test dazu haelt das fest.
  ['party-club', /party|club night|clubnacht|disco|discothek|techno|\bhouse\b|rave|schlager|charts|karaoke|dj[\s-]?set|nachtschicht|feiern/i],
  ['konzerte', /konzert|live[\s-]?musik|livemusik|liveband|open air|unplugged|akustik|session|jam|houseband|hausband|chor|orgel|sinfonie|philharmon|recital|support:/i],
  ['comedy-kabarett', /comedy|kabarett|stand[\s-]?up|improtheater|impro|komische nacht|humor|satire/i],
  ['theater-buhne', /theater|b[üu]hne|schauspiel|oper|operette|musical|premiere|inszenierung|produktion|puppenspiel/i],
  ['lesung-literatur', /lesung|literatur|poetry|slam|vorlesen|autor|buchvorstellung|erz[äa]hl/i],
  ['film-kino', /kino|film|cinema|kurzfilm|dokumentarfilm|filmabend|vorf[üu]hrung/i],
  ['ausstellung-museum', /ausstellung|museum|vernissage|galerie|installation|exponat/i],
  // Publikum schlaegt Format: Eine „Mitmachgeschichte fuer Kinder" ist ein
  // Kinder-Termin und kein Workshop, auch wenn beides zutrifft. Deshalb stehen
  // diese beiden VOR Workshop und Vortrag.
  ['familie-kinder', /kinder|familie|f[üu]r die kleinen|kindertheater|bastel|krabbel/i],
  ['queer', /queer|lgbt|csd|pride|flinta|drag/i],

  ['markt-flohmarkt', /flohmarkt|wochenmarkt|troedel|tr[öo]del|basar|markttag|kunsthandwerkermarkt|weihnachtsmarkt/i],
  ['festival', /festival|open[\s-]?air[\s-]?festival|stadtfest|strassenfest|stra[ßs]enfest|kultursommer/i],
  ['workshop-kurs', /workshop|kurs|schnupperkurs|seminar|tutorial|mitmach|selbermachen|n[äa]hen|t[öo]pfern/i],
  ['vortrag-bildung', /vortrag|lecture|podiumsdiskussion|diskussion|infoabend|f[üu]hrung|bildung|ringvorlesung/i],
  ['essen-trinken', /kulinar|weinprobe|wein|bierprobe|brauerei|brunch|dinner|schmaus|tasting|kochkurs|streetfood/i],
  ['natur-wandern', /wander|spaziergang|exkursion|kr[äa]uter|garten|naturschutz|vogel|waldbaden/i],
  ['spieleabend', /spieleabend|brettspiel|pen.?and.?paper|rollenspiel|quiz|pubquiz|schach|bingo/i],
  ['studium-campus', /studium|campus|uni[\s-]|studenten|studierende|fachschaft|erstsemester|jura|mensa/i],

  // Danach die weiten Kategorien der Ursprungsliste. Sie greifen, wenn oben
  // nichts passte – und als Zweit-Kategorie fuer die Filter.
  ['musik', /musik|band|rock|pop|jazz|folk|blues|metal|punk|indie|klassik|hip.?hop|soul|funk|reggae|s[äa]nger/i],
  ['kunst-design', /kunst|design|malerei|skulptur|fotokunst|street.?art/i],
  ['soziales-community', /stammtisch|treffen|community|sozial|ehrenamt|nachbarschaft|repair|tausch/i],
  ['kochen', /kochen|backen|rezept/i],
  ['sport-radfahren', /lauf|rad|fahrrad|sport|turnier|fu[ßs]ball|volleyball/i],
  ['fitness', /fitness|yoga|training|workout|pilates/i],
  ['fotografie', /foto|fotografie/i],
];

/**
 * Die passenden Kategorie-Slugs zu den Angaben einer Quelle.
 *
 * Der erste Treffer steht vorn und wird damit die fuehrende Kategorie – die
 * Reihenfolge von INTEREST_RULES ist also Absicht und keine Formsache.
 */
export function interestSlugsFor(labels) {
  const haystack = (Array.isArray(labels) ? labels : [labels])
    .filter(Boolean)
    .map(String)
    .join(' ');

  const slugs = INTEREST_RULES.filter(([, pattern]) => pattern.test(haystack)).map(([slug]) => slug);
  return slugs.slice(0, 5);
}

/**
 * Stabiler Schluessel eines Events in der Quelle.
 *
 * Nicht der Titel, sondern Quelle + Fremd-ID: Titel wiederholen sich bei
 * Locations mit Reihen ("IT'S TUESDAY, BABY…" laeuft jede Woche), und ein
 * korrigierter Tippfehler im Titel wuerde sonst ein zweites Event anlegen.
 * Wo eine Quelle keine ID hat, setzen die Adapter Datum+Titel ein.
 */
export function externalKey(source, externalId) {
  return `${source}:${externalId}`;
}

/**
 * Fingerabdruck des Inhalts – entscheidet, ob ein bekanntes Event ein UPDATE braucht.
 *
 * Damit bleibt ein zweiter Import-Lauf ohne Aenderungen wirkungslos: kein
 * `updated_at`-Rauschen, keine Push-Nachricht an Follower fuer nichts.
 */
export function contentHash(fields) {
  const payload = [
    fields.title,
    fields.description,
    fields.location,
    fields.starts_at,
    // Das Bild gehoert dazu: Tauscht die Location das Plakat, soll der naechste
    // Lauf das Event aktualisieren und nicht "unveraendert" melden.
    fields.banner_path ?? '',
    // Die Kategorien ebenfalls – und zwar nicht wegen der Quelle, sondern wegen
    // UNSERER Regeln: Wird INTEREST_RULES geschaerft, sollen die schon
    // importierten Events beim naechsten Lauf umgehaengt werden. Ohne das melden
    // 143 Termine "unveraendert" und behalten still die alte Zuordnung, obwohl
    // der Code inzwischen etwas anderes sagt.
    (fields.interestSlugs ?? []).join(','),
  ].join(' ');
  // Kein crypto-Import fuer einen Vergleichswert: FNV-1a genuegt und haelt die
  // Datei frei von Node-Abhaengigkeiten, damit sie im Test pur bleibt.
  let hash = 0x811c9dc5;
  for (let i = 0; i < payload.length; i += 1) {
    hash ^= payload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * Setzt einen Roh-Event einer Quelle in die Form, die `activities` erwartet.
 *
 * Gibt `null` zurueck, wenn Pflichtangaben fehlen – ein Event ohne Titel oder
 * ohne Startzeit ist in der App nichts, was man anzeigen koennte, und der
 * Import soll daran nicht abbrechen, sondern es auslassen.
 *
 * `raw` erwartet: { externalId, title, description, location, startsAtWall |
 * startsAtUtc, labels[], url, imageUrl }
 */
export function normalizeEvent(raw, source) {
  const title = truncate(htmlToText(raw.title), LIMITS.title);
  const startsAt = raw.startsAtUtc ?? wallTimeToUtc(raw.startsAtWall, raw.timeZone);

  if (!title || !startsAt) return null;

  const location = truncate(htmlToText(raw.location) || source.defaultLocation, LIMITS.location);
  if (!location) return null;

  // Die Quell-URL haengt hinten an der Beschreibung: Wer das Event in der App
  // sieht, kommt damit zu Tickets und Details – und die Location bekommt den
  // Verweis, der das Uebernehmen ihrer Daten ueberhaupt fair macht.
  const body = htmlToText(raw.description);
  const credit = raw.url ? `\n\nMehr Infos & Tickets: ${raw.url}` : '';
  const description = truncate(
    body || `${title} – Veranstaltung im ${location}.`,
    LIMITS.description - credit.length,
  ) + credit;

  // Die Kategorien VOR dem Fingerabdruck: Sie gehen mit hinein, damit eine
  // geschaerfte Regel die schon importierten Events umhaengt (siehe contentHash).
  //
  // `defaultLabel` der Quelle ist NUR ein Rueckfall und geht nicht mit in die
  // erste Runde. Genau daran ist der erste Versuch gescheitert: Beim Noergelbuff
  // steht dort "Konzert Livemusik", und weil das an jedem Event mitgeprueft
  // wurde, landeten alle 143 Termine zusaetzlich in "Konzerte" und "Musik" – der
  // Salsa-Abend eingeschlossen. Der Rueckfall greift jetzt erst, wenn Rubriken
  // und Titel nichts hergeben.
  const own = interestSlugsFor([...(raw.labels ?? []), title]);
  const interestSlugs = own.length > 0 ? own : interestSlugsFor([source.defaultLabel]);

  const fields = {
    title,
    description,
    location,
    starts_at: startsAt,
    banner_path: bannerPathFor(raw.imageUrl),
    interestSlugs,
  };

  return {
    ...fields,
    externalKey: externalKey(source.slug, raw.externalId),
    externalId: String(raw.externalId),
    source: source.slug,
    sourceUrl: raw.url ?? null,
    contentHash: contentHash(fields),
  };
}

/**
 * Das Bild des Events als Wert fuer `activities.banner_path`.
 *
 * Verlinkt und NICHT heruntergeladen: Das Plakat gehoert meist der Band oder dem
 * Label, nicht der Location. Eine Adresse zu speichern heisst, beim Anzeigen auf
 * das Original zu verweisen – eine Kopie auf unserem Server waere eine
 * Vervielfaeltigung, und die braeuchte eine Erlaubnis, die wir nicht haben.
 *
 * `banner_path` traegt damit zwei Sorten Werte: relative Pfade fuer selbst
 * hochgeladene Banner, absolute Adressen fuer importierte. Dieselbe Doppelrolle
 * wie `users.avatar`; aufgeloest wird sie in `mediaUrl` (src/media.js).
 *
 * `null` bei zu langen Adressen: Die Spalte ist VARCHAR(255), und eine
 * abgeschnittene URL zeigt ins Nichts. Ohne Bild springt in der App das Zeichen
 * des Veranstalters ein (siehe src/components/host-banner.tsx) – das ist der
 * bessere Ausgang als ein kaputtes Bild.
 */
function bannerPathFor(imageUrl) {
  const url = String(imageUrl ?? '').trim();
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) return null;
  if (url.length > 255) return null;
  return url;
}
