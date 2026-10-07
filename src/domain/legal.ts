/**
 * Die Rechtstexte der App – als Daten, nicht als Layout.
 *
 * ## Warum das eine Datenstruktur ist und kein Screen
 *
 * Fünf Dokumente mit je einer Handvoll Abschnitte. Stünden sie als JSX in einem
 * Screen, wäre jede Änderung am Text eine Änderung an der Anzeige, und niemand
 * könnte prüfen, ob ein Abschnitt leer ist oder ein Querverweis ins Nichts zeigt.
 * Als Daten prüft das ein Test (siehe `legal.test.ts`), und der Screen ist eine
 * Schleife über Überschriften und Absätze.
 *
 * ## Warum in der App und nicht nur auf der Website
 *
 * Die Store-Prüfungen wollen Nutzungsbedingungen und Datenschutz **erreichbar aus
 * der App** sehen, und ein Link nach draußen hilft niemandem, der im Funkloch
 * wissen will, wer für ein Event verantwortlich ist. Die externen Adressen in
 * `src/constants/links.ts` bleiben als Zweitweg bestehen.
 *
 * ## WICHTIG: Diese Texte sind eine sorgfältige Vorlage, keine Rechtsberatung
 *
 * Sie sind auf genau diese App zugeschnitten – eine Plattform, die Treffen
 * vermittelt, sie aber nicht veranstaltet. Vor der Veröffentlichung sollten sie
 * einmal anwaltlich gelesen werden, und die Betreiberdaten in
 * `src/constants/operator.ts` müssen ausgefüllt sein (dort stehen noch
 * Platzhalter). Was hier steht, ersetzt das nicht.
 *
 * ## Der Kern, um den es dem Betreiber geht
 *
 * Das Dokument `liability`: Die Plattform ist **nicht Veranstalterin**. Wer ein
 * Event einträgt, veranstaltet es; wer hingeht, entscheidet das selbst. Das steht
 * deshalb als eigenes Dokument da und nicht als Absatz 11 der Bedingungen – in
 * Absatz 11 liest es niemand.
 */
import { APP_NAME, MIN_AGE, OPERATOR, operatorAddressLines } from '../constants/operator.ts';
import { SUPPORT_EMAIL } from '../constants/links.ts';
import { Features } from '../constants/features.ts';

/**
 * Wer die KI-Prüfung für uns rechnet. Steht als Konstante, weil Datenschutz und
 * Bedingungen ihn nennen – und weil ein Wechsel des Anbieters dann genau eine
 * Zeile ist. VOR DER VERÖFFENTLICHUNG PRÜFEN: Vertragsgrundlage (AV-Vertrag,
 * Standardvertragsklauseln bzw. DPF-Zertifizierung) mit dem aktuellen Stand beim
 * Anbieter abgleichen.
 */
const AI_PROCESSOR = 'Anthropic PBC, 548 Market Street, San Francisco, CA 94104, USA';

/**
 * Stand der Nutzungsbedingungen.
 *
 * Ein **Datum** und keine laufende Nummer: Man kann es lesen, ohne eine Tabelle
 * zu kennen, und es steht so auch unter dem Text. Beim Ändern eines inhaltlich
 * relevanten Punktes wird es hochgesetzt – dann gilt die frühere Zustimmung nicht
 * mehr (siehe {@link acceptanceIsCurrent}) und die App fragt erneut.
 *
 * Reine Tippfehler-Korrekturen ändern das Datum NICHT: Sonst müssten alle
 * Nutzer:innen wegen eines Kommas erneut zustimmen, und dann klickt es niemand
 * mehr bewusst weg.
 *
 * Named mirror of `terms_version` in shared/legal.json, the version the server accepts at
 * sign-up (F-14); legal.test.ts fails when the two differ, so change both together.
 */
export const LEGAL_VERSION = '2026-09-29';

/**
 * What a sign-up confirms, in the form the server checks and stores (F-14): the current terms
 * version and the minimum age. The server refuses a registration without both, or with other
 * values (api/app/Support/Legal.php reads shared/legal.json).
 */
export function registrationConsent(): { terms_version: string; confirmed_min_age: number } {
  return { terms_version: LEGAL_VERSION, confirmed_min_age: MIN_AGE };
}

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

