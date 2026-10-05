/**
 * Die Rechtstexte der App – als Daten, nicht als Layout.
 *
 * ## Warum das eine Datenstruktur ist und kein Screen
 *
 * Fünf Dokumente mit je einer Handvoll Abschnitte. Als Daten prüft ein Test
 * (siehe `legal.test.ts`), dass kein Abschnitt leer ist und kein Querverweis ins
 * Nichts zeigt; der Screen ist eine Schleife über Überschriften und Absätze.
 *
 * ## Warum in der App und nicht nur auf der Website
 *
 * Die Store-Prüfungen wollen Nutzungsbedingungen und Datenschutz **erreichbar aus
 * der App** sehen. Die externen Adressen in `src/constants/links.ts` bleiben als
 * Zweitweg bestehen.
 *
 * ## WICHTIG: Diese Texte sind eine sorgfältige Vorlage, keine Rechtsberatung
 *
 * Seit dem Marktplatz-Umbau verkauft die App Buchungen bei Partnern, Credits,
 * Gutscheine und ein Club-Abo. Daran hängen Verbraucherrecht (Widerruf,
 * Button-Lösung, Kündigungsbutton), Zahlungsrecht (Credits als Zahlungsmittel bei
 * mehreren Partnern) und Steuerfragen. Vor dem Start MÜSSEN die Texte anwaltlich
 * geprüft werden, und die Betreiberdaten in `src/constants/operator.ts` müssen
 * ausgefüllt sein. Was hier steht, ersetzt das nicht.
 *
 * ## Der Kern
 *
 * Das Dokument `liability`: Die Aktivität selbst führt der **Partner** durch. Wir
 * vermitteln die Buchung, kassieren für den Partner und gewähren Rabatte – den
 * Sprung, die Runde Escape Room, das Getränk schuldet der Partner.
 */
import { APP_NAME, MIN_AGE, OPERATOR, operatorAddressLines } from '../constants/operator.ts';
import { SUPPORT_EMAIL } from '../constants/links.ts';

/**
 * Stand der Nutzungsbedingungen.
 *
 * Ein **Datum** und keine laufende Nummer: Man kann es lesen, ohne eine Tabelle
 * zu kennen. Beim Ändern eines inhaltlich relevanten Punktes wird es hochgesetzt –
 * dann gilt die frühere Zustimmung nicht mehr (siehe {@link acceptanceIsCurrent})
 * und die App fragt erneut. Reine Tippfehler-Korrekturen ändern es NICHT.
 */
export const LEGAL_VERSION = '2026-10-05';

/** Reihenfolge der Dokumente – so stehen sie auch in den Einstellungen. */
export const LEGAL_DOC_IDS = ['terms', 'liability', 'conduct', 'privacy', 'imprint'] as const;

export type LegalDocId = (typeof LEGAL_DOC_IDS)[number];

export type LegalSection = {
  heading: string;
  paragraphs: string[];
};

export type LegalDocument = {
  id: LegalDocId;
  /** Was in der Kopfzeile und in den Einstellungen steht. */
  title: string;
  /** Ein Satz darunter – damit man vor dem Öffnen weiß, worum es geht. */
  summary: string;
  sections: LegalSection[];
  /** Weiterführende Dokumente; ein Test prüft, dass sie existieren. */
  related?: LegalDocId[];
};

const ADDRESS = operatorAddressLines().join(', ');

/** Nummeriert Abschnitte fortlaufend („1. …", „2. …"). */
function numbered(sections: LegalSection[]): LegalSection[] {
  return sections.map((section, index) => ({
    ...section,
    heading: `${index + 1}. ${section.heading.replace(/^\d+\.\s*/, '')}`,
  }));
}

