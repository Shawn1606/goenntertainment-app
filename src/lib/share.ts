/**
 * Teilen nach draußen: der System-Dialog (Einladungs-Links, Gutschein-Codes,
 * Wiederherstellungs-Codes). Den Text bauen die Aufrufer; hier passiert nur die
 * **Wirkung** (Dialog öffnen, im Web teilen oder kopieren).
 *
 * ## Warum es kein „Kopieren" gibt
 *
 * Zum Kopieren in die Zwischenablage bräuchte es `expo-clipboard` – ein
 * zusätzliches Paket für etwas, das der System-Dialog auf iOS und Android schon
 * anbietet („Kopieren" steht dort in der Liste). Im Web übernimmt es
 * `navigator.clipboard`, sobald `navigator.share` fehlt. Ein Paket für einen
 * Knopf, den es zweimal gibt, wäre schlechter Tausch.
 */
import { Platform, Share } from 'react-native';

import { notifyUser } from '@/lib/confirm';

/** Was beim Teilen herauskam – der Aufrufer entscheidet, ob er es anzeigt. */
export type ShareOutcome = 'shared' | 'dismissed' | 'copied' | 'failed';

/**
 * Der System-Dialog („Teilen über …").
 *
 * Im Web gibt es `Share` aus React Native nicht. Dort läuft es über die
 * Web-Share-API, und wo die fehlt (Desktop-Firefox etwa), landet der Text in der
 * Zwischenablage. Die dritte Stufe ist eine Meldung mit dem Text darin – nicht
 * schön, aber besser als ein Knopf, der nichts tut.
 */
export async function shareText(text: string, title: string): Promise<ShareOutcome> {
  if (Platform.OS === 'web') {
    return shareOnWeb(text, title);
  }

  try {
    const result = await Share.share(
      // `title` sieht man nur bei Zielen, die einen Betreff kennen (E-Mail).
      // `message` ist überall der Inhalt – deshalb steht der Titel auch im Text.
      { message: text, title },
      { subject: title, dialogTitle: title },
    );
    return result.action === Share.dismissedAction ? 'dismissed' : 'shared';
  } catch {
    return 'failed';
  }
}

async function shareOnWeb(text: string, title: string): Promise<ShareOutcome> {
  const nav = typeof navigator === 'undefined' ? null : navigator;

  if (nav && typeof nav.share === 'function') {
    try {
      await nav.share({ title, text });
      return 'shared';
    } catch {
      // Abbruch durch die Nutzer:in kommt hier ebenfalls als Fehler an. Weiter
      // zur Zwischenablage zu gehen wäre falsch – das wäre eine Handlung, die
      // niemand ausgelöst hat.
      return 'dismissed';
    }
  }

  if (nav?.clipboard && typeof nav.clipboard.writeText === 'function') {
    try {
      await nav.clipboard.writeText(text);
      return 'copied';
    } catch {
      /* Weiter zur letzten Stufe. */
    }
  }

  await notifyUser('Zum Kopieren', text);
  return 'copied';
}