/**
 * Nummeriert Abschnitte fortlaufend („1. …", „2. …").
 *
 * Die Nummer steht nicht fest im Text, weil Abschnitte je nach eingeschalteten
 * Funktionen fehlen können (Kontostufen, Prämien – siehe constants/features.ts).
 * Mit festen Nummern stünde dann 3 direkt vor 5, und jeder Verweis „siehe Punkt 7"
 * zeigte daneben.
 */
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
      heading: '1. Wer diese App anbietet und für wen sie gilt',
      paragraphs: [
        `${APP_NAME} wird angeboten von ${ADDRESS}. Diese Bedingungen gelten für die Nutzung der App und aller darin enthaltenen Funktionen.`,
        'Mit der Registrierung stimmst du diesen Bedingungen zu. Nutzt du die App ohne Konto, gelten sie für den Teil, den du ohne Konto nutzen kannst.',
      ],
    },
    {
      heading: '2. Was diese App ist – und was sie nicht ist',
      paragraphs: [
        `${APP_NAME} ist eine Vermittlungsplattform: Nutzer:innen tragen eigene Treffen und Veranstaltungen ein, andere finden sie und sagen zu. Wir stellen dafür die technische Möglichkeit bereit.`,
        `Wir sind weder Veranstalter noch Vermittler eines Vertrags zwischen dir und anderen Nutzer:innen. Wir organisieren keine Events, prüfen sie nicht auf Richtigkeit und sind bei einem Treffen nicht anwesend. Was das für die Haftung bedeutet, steht ausführlich unter „Haftung und Events".`,
        'Wir sind keine Ticketplattform. Verlangt jemand für ein Event Geld, entsteht die Zahlungsvereinbarung ausschließlich zwischen dir und dieser Person.',
      ],
    },
    {
      heading: '3. Dein Konto',
      paragraphs: [
        `Für ein Konto musst du mindestens ${MIN_AGE} Jahre alt sein. Deine Angaben müssen zutreffen; ein Konto im Namen einer anderen Person ist nicht erlaubt.`,
        'Du bist für die Sicherheit deiner Zugangsdaten verantwortlich. Wir empfehlen dir die Zwei-Faktor-Anmeldung (Einstellungen → Sicherheit). Wenn du den Verdacht hast, dass jemand anderes Zugriff hat, ändere dein Passwort und schreib uns.',
        'Namen und Benutzernamen, die beleidigend, rassistisch oder anstößig sind, lassen wir nicht zu. Die App prüft sie bei der Eingabe automatisch; was trotzdem durchrutscht, benennen wir um oder sperren es.',
        'Pro Person ein Konto. Mehrere Konten, um eine Sperre zu umgehen, sind ein Verstoß gegen diese Bedingungen.',
      ],
    },
    ...(Features.accountTiers ? [{
      heading: '4. Höhere Kontostufen',
      paragraphs: [
        'Manche Funktionen – Events erstellen, ein öffentliches Profil, der Business-Bereich – hängen an einer Kontostufe. Diese Stufen werden auf Anfrage freigeschaltet; ein Anspruch auf Freischaltung besteht nicht.',
        'Wir können eine Stufe zurücknehmen, wenn die Voraussetzungen entfallen oder gegen diese Bedingungen verstoßen wird.',
      ],
    }] : []),
    {
      heading: '5. Deine Inhalte',
      paragraphs: [
        'Alles, was du einträgst – Events, Beiträge, Storys, Chat-Nachrichten, Bilder, Profilangaben – bleibt inhaltlich deine Sache und deine Verantwortung. Du versicherst, dass du die nötigen Rechte daran hast, insbesondere an Bildern und an Aufnahmen anderer Personen.',
        `Du räumst uns das Recht ein, deine Inhalte in der App anzuzeigen, technisch zu verarbeiten und zu speichern, soweit das für den Betrieb nötig ist. Weiter geht dieses Recht nicht: Wir verkaufen deine Inhalte nicht und nutzen sie nicht für Werbung außerhalb von ${APP_NAME}.`,
        'Verboten sind Inhalte, die gegen Gesetze verstoßen oder gegen unsere Regeln (siehe „Regeln für das Miteinander"). Texte werden beim Absenden mit einer Liste von Beleidigungen und Hassbegriffen abgeglichen; Bilder und Texte in Events, Beiträgen und Storys prüft vor dem Veröffentlichen zusätzlich eine KI auf nicht jugendfreie Inhalte. Einzelheiten dazu stehen im Datenschutz-Text.',
      ],
    },
    {
      heading: '6. Chats in Gruppen und bei Events',
      paragraphs: [
        'In einer Gruppe und bei einem Event, bei dem du dabei bist, kannst du mit den anderen schreiben. In eine Gruppe kommt nur, wer eine Freundschaftsanfrage bestätigt hat – niemand kann dich ungefragt in eine Runde ziehen.',
        'Wer eine Gruppe angelegt hat oder ein Event veranstaltet, kann dort auch fremde Nachrichten entfernen. Das ist keine Zensur, sondern die Verantwortung für den eigenen Raum.',
        'Chats sind nicht Ende-zu-Ende-verschlüsselt. Nachrichten liegen auf unserem Server, damit sie auf deinen Geräten ankommen. Schreib dort nichts, was streng vertraulich ist.',
      ],
    },
    {
      heading: '7. Melden, Blockieren, Sperren',
      paragraphs: [
        'Du kannst Events, Nachrichten, Beiträge, Storys und Konten melden. Eine Meldung ist ein Hinweis an uns; sie entfernt nichts automatisch. Wenn du sofort Ruhe willst, blockiere das Konto – das wirkt unmittelbar.',
        'Wir können Inhalte entfernen und Konten befristet oder dauerhaft sperren, wenn gegen diese Bedingungen oder gegen Gesetze verstoßen wird. Bei schweren Verstößen geschieht das ohne Vorwarnung.',
        'Über das Ergebnis einer Meldung informieren wir die meldende Person nicht. Das schützt beide Seiten.',
        `Gegen eine Sperre oder die Entfernung eines Inhalts kannst du widersprechen – über „Widerspruch einlegen" in der Sperrmeldung oder per Mail an ${SUPPORT_EMAIL}. Ein Mensch aus unserem Team sieht sich die Entscheidung dann erneut an, auch wenn sie automatisch getroffen wurde, und teilt dir das Ergebnis mit.`,
      ],
    },
    {
      heading: '8. Verfügbarkeit',
      paragraphs: [
        'Wir geben uns Mühe, dass die App läuft, schulden dir aber keine bestimmte Verfügbarkeit. Wartung, Störungen und Weiterentwicklung können dazu führen, dass Funktionen zeitweise oder dauerhaft nicht zur Verfügung stehen.',
        'Wir können Funktionen ändern oder einstellen. Bei Änderungen, die dich erheblich betreffen, informieren wir dich in der App.',
      ],
    },
    ...(Features.rewards ? [{
      heading: '9. Punkte und Prämien',
      paragraphs: [
        'Punkte, die du in der App sammelst, sind kein Geld und kein Guthaben. Sie sind nicht übertragbar, nicht auszahlbar und verfallen, wenn dein Konto endet.',
        'Eingelöste Coupons werden bei den jeweiligen Partnern vorgezeigt. Ob und wie ein Partner den Coupon annimmt, liegt bei diesem Partner.',
      ],
    }] : []),
    {
      heading: '10. Konto beenden',
      paragraphs: [
        'Du kannst dein Konto jederzeit selbst löschen: in den Einstellungen unter „Konto beenden", bestätigt mit deinem Passwort. Die Löschung geschieht sofort und lässt sich nicht rückgängig machen.',
        'Mit der Löschung verschwinden deine Inhalte. Nachrichten in Gruppen-Chats können bei den anderen Teilnehmenden sichtbar bleiben, wenn sie zum Verlauf eines Gesprächs gehören. Rechtlich vorgeschriebene Aufbewahrung bleibt unberührt.',
      ],
    },
    {
      heading: '11. Änderungen dieser Bedingungen',
      paragraphs: [
        'Wir können diese Bedingungen ändern, etwa wenn Funktionen dazukommen oder sich die Rechtslage ändert. Bei inhaltlich relevanten Änderungen fragen wir in der App erneut nach deiner Zustimmung.',
        `Der aktuelle Stand ist unten am Text vermerkt (Stand ${LEGAL_VERSION}). Stimmst du einer Änderung nicht zu, kannst du dein Konto beenden.`,
      ],
    },
    {
      heading: '12. Recht und Gerichtsstand',
      paragraphs: [
        'Es gilt deutsches Recht. Bist du Verbraucher:in, bleiben die Schutzvorschriften deines Aufenthaltsstaats unberührt.',
        'Sollte eine Bestimmung dieser Bedingungen unwirksam sein, bleiben die übrigen wirksam.',
      ],
    },
  ]),
};