const terms: LegalDocument = {
  id: 'terms',
  title: 'Nutzungsbedingungen',
  summary: `Die Regeln für die Nutzung von ${APP_NAME}.`,
  related: ['liability', 'conduct', 'privacy'],
  sections: numbered([
    {
      heading: 'Wer diese App anbietet und für wen sie gilt',
      paragraphs: [
        `${APP_NAME} wird angeboten von ${ADDRESS}. Diese Bedingungen gelten für die Nutzung der App und aller darin enthaltenen Funktionen.`,
        'Mit der Registrierung stimmst du diesen Bedingungen zu.',
      ],
    },
    {
      heading: 'Was diese App ist',
      paragraphs: [
        `${APP_NAME} vermittelt Freizeitangebote ausgewählter Partner – etwa Sprung-Sessions, Escape Rooms oder Vorteile vor Ort. Die Partner haben mit uns einen Vertrag; wer Partner ist, entscheiden wir.`,
        'Buchst du ein Angebot, schließt du den Vertrag über die Leistung mit dem Partner. Wir vermitteln ihn, nehmen die Zahlung für den Partner entgegen und gewähren die Rabatte aus Club und Gruppe. Die Leistung selbst erbringt der Partner (siehe „Haftung und Partner").',
      ],
    },
    {
      heading: 'Dein Konto',
      paragraphs: [
        `Für ein Konto musst du mindestens ${MIN_AGE} Jahre alt sein. Deine Angaben müssen zutreffen; ein Konto im Namen einer anderen Person ist nicht erlaubt.`,
        'Du bist für die Sicherheit deiner Zugangsdaten verantwortlich. Wir empfehlen die Zwei-Faktor-Anmeldung (Einstellungen → Sicherheit).',
        'Namen und Benutzernamen, die beleidigend, rassistisch oder anstößig sind, lassen wir nicht zu. Pro Person ein Konto.',
      ],
    },
    {
      heading: 'Buchungen',
      paragraphs: [
        'Vor dem Buchen siehst du den Endpreis inklusive aller Rabatte. Mit „Zahlungspflichtig buchen" gibst du ein verbindliches Angebot ab; die Buchung kommt zustande, sobald sie in der App bestätigt ist.',
        'Eine Buchung ist bis zum angezeigten Datum einlösbar. Eingelöst wird beim Partner – per NFC-Aufkleber, QR-Code oder indem der Partner deinen Pass scannt. Nicht eingelöste Buchungen verfallen nach Ablauf; ob und wie der Betrag erstattet wird, richtet sich nach den Bedingungen des Partners und dem Gesetz.',
        'Solange eine Buchung nicht eingelöst ist, kannst du sie in der App stornieren. Mit Credits bezahlte Buchungen schreiben wir dir sofort gut, mit Geld bezahlte erstatten wir auf dem ursprünglichen Zahlweg.',
        'Freizeitangebote zu einem bestimmten Termin sind nach § 312g Abs. 2 Nr. 9 BGB vom Widerrufsrecht ausgenommen. Unsere Stornomöglichkeit geht darüber hinaus und gilt freiwillig.',
      ],
    },
    {
      heading: 'Credits',
      paragraphs: [
        `Credits sind ein Guthaben in ${APP_NAME}, mit dem du bei unseren Partnern bezahlen kannst. Du bekommst sie durch Kauf (10 Credits = 0,75 €), über Gutscheinkarten, als Monatsleistung im Club und für eine volle Stempelkarte.`,
        'Credits lassen sich nur bei Partnern von GÖ4Fun einsetzen. Sie werden nicht in Geld ausgezahlt und sind nicht auf andere Konten übertragbar – gesetzliche Ansprüche bleiben unberührt.',
        'Gekaufte Credits kannst du innerhalb von 14 Tagen nach dem Kauf widerrufen, solange du sie nicht eingesetzt hast. Danach ist der Kauf endgültig.',
      ],
    },
    {
      heading: 'Gutscheinkarten',
      paragraphs: [
        'GÖ4Fun-Gutscheinkarten gibt es bei unseren Handelspartnern. Den Code auf der Karte löst du in der App ein; die Credits stehen sofort auf deinem Konto. Jeder Code gilt einmal.',
        'Ist eine Karte beschädigt oder der Code unleserlich, wende dich mit dem Kassenbon an uns.',
      ],
    },
    {
      heading: 'Club: Free, Gold und Platinum',
      paragraphs: [
        'Der Free Plan ist kostenlos. Gold und Platinum sind Abos mit einem Monatspreis, Rabatten auf Partner-Angebote und monatlichen Credits. Was jede Stufe genau enthält, steht in der App unter „Club".',
        'Ein Abo läuft einen Monat und verlängert sich automatisch um einen weiteren Monat, wenn du es nicht kündigst. Kündigen kannst du jederzeit in der App unter „Club → Abo kündigen"; das Abo endet dann zum Ende der laufenden Laufzeit.',
        'Beim Abschluss hast du ein Widerrufsrecht von 14 Tagen. Nutzt du in dieser Zeit Club-Vorteile, schuldest du bei einem Widerruf einen anteiligen Betrag; bereits gutgeschriebene Monats-Credits werden zurückgebucht.',
        'Ein Wechsel zwischen Gold und Platinum beginnt sofort eine neue Laufzeit.',
      ],
    },
    {
      heading: 'Stempelkarte',
      paragraphs: [
        'Bei jedem Besuch eines Partners kannst du einen Stempel sammeln – höchstens einen pro Partner und Tag. Für zehn Stempel schreiben wir dir 100 Credits gut.',
        'Stempel gibt es nur für echte Besuche. Wer Aufkleber-Codes weitergibt, Stempel ohne Besuch sammelt oder das System anders austrickst, verliert Stempel und daraus entstandene Credits; das Konto kann gesperrt werden.',
      ],
    },
    {
      heading: 'Gruppen und Chats',
      paragraphs: [
        'Du kannst Gruppen anlegen und andere per Einladungscode dazuholen. Beitreten kann nur, wer den Code bekommt – niemand landet ungefragt in einer Gruppe.',
        'Wer eine Gruppe angelegt hat, kann dort auch fremde Nachrichten entfernen. Chats sind nicht Ende-zu-Ende-verschlüsselt; schreib dort nichts streng Vertrauliches.',
      ],
    },
    {
      heading: 'Melden, Blockieren, Sperren',
      paragraphs: [
        'Du kannst Nachrichten, Konten, Gruppen, Partner und Angebote melden. Eine Meldung entfernt nichts automatisch. Wenn du sofort Ruhe willst, blockiere das Konto.',
        `Wir können Inhalte entfernen und Konten befristet oder dauerhaft sperren, wenn gegen diese Bedingungen oder Gesetze verstoßen wird. Gegen eine Sperre kannst du per Mail an ${SUPPORT_EMAIL} widersprechen; ein Mensch aus unserem Team sieht sie sich erneut an.`,
      ],
    },
    {
      heading: 'Verfügbarkeit',
      paragraphs: [
        'Wir geben uns Mühe, dass die App läuft, schulden aber keine bestimmte Verfügbarkeit. Partner und Angebote können sich ändern oder wegfallen; bereits gebuchte Leistungen bleiben davon unberührt.',
      ],
    },
    {
      heading: 'Konto beenden',
      paragraphs: [
        'Du kannst dein Konto jederzeit in den Einstellungen löschen. Ein laufendes Abo endet damit sofort. Nicht eingesetzte Credits verfallen mit der Löschung, soweit das Gesetz nichts anderes vorschreibt – setz sie vorher ein oder schreib uns.',
        'Buchungsdaten bewahren wir auf, solange Steuer- und Handelsrecht das verlangen.',
      ],
    },
    {
      heading: 'Änderungen dieser Bedingungen',
      paragraphs: [
        `Bei inhaltlich relevanten Änderungen fragen wir in der App erneut nach deiner Zustimmung. Der aktuelle Stand ist unten vermerkt (Stand ${LEGAL_VERSION}).`,
      ],
    },
    {
      heading: 'Recht und Gerichtsstand',
      paragraphs: [
        'Es gilt deutsches Recht. Bist du Verbraucher:in, bleiben die Schutzvorschriften deines Aufenthaltsstaats unberührt. Sollte eine Bestimmung unwirksam sein, bleiben die übrigen wirksam.',
      ],
    },
  ]),
};

