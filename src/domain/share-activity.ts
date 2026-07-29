/**
 * Ein Event zum Teilen aufbereiten.
 *
 * ## Text, nicht Link
 *
 * Geteilt wird **Text**, kein Deep-Link in die App. Der Grund ist unangenehm
 * einfach: Ein Link, der die App öffnet, braucht entweder registrierte
 * App-Links (mit einer Datei auf der eigenen Domain und einem Store-Eintrag) oder
 * eine Website, die das Event anzeigt. Beides gibt es noch nicht. Ein Link, der
 * bei den meisten Empfängern ins Leere führt, ist schlechter als eine Nachricht,
 * die man lesen kann.
 *
 * Wenn es die Website gibt, kommt hier eine Zeile mit der Adresse dazu – und weil
 * dieser Text an genau einer Stelle gebaut wird, ist es genau eine Zeile.
 *
 * ## Warum das Kürzen hier steht
 *
 * WhatsApp und Telegram bekommen den Text als URL-Parameter. Eine Beschreibung
 * mit tausend Zeichen ist dort unlesbar und stößt auf manchen Systemen an die
 * Längengrenze von URLs. Gekürzt wird deshalb hier, wo der Text entsteht – und
 * nicht in jedem Ziel einzeln.
 */
import { formatDateTime } from './date-format.ts';

/** So viel Beschreibung kommt mit. Danach ein Auslassungszeichen. */
const MAX_DESCRIPTION = 220;

/** Die Felder, die zum Teilen gebraucht werden. */
export type ShareableActivity = {
  title: string;
  location: string | null;
  starts_at: string | null;
  description?: string | null;
};

/** Kürzt auf Wortgrenze, damit nicht mitten in einem Wort abgebrochen wird. */
function shorten(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  // Ohne Leerzeichen (ein sehr langes Wort) hart schneiden – sonst käme hier
  // wieder der ganze Text zurück.
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * Der Text, der in WhatsApp, im System-Teilen oder in der Zwischenablage landet.
 *
 * Aufbau: Titel, dann Zeitpunkt und Ort als eigene Zeilen, dann – wenn vorhanden –
 * die gekürzte Beschreibung, zum Schluss der Hinweis auf die App. Fehlende Felder
 * lassen ihre Zeile weg, statt „null" zu schreiben: Genau das ist der Fehler, den
 * eine zusammengesetzte Zeichenkette sonst zuverlässig macht.
 */
export function shareTextFor(activity: ShareableActivity): string {
  const when = formatDateTime(activity.starts_at);
  const description = (activity.description ?? '').trim();

  const lines = [
    activity.title,
    when ? `Wann: ${when}` : null,
    activity.location ? `Wo: ${activity.location}` : null,
    description ? '' : null,
    description ? shorten(description, MAX_DESCRIPTION) : null,
    '',
    'Gefunden in GÖ4Fun – dort kannst du zusagen.',
  ];

  return lines.filter((line) => line !== null).join('\n');
}

/** Betreff für Ziele, die einen brauchen (E-Mail über das System-Teilen). */
export function shareSubjectFor(activity: ShareableActivity): string {
  return activity.title;
}

/**
 * WhatsApp-Adresse mit vorbereitetem Text.
 *
 * `https://wa.me/` und nicht `whatsapp://send`: Das App-Schema schlägt fehl, wenn
 * WhatsApp nicht installiert ist – und `Linking.openURL` wirft dann einen Fehler,
 * den man der Nutzer:in erklären müsste. Die Web-Adresse öffnet die App, wenn sie
 * da ist, und sonst die Seite im Browser.
 */
export function whatsappUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/** Telegram-Adresse. Aus demselben Grund die Web-Variante wie bei WhatsApp. */
export function telegramUrl(text: string): string {
  return `https://t.me/share/url?url=${encodeURIComponent('')}&text=${encodeURIComponent(text)}`;
}
