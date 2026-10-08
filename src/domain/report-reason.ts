/**
 * Gründe für eine Meldung – Schlüssel und Beschriftung.
 *
 * Die **Schlüssel** gehören dem Server (`SafetyController::REASONS`), die **Texte**
 * dieser Datei. Warum die Trennung: Der Server muss nur wissen, welche Werte er
 * annimmt; die Formulierung wird umgeschrieben, gekürzt und irgendwann übersetzt,
 * und das soll ohne Änderung am Backend gehen. Ein Test der API hält beide Listen
 * gegeneinander (api/tests/Feature/ReportListsTest.php) – laufen sie auseinander,
 * schickt die App einen Grund, den der Server ablehnt.
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
 * Was sich melden lässt: genau die Schlüssel, die der Server annimmt
 * (`SafetyController::TARGETS`, gleicher Test wie oben). Die eine Liste der App: Das
 * Melde-Blatt, die API-Typen und der Admin-Bereich lesen sie hier.
 */
export const REPORT_TARGETS = ['message', 'user', 'group', 'partner', 'offer'] as const;

export type ReportTarget = (typeof REPORT_TARGETS)[number];

/** Symbol und Wort je Art des Gemeldeten – für die Admin-Liste. */
export const REPORT_TARGET_LABELS: Record<ReportTarget, { icon: UiIconName; label: string }> = {
  message: { icon: 'chat', label: 'Nachricht' },
  user: { icon: 'user', label: 'Konto' },
  group: { icon: 'users', label: 'Gruppe' },
  partner: { icon: 'building', label: 'Partner' },
  offer: { icon: 'ticket', label: 'Angebot' },
};

/** Symbol und Wort zu einem Schlüssel – auch zu einem, den diese App-Version noch nicht kennt. */
export function reportTargetLabel(key: string): { icon: UiIconName; label: string } {
  return (REPORT_TARGET_LABELS as Record<string, { icon: UiIconName; label: string }>)[key] ?? { icon: 'flag', label: key };
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