const liability: LegalDocument = {
  id: 'liability',
  title: 'Haftung und Partner',
  summary: 'Wer wofür verantwortlich ist.',
  related: ['terms', 'conduct'],
  sections: [
    {
      heading: 'Die Leistung erbringt der Partner',
      paragraphs: [
        `Jedes Angebot in ${APP_NAME} kommt von einem Partner. Der Partner führt die Aktivität durch und ist für Ablauf, Sicherheit vor Ort, Ausstattung, Personal und die Einhaltung seiner Regeln verantwortlich.`,
        'Wir wählen unsere Partner sorgfältig aus und vermitteln die Buchung. Fällt eine Leistung aus oder ist sie mangelhaft, hilf uns, das zu klären: Schreib uns – wir vermitteln zwischen dir und dem Partner und kümmern uns um die Erstattung, wo sie dir zusteht.',
      ],
    },
    {
      heading: 'Die Teilnahme erfolgt auf eigene Verantwortung',
      paragraphs: [
        'Achte auf die Hinweise des Partners – Altersgrenzen, Gesundheit, Kleidung, Regeln vor Ort. Prüfe selbst, ob eine Aktivität für dich und deine Gruppe geeignet ist; bei Kindern entscheiden die Begleitpersonen.',
        'Für Schäden, die bei der Aktivität entstehen, haftet in erster Linie der Partner nach den gesetzlichen Regeln. Wir haften für unsere eigenen Pflichten als Vermittler (siehe unten).',
      ],
    },
    {
      heading: 'Woran wir uns nicht vorbeischreiben',
      paragraphs: [
        'Unsere Haftung ist nicht ausgeschlossen bei Vorsatz und grober Fahrlässigkeit, bei der Verletzung von Leben, Körper oder Gesundheit, bei arglistig verschwiegenen Mängeln und in allen Fällen, in denen das Gesetz eine Haftung zwingend vorschreibt.',
        'Bei leicht fahrlässiger Verletzung einer wesentlichen Pflicht ist unsere Haftung auf den vorhersehbaren, typischen Schaden begrenzt.',
      ],
    },
    {
      heading: 'Inhalte anderer Nutzer:innen',
      paragraphs: [
        'Nachrichten in Gruppen kommen von den Nutzer:innen. Wir machen sie uns nicht zu eigen. Sobald wir von einem rechtswidrigen Inhalt erfahren, entfernen wir ihn – dafür gibt es überall „Melden".',
      ],
    },
    {
      heading: 'Im Notfall',
      paragraphs: [
        'Bei einer akuten Notlage ruf den Notruf: 112 (Rettungsdienst und Feuerwehr) oder 110 (Polizei). Wende dich vor Ort an das Personal des Partners.',
        `Danach: Schreib uns an ${SUPPORT_EMAIL}. Wir sehen uns das an und sprechen mit dem Partner.`,
      ],
    },
  ],
};