const liability: LegalDocument = {
  id: 'liability',
  title: 'Haftung und Events',
  summary: 'Wer für ein Event verantwortlich ist – und wer nicht.',
  related: ['terms', 'conduct'],
  sections: [
    {
      heading: 'Wir sind nicht die Veranstalter',
      paragraphs: [
        `Jedes Event in ${APP_NAME} wird von einer Nutzer:in eingetragen. Diese Person ist die Veranstalterin bzw. der Veranstalter – nicht wir. Wir stellen nur die Plattform, auf der man sich findet.`,
        'Das heißt konkret: Wir planen nichts, wir sind nicht dabei, wir prüfen weder den Ort noch die Angaben noch die Menschen, die hingehen. Wir schulden dir kein Event und keine bestimmte Qualität eines Events.',
        'Wenn ein Event ausfällt, anders ist als beschrieben, später beginnt oder gar nicht stattfindet, ist das eine Sache zwischen dir und der veranstaltenden Person.',
      ],
    },
    {
      heading: 'Die Teilnahme erfolgt auf eigene Verantwortung',
      paragraphs: [
        'Du entscheidest selbst, ob du zu einem Treffen gehst, mit wem du dich verabredest und was du dort tust. Diese Entscheidung liegt bei dir – mit allem, was daran hängt.',
        'Für Schäden, Verletzungen, Verluste, Diebstahl, Streitigkeiten oder sonstige Folgen, die bei oder im Zusammenhang mit einem Event entstehen, haften wir nicht – soweit das Gesetz das zulässt; die Grenzen stehen unten unter „Woran wir uns nicht vorbeischreiben". Das gilt auch für das Verhalten anderer Teilnehmenden, für den Zustand von Orten und Ausstattung und für alles, was auf dem Weg zu einem Treffen oder von dort weg passiert.',
        'Prüfe selbst, ob du für eine Tätigkeit versichert, gesundheitlich in der Lage und – wo nötig – berechtigt bist. Bei Sport, Wasser, Höhe, Feuer, Fahrzeugen oder Alkohol gilt das besonders.',
      ],
    },
    {
      heading: 'Wenn du ein Event einträgst',
      paragraphs: [
        'Trägst du ein Event ein, bist du dafür verantwortlich: für richtige Angaben zu Ort, Zeit und Ablauf, für die nötigen Erlaubnisse und Genehmigungen, für den Jugendschutz und für die Sicherheit vor Ort.',
        'Sag klar, was du planst, und weise auf Risiken hin. Gib Altersgrenzen an, wenn ein Event nichts für Jugendliche ist. Sag ab und trag es aus, wenn es nicht stattfindet – das ist der Mindestrespekt gegenüber Leuten, die sich den Abend freigehalten haben.',
        'Du stellst uns von Ansprüchen frei, die Dritte gegen uns richten, weil du diese Pflichten verletzt hast.',
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
        'Texte, Bilder und Nachrichten in dieser App kommen von den Nutzer:innen. Wir machen sie uns nicht zu eigen und prüfen sie nicht vorab auf Richtigkeit.',
        'Sobald wir von einem rechtswidrigen Inhalt Kenntnis erlangen, entfernen wir ihn. Dafür gibt es in der App überall den Weg „Melden" – bitte nutze ihn, das ist der schnellste Weg zu uns.',
      ],
    },
    {
      heading: 'Im Notfall',
      paragraphs: [
        'Wenn du dich unwohl fühlst, geh. Du musst niemandem eine Erklärung schuldig bleiben und keine Absage begründen.',
        'Bei einer akuten Notlage ruf den Notruf: 112 (Rettungsdienst und Feuerwehr) oder 110 (Polizei). Wir sind kein Notdienst und können in einer solchen Lage nicht helfen.',
        `Danach: Melde die Person oder das Event in der App und schreib uns an ${SUPPORT_EMAIL}. Wir sehen uns das an.`,
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
      paragraphs: [
        'Verhalte dich so, wie du es von jemandem erwarten würdest, mit dem du dich zum ersten Mal treffen willst.',
      ],
    },
    {
      heading: 'Das geht nicht',
      paragraphs: [
        'Beleidigungen, Drohungen, Einschüchterung, ständiges Anschreiben nach einem „Nein".',
        'Hass gegen Menschen wegen Herkunft, Religion, Geschlecht, sexueller Orientierung, Behinderung oder Alter.',
        'Nicht jugendfreie Inhalte, Gewaltdarstellungen, Aufrufe zu Gewalt.',
        'Betrug, Geldforderungen unter Vorwänden, das Abwerben auf fremde Seiten, Kettenbriefe und Werbung ohne Bezug zum Event.',
        'Fotos und Aufnahmen anderer Personen ohne deren Einverständnis.',
        'Erfundene Events, Fake-Profile, das Auftreten im Namen einer anderen Person.',
      ],
    },
    {
      heading: 'Das hilft allen',
      paragraphs: [
        'Sag ab, wenn du nicht kommst. Ein leerer Treffpunkt ist der Grund, warum Leute solche Apps wieder löschen.',
        'Schreib in Events und Chats so viel, dass man hingehen kann: Wo genau, wie erkennt man euch, was soll man mitbringen.',
        'Nimm Neue mit hinein. Die meisten Leute hier kennen niemanden – das ist der ganze Punkt.',
      ],
    },
    {
      heading: 'Was passiert bei einem Verstoß',
      paragraphs: [
        'Wir entfernen Inhalte und sperren Konten – befristet oder dauerhaft, je nachdem, was passiert ist. Bei Straftaten wenden wir uns an die Behörden.',
        'Jede Sperre wird mit Grund festgehalten. Hältst du eine Sperre für falsch, tipp in der Sperrmeldung auf „Widerspruch einlegen" oder schreib uns – ein Mensch sieht sich das erneut an.',
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
      paragraphs: [
        `Verantwortlich für die Verarbeitung deiner Daten ist ${ADDRESS}. Kontakt: ${SUPPORT_EMAIL}, Telefon ${OPERATOR.phone}.`,
      ],
    },
    {
      heading: 'Was wir speichern',
      paragraphs: [
        'Konto: Name, Benutzername, E-Mail-Adresse, dein Passwort als nicht umkehrbare Prüfsumme (nie im Klartext), gewählte Interessen und – falls du eins hochlädst – Profil- und Hintergrundbild.',
        'Zwei-Faktor-Anmeldung, wenn du sie einschaltest: das verschlüsselt gespeicherte Geheimnis deiner Authenticator-App bzw. kurzlebige Einmal-Codes für die E-Mail-Variante (höchstens 10 Minuten gültig) und die Prüfsummen deiner Wiederherstellungscodes. Codes per E-Mail verschicken wir über unseren Mail-Dienstleister.',
        'Inhalte: Events, Beiträge, Storys, Chat-Nachrichten und Bilder, die du einträgst, samt Zeitpunkt.',
        'Nutzung: welche Events du erstellt hast oder besuchst, welche du dir gemerkt hast, wen du als Freund:in bestätigt hast, in welchen Gruppen du bist, gesammelte Punkte und aktive Tage.',
        'Standort: nur, wenn du es einschaltest, und nur zur Anzeige von Entfernungen und Events in deiner Nähe. Wir speichern keine Bewegungsprofile.',
        'Bei Sperren: der Grund und – falls vorhanden – ein Beweisbild, als Nachweis über die Sperre hinaus.',
      ],
    },
    {
      heading: 'Wozu und auf welcher Grundlage',
      paragraphs: [
        'Zur Erfüllung unseres Vertrags mit dir (Art. 6 Abs. 1 lit. b DSGVO): alles, was die App zum Funktionieren braucht.',
        'Zur Wahrung berechtigter Interessen (Art. 6 Abs. 1 lit. f DSGVO): Missbrauch verhindern, Jugendschutz durchsetzen, Störungen finden.',
        'Auf deine Einwilligung (Art. 6 Abs. 1 lit. a DSGVO): Standortnutzung und – sobald es sie gibt – Push-Nachrichten. Die Einwilligung kannst du in den Einstellungen jederzeit zurücknehmen.',
      ],
    },
    {
      heading: 'Automatisierte Prüfung von Inhalten',
      paragraphs: [
        'Namen, Benutzernamen und Texte gleichen wir beim Absenden mit einer Liste von Beleidigungen, rassistischen Begriffen und Nazi-Codes ab. Das geschieht auf unserem eigenen Server; dabei verlässt nichts das System.',
        `Bilder und Texte in Events, Beiträgen und Storys prüft vor dem Veröffentlichen zusätzlich eine KI darauf, ob sie nicht jugendfrei sind. Dazu werden Text und Bild an unseren Auftragsverarbeiter ${AI_PROCESSOR} (KI-Modell „Claude") übermittelt. Weil der Anbieter in den USA sitzt, stützt sich die Übermittlung auf die Standardvertragsklauseln der EU-Kommission (Art. 46 Abs. 2 lit. c DSGVO). Nach den Vertragsbedingungen des Anbieters werden die Inhalte nicht zum Training seiner Modelle verwendet.`,
        'Das Ergebnis wird protokolliert – auch bei unauffälligen Prüfungen, damit jede automatische Sperre nachvollziehbar bleibt.',
        `Eine automatische Sperre ist eine Entscheidung, die ohne einen Menschen zustande kommt (Art. 22 DSGVO). Du hast das Recht, dass ein Mensch sie überprüft, deinen Standpunkt darzulegen und die Entscheidung anzufechten – über „Widerspruch einlegen" in der Sperrmeldung oder per Mail an ${SUPPORT_EMAIL}.`,
      ],
    },
    {
      heading: 'Wer die Daten sieht',
      paragraphs: [
        'Andere Nutzer:innen sehen, was du selbst sichtbar machst: dein Profil, deine Events, deine Beiträge und Storys, deine Nachrichten in Gruppen und Event-Chats.',
        'Technische Dienstleister (Server, Speicher, E-Mail-Versand, KI-Prüfung) verarbeiten Daten in unserem Auftrag und sind vertraglich daran gebunden. Wir verkaufen keine Daten.',
      ],
    },
    {
      heading: 'Wie lange',
      paragraphs: [
        'Kontodaten, solange dein Konto besteht. Löschst du dein Konto, entfernen wir es samt deinen Bildern sofort. Storys laufen nach 24 Stunden ab. Einträge im Verlauf verschwinden sieben Tage, nachdem ein Event gelöscht wurde oder du ausgetreten bist.',
        'Nachweise zu Sperren bewahren wir länger auf – sie sind der Grund, aus dem eine Sperre überprüfbar bleibt.',
      ],
    },
    {
      heading: 'Deine Rechte',
      paragraphs: [
        'Du hast das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung, Datenübertragbarkeit und Widerspruch. Schreib uns dafür an ' +
          SUPPORT_EMAIL +
          ' – wir antworten innerhalb der gesetzlichen Frist.',
        'Du kannst dich außerdem bei einer Datenschutz-Aufsichtsbehörde beschweren, zuständig ist die Behörde deines Wohnorts.',
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
    {
      heading: 'Anbieter',
      paragraphs: operatorAddressLines(),
    },
    {
      heading: 'Kontakt',
      paragraphs: [
        `E-Mail: ${OPERATOR.email}`,
        `Telefon: ${OPERATOR.phone}`,
      ],
    },
    {
      heading: 'Verantwortlich für den Inhalt',
      paragraphs: [
        `${OPERATOR.responsible} (§ 18 Abs. 2 MStV), Anschrift wie oben.`,
      ],
    },
    {
      heading: 'Weitere Angaben',
      paragraphs: [
        OPERATOR.vatId
          ? `Umsatzsteuer-Identifikationsnummer: ${OPERATOR.vatId}`
          : 'Eine Umsatzsteuer-Identifikationsnummer liegt nicht vor.',
        OPERATOR.register
          ? `Registereintrag: ${OPERATOR.register}`
          : 'Ein Registereintrag besteht nicht.',
      ],
    },
    {
      heading: 'Streitbeilegung',
      paragraphs: [
        'Zur Teilnahme an einem Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle sind wir nicht verpflichtet und nicht bereit.',
      ],
    },
    {
      heading: 'Hinweis zu Inhalten der Nutzer:innen',
      paragraphs: [
        `Events, Beiträge, Storys und Nachrichten in ${APP_NAME} stammen von den Nutzer:innen und geben nicht unsere Auffassung wieder. Für sie gilt „Haftung und Events".`,
      ],
    },
  ],
};

/** Alle Dokumente in der Reihenfolge von {@link LEGAL_DOC_IDS}. */
export const LEGAL_DOCUMENTS: readonly LegalDocument[] = [
  terms,
  liability,
  conduct,
  privacy,
  imprint,
];

/** Ein Dokument über seine Kennung – oder `null` bei einer unbekannten. */
export function legalDocument(id: string | null | undefined): LegalDocument | null {
  if (!id) return null;
  return LEGAL_DOCUMENTS.find((doc) => doc.id === id) ?? null;
}

/**
 * Gilt eine gespeicherte Zustimmung noch?
 *
 * `null` (Bestandskonto von vor der Zustimmung) und ein älterer Stand gelten
 * beide als „nicht zugestimmt". Bewusst ein reiner Vergleich auf Gleichheit und
 * kein Datums-Vergleich: Ein Konto, in dem irgendwie ein späteres Datum steht als
 * das dieser App-Version, hat nicht dem zugestimmt, was hier steht.
 */
export function acceptanceIsCurrent(version: string | null | undefined): boolean {
  return version === LEGAL_VERSION;
}
