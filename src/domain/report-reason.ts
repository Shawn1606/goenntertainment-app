/**
 * Gründe für eine Meldung – Schlüssel und Beschriftung.
 *
 * Die **Schlüssel** gehören dem Server (`SafetyController::REASONS`), die **Texte**
 * dieser Datei. Warum die Trennung: Der Server muss nur wissen, welche Werte er
 * annimmt; die Formulierung wird umgeschrieben, gekürzt und irgendwann übersetzt,
 * und das soll ohne Änderung am Backend gehen. Ein Test im Server hält beide
 * Listen gegeneinander – laufen sie auseinander, schickt die App einen Grund, den
 * der Server ablehnt.
 *
 * Die Reihenfolge ist die der Anzeige und bewusst nicht alphabetisch: Oben steht,
 * was am häufigsten gemeldet wird, unten der Sammelgrund. `other` steht ganz zum
 * Schluss, weil eine Liste, die mit „Sonstiges" anfängt, alle anderen Gründe
 * unsichtbar macht.
 */
import type { UiIconName } from './ui-icon.ts';

export type ReportReason = {
  /** Wert, der an den Server geht. */
  key: string;
  /** Was in der Liste steht. */
  label: string;
  /** Ein Satz, der die Abgrenzung klarmacht. */
  hint: string;
  icon: UiIconName;
};

export const REPORT_REASONS: readonly ReportReason[] = [
  {
    key: 'harassment',
    label: 'Beleidigung oder Belästigung',
    hint: 'Beschimpfungen, Drohungen, ständiges Anschreiben',
    icon: 'warning',
  },
  {
    key: 'sexual',
    label: 'Sexueller Inhalt',
    hint: 'Nicht jugendfreie Bilder oder Nachrichten',
    icon: 'ban',
  },
  {
    key: 'violence',
    label: 'Gewalt',
    hint: 'Gewaltdarstellung oder Aufruf zu Gewalt',
    icon: 'ban',
  },
  {
    key: 'hate',
    label: 'Hass gegen Gruppen',
    hint: 'Herkunft, Religion, Geschlecht, Behinderung',
    icon: 'ban',
  },
  {
    key: 'scam',
    label: 'Betrug',
    hint: 'Will Geld, Daten oder lockt woandershin',
    icon: 'incognito',
  },
  {
    key: 'spam',
    label: 'Spam oder Werbung',
    hint: 'Immer dasselbe, unerwünscht',
    icon: 'mail',
  },
  {
    key: 'danger',
    label: 'Jemand ist in Gefahr',
    hint: 'Selbstverletzung, Notlage – wir sehen sofort hin',
    icon: 'shield',
  },
  {
    key: 'other',
    label: 'Etwas anderes',
    hint: 'Schreib kurz, worum es geht',
    icon: 'flag',
  },
] as const;

/**
 * What can be reported: the keys the server accepts (`REPORT_TARGETS` in server/src/reports.js,
 * a named mirror that server/test/reports.test.js keeps equal to this list). Comments under a
 * post and under an event are content too and can be reported like everything else (F-08).
 * The one list in the app: the report sheet, the API types and the admin screen read it here.
 */
export const REPORT_TARGETS = [
  'activity',
  'message',
  'user',
  'post',
  'story',
  'post_comment',
  'activity_comment',
] as const;

export type ReportTarget = (typeof REPORT_TARGETS)[number];

/** Icon and word per kind of reported thing, for the admin list. */
export const REPORT_TARGET_LABELS: Record<ReportTarget, { icon: UiIconName; label: string }> = {
  activity: { icon: 'ticket', label: 'Event' },
  message: { icon: 'chat', label: 'Nachricht' },
  user: { icon: 'user', label: 'Konto' },
  post: { icon: 'edit', label: 'Beitrag' },
  story: { icon: 'camera', label: 'Story' },
  post_comment: { icon: 'chat', label: 'Kommentar' },
  activity_comment: { icon: 'chat', label: 'Event-Kommentar' },
};

/** Whether a reported thing is a comment (the admin can remove it from the report). */
export function isCommentTarget(target: string): target is 'post_comment' | 'activity_comment' {
  return target === 'post_comment' || target === 'activity_comment';
}

/** Beschriftung zu einem Schlüssel – für die Admin-Liste und Bestätigungen. */
export function reportReasonLabel(key: string): string {
  return REPORT_REASONS.find((reason) => reason.key === key)?.label ?? key;
}

/**
 * Bei diesem Grund darf die Meldung nicht in einer Liste versauern.
 *
 * Es gibt nur einen, und er steht hier statt in der Anzeige, damit auch ein
 * späterer zweiter Weg (E-Mail, Push an die Moderation) dieselbe Regel benutzt.
 */
export function isUrgent(key: string): boolean {
  return key === 'danger';
}