const conduct: LegalDocument = {
  id: 'conduct',
  title: 'Regeln für das Miteinander',
  summary: 'Was hier geht und was nicht – in klaren Worten.',
  related: ['terms', 'liability'],
  sections: [
    {
      heading: 'Der eine Satz, um den es geht',
      paragraphs: ['Verhalte dich in Gruppen und beim Partner so, wie du es dir von anderen wünschst.'],
    },
    {
      heading: 'Das geht nicht',
      paragraphs: [
        'Beleidigungen, Drohungen, Einschüchterung, ständiges Anschreiben nach einem „Nein".',
        'Hass gegen Menschen wegen Herkunft, Religion, Geschlecht, sexueller Orientierung, Behinderung oder Alter.',
        'Nicht jugendfreie Inhalte, Gewaltdarstellungen, Aufrufe zu Gewalt.',
        'Betrug, Weitergabe von Aufkleber-Codes, Stempel ohne Besuch, Weiterverkauf von Buchungen.',
        'Unfreundlichkeit gegenüber dem Personal unserer Partner.',
      ],
    },
    {
      heading: 'Was passiert bei einem Verstoß',
      paragraphs: [
        'Wir entfernen Inhalte, ziehen unberechtigt erlangte Stempel und Credits ab und sperren Konten – befristet oder dauerhaft, je nachdem, was passiert ist. Bei Straftaten wenden wir uns an die Behörden.',
      ],
    },
  ],
};

