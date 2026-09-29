/**
 * Hinweis „Dein Passwort ist schwach" – einmal nach der Anmeldung.
 *
 * Beim Anmelden kennt die App das Passwort im Klartext, und genau dann lässt sich
 * seine Stärke messen, ohne es je zu speichern. Anzeigen kann der Login-Bildschirm
 * den Hinweis aber nicht: Mit der Anmeldung wechselt die App sofort in die
 * angemeldeten Bildschirme, und das Login-Fenster ist weg. Also merkt er sich hier
 * nur das ERGEBNIS (schwach ja/nein, nie das Passwort), und die Startseite zeigt
 * den Hinweis einmal an.
 *
 * Bewusst nur im Speicher: Nach einem Neustart ist die Meldung vergessen – sie
 * soll anstupsen, nicht bei jedem Öffnen nerven.
 */
let weakPasswordPending = false;

export function flagWeakPassword(weak: boolean): void {
  weakPasswordPending = weak;
}

/** Liefert den Hinweis genau einmal und setzt ihn dabei zurück. */
export function takeWeakPasswordFlag(): boolean {
  const pending = weakPasswordPending;
  weakPasswordPending = false;
  return pending;
}
