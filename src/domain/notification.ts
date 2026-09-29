/**
 * Benachrichtigungen: Symbol, Zähler und wohin ein Tipp führt.
 *
 * Reine Regeln, keine Darstellung – wie überall in `src/domain`. Die Liste
 * (`src/app/notifications.tsx`) fragt hier nach und zeichnet nur.
 *
 * ## Warum die Sorte nicht hart getypt genommen wird
 *
 * Ein neuerer Server darf eine Sorte mehr schicken, ohne dass die App bei einem
 * unbekannten Wert leer bleibt oder abstürzt. Jede Funktion hier hat deshalb
 * einen Rückfall – ein unbekannter Typ bekommt ein neutrales Symbol und kein
 * Ziel, statt die ganze Liste zu kippen.
 */

/** Die Sorten, die diese App kennt. Gegenstück: NOTIFICATION_TYPES im Server. */
export const NOTIFICATION_TYPES = [
  'story',
  'activity',
  'post',
  'like',
  'comment',
  'follow',
] as const;

export type KnownNotificationType = (typeof NOTIFICATION_TYPES)[number];

/** Was eine Benachrichtigung mindestens mitbringen muss. */
export type RoutableNotification = {
  type: string;
  ref_id: number | null;
  actor: { username: string | null } | null;
};

/**
 * Wohin ein Tipp führt.
 *
 * Drei Ziele, und die Zuordnung ist nicht beliebig:
 *
 * - **story** führt auf die STARTSEITE, nicht auf eine Story-Adresse. Es gibt
 *   keine – Storys leben in der Leiste oben, und nach 24 Stunden gibt es sie
 *   nicht mehr. Eine Adresse, die morgen ins Leere zeigt, wäre schlechter als
 *   der Ort, an dem die Storys tatsächlich stehen.
 * - **like/comment/post** führen auf das eigene bzw. fremde PROFIL, weil dort
 *   der Beitrag steht. Ohne Benutzernamen gibt es kein Ziel – dann bleibt der
 *   Eintrag eine Meldung ohne Sprung, und das ist ehrlicher als ein toter Tipp.
 * - **follow** führt auf das Profil der Person, die gefolgt ist.
 *
 * `null` heißt: nicht antippbar. Die Liste zeigt den Eintrag dann als Text.
 */
export function notificationTarget(
  notification: RoutableNotification,
  me: { username: string | null } | null,
):
  | { kind: 'home' }
  | { kind: 'activity'; id: number }
  | { kind: 'profile'; username: string }
  | null {
  const actor = notification.actor?.username ?? null;

  switch (notification.type) {
    case 'story':
      return { kind: 'home' };

    case 'activity':
      return notification.ref_id ? { kind: 'activity', id: notification.ref_id } : null;

    case 'post':
    case 'follow':
      return actor ? { kind: 'profile', username: actor } : null;

    // Jemand hat MEINEN Beitrag geliked oder kommentiert – das Ziel ist also
    // mein eigenes Profil, nicht das der auslösenden Person.
    case 'like':
    case 'comment':
      return me?.username ? { kind: 'profile', username: me.username } : null;

    default:
      return null;
  }
}

/**
 * Das Symbol zur Sorte.
 *
 * Namen aus `src/domain/ui-icon.ts`. Unbekannte Sorten bekommen die Glocke –
 * neutral und trotzdem eindeutig als Benachrichtigung lesbar.
 */
export function notificationIcon(type: string): string {
  switch (type) {
    case 'story':
      return 'sparkles';
    case 'activity':
      return 'ticket';
    case 'post':
      return 'document';
    case 'like':
      return 'heart';
    case 'comment':
      return 'chat';
    case 'follow':
      return 'user-check';
    default:
      return 'bell';
  }
}

// Der Zähler an der Glocke ist derselbe wie der an einem Chat – er liegt
// deshalb in `src/domain/unread-badge.ts` und nicht hier.