const privacy: LegalDocument = {
  id: 'privacy',
  title: 'Datenschutz',
  summary: 'Was wir speichern, warum – und was du dagegen tun kannst.',
  related: ['terms', 'imprint'],
  sections: [
    {
      heading: 'Verantwortlich',
      paragraphs: [`Verantwortlich für die Verarbeitung deiner Daten ist ${ADDRESS}. Kontakt: ${SUPPORT_EMAIL}, Telefon ${OPERATOR.phone}.`],
    },
    {
      heading: 'Was wir speichern',
      paragraphs: [
        'Konto: Name, Benutzername, E-Mail-Adresse, dein Passwort als nicht umkehrbare Prüfsumme, gewählte Interessen, Club-Stufe.',
        'Buchungen und Zahlungen: was du wann bei welchem Partner gebucht hast, Preis, Rabatt, Zahlart, Einlösung. Zahlungsdaten (Karte, Konto) verarbeitet unser Zahlungsdienstleister; wir sehen nur, ob und was bezahlt wurde.',
        'Credits und Stempel: jede Gut- und Lastschrift mit Grund, eingelöste Gutscheincodes, besuchte Partner mit Datum.',
        'Gruppen: Mitgliedschaften und Chat-Nachrichten.',
        'Standort: nur, wenn du es erlaubst – für Entfernungen und die Karte und beim Check-in am Aufkleber, um zu prüfen, dass du beim Partner bist. Wir speichern keine Bewegungsprofile; beim Check-in wird der Standort nur geprüft, nicht gespeichert.',
        'Zwei-Faktor-Anmeldung, wenn du sie einschaltest: das verschlüsselte Geheimnis bzw. kurzlebige Einmal-Codes.',
      ],
    },
    {
      heading: 'Was Partner sehen',
      paragraphs: [
        'Scannt ein Partner deinen Pass oder löst du eine Buchung ein, sieht der Partner deinen Vornamen, die Buchung (Angebot, Personenzahl, Code) und ob du gestempelt hast. Deine E-Mail-Adresse, deinen Credit-Stand und deine anderen Buchungen sieht er nicht.',
      ],
    },
    {
      heading: 'Wozu und auf welcher Grundlage',
      paragraphs: [
        'Zur Erfüllung des Vertrags mit dir (Art. 6 Abs. 1 lit. b DSGVO): Konto, Buchungen, Credits, Club, Stempel, Gruppen.',
        'Zur Erfüllung gesetzlicher Pflichten (Art. 6 Abs. 1 lit. c DSGVO): Aufbewahrung von Buchungs- und Zahlungsbelegen.',
        'Zur Wahrung berechtigter Interessen (Art. 6 Abs. 1 lit. f DSGVO): Missbrauch verhindern (etwa Stempel ohne Besuch), Störungen finden.',
        'Auf deine Einwilligung (Art. 6 Abs. 1 lit. a DSGVO): Standort und Push-Nachrichten. Du kannst sie jederzeit in den Einstellungen zurücknehmen.',
      ],
    },
    {
      heading: 'Automatische Prüfung von Texten',
      paragraphs: [
        'Namen, Gruppennamen und Chat-Nachrichten gleichen wir beim Absenden mit einer Liste von Beleidigungen, rassistischen Begriffen und Nazi-Codes ab. Das geschieht auf unserem eigenen Server.',
      ],
    },
    {
      heading: 'Wer die Daten sieht',
      paragraphs: [
        'Andere Mitglieder deiner Gruppen sehen deinen Namen, deine Nachrichten und dass du für die Gruppe gebucht hast.',
        'Technische Dienstleister (Server, E-Mail-Versand, Zahlungsabwicklung) verarbeiten Daten in unserem Auftrag und sind vertraglich daran gebunden. Wir verkaufen keine Daten.',
      ],
    },
    {
      heading: 'Wie lange',
      paragraphs: [
        'Kontodaten, solange dein Konto besteht. Buchungs- und Zahlungsbelege bewahren wir so lange auf, wie Handels- und Steuerrecht es verlangen (bis zu zehn Jahre) – nach einer Kontolöschung ohne Verbindung zu deinem Konto.',
      ],
    },
    {
      heading: 'Deine Rechte',
      paragraphs: [
        `Du hast das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung, Datenübertragbarkeit und Widerspruch. Schreib uns dafür an ${SUPPORT_EMAIL}.`,
        'Du kannst dich außerdem bei einer Datenschutz-Aufsichtsbehörde beschweren.',
      ],
    },
  ],
};

const imprint: LegalDocument = {
  id: 'imprint',
  title: 'Impressum',
  summary: `Angaben nach § 5 DDG zu ${APP_NAME}.`,
  related: ['privacy', 'terms'],
  sections: [
    { heading: 'Anbieter', paragraphs: operatorAddressLines() },
    { heading: 'Kontakt', paragraphs: [`E-Mail: ${OPERATOR.email}`, `Telefon: ${OPERATOR.phone}`] },
    { heading: 'Verantwortlich für den Inhalt', paragraphs: [`${OPERATOR.responsible} (§ 18 Abs. 2 MStV), Anschrift wie oben.`] },
    {
      heading: 'Weitere Angaben',
      paragraphs: [
        OPERATOR.vatId ? `Umsatzsteuer-Identifikationsnummer: ${OPERATOR.vatId}` : 'Eine Umsatzsteuer-Identifikationsnummer liegt nicht vor.',
        OPERATOR.register ? `Registereintrag: ${OPERATOR.register}` : 'Ein Registereintrag besteht nicht.',
      ],
    },
    {
      heading: 'Streitbeilegung',
      paragraphs: ['Zur Teilnahme an einem Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle sind wir nicht verpflichtet und nicht bereit.'],
    },
  ],
};

/** Alle Dokumente in der Reihenfolge von {@link LEGAL_DOC_IDS}. */
export const LEGAL_DOCUMENTS: readonly LegalDocument[] = [terms, liability, conduct, privacy, imprint];

/** Ein Dokument über seine Kennung – oder `null` bei einer unbekannten. */
export function legalDocument(id: string | null | undefined): LegalDocument | null {
  if (!id) return null;
  return LEGAL_DOCUMENTS.find((doc) => doc.id === id) ?? null;
}

/**
 * Gilt eine gespeicherte Zustimmung noch? `null` und ein älterer Stand gelten
 * beide als „nicht zugestimmt".
 */
export function acceptanceIsCurrent(version: string | null | undefined): boolean {
  return version === LEGAL_VERSION;
}
