/**
 * Was eine Meldung festhält (`snapshot`, Laravel SafetyController::snapshot) – und wie der
 * Admin-Bereich es zeigt.
 *
 * Ohne den Schnappschuss stand in einer Meldung nur die ID: Wer gemeldet wurde, konnte den
 * Inhalt gleich danach löschen oder umbenennen, und im Admin-Bereich stand „Inhalt nicht mehr
 * vorhanden". Er hält Text und Namen fest, Personen mit ID und Benutzername – nie eine
 * E-Mail-Adresse. Ältere Meldungen haben keinen (`null`).
 */
import { formatDateTimeCompact } from './date-format.ts';

/** Wer etwas geschrieben hat oder wem etwas gehört. */
export type ReportPerson = { id: number; username: string | null; name: string };

/** Je nach Art des Gemeldeten sind andere Felder gesetzt. */
export type ReportSnapshot = {
  /** Nachricht: Text, geteiltes Angebot, Verfasser:in, Gruppe, Zeitpunkt. */
  text?: string | null;
  shared_title?: string | null;
  author?: ReportPerson | null;
  group?: { id: number; name: string };
  created_at?: string | null;
  /** Konto */
  user?: ReportPerson | null;
  /** Gruppe (Name, Beschreibung, Besitzer:in) und Partner (Name) */
  name?: string;
  description?: string | null;
  owner?: ReportPerson | null;
  /** Angebot */
  title?: string;
  partner_name?: string | null;
};

/** „Lena (@lena_k)" – oder ein Hinweis, wenn das Konto inzwischen gelöscht ist. */
export function personLabel(person: ReportPerson | null | undefined): string {
  if (!person) return 'gelöschtes Konto';
  return person.username ? `${person.name} (@${person.username})` : person.name;
}

/**
 * Der Schnappschuss als Zitat (das Gemeldete selbst) und Zeilen darunter (wer, wo, wann).
 * `null`, wenn es keinen gibt.
 */
export function describeSnapshot(type: string, snapshot: ReportSnapshot | null): { quote: string; details: string[] } | null {
  if (!snapshot) return null;
  switch (type) {
    case 'message': {
      const text = snapshot.text?.trim() || (snapshot.shared_title ? `Geteiltes Angebot: ${snapshot.shared_title}` : '(ohne Text)');
      const details = [`von ${personLabel(snapshot.author)}`];
      if (snapshot.group) details.push(`in der Gruppe „${snapshot.group.name}"`);
      if (snapshot.created_at) details.push(`geschrieben ${formatDateTimeCompact(snapshot.created_at)}`);
      return { quote: text, details };
    }
    case 'user':
      return { quote: personLabel(snapshot.user), details: [] };
    case 'group': {
      const details: string[] = [];
      if (snapshot.description) details.push(`Beschreibung: „${snapshot.description}"`);
      details.push(`angelegt von ${personLabel(snapshot.owner)}`);
      return { quote: snapshot.name ?? '(ohne Namen)', details };
    }
    case 'partner':
      return { quote: snapshot.name ?? '(ohne Namen)', details: [] };
    case 'offer':
      return { quote: snapshot.title ?? '(ohne Titel)', details: snapshot.partner_name ? [`bei ${snapshot.partner_name}`] : [] };
    default:
      return null;
  }
}
