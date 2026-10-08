import { router, type Href } from 'expo-router';

/**
 * Zurück – oder dorthin, wo es weitergeht, wenn es kein Zurück gibt.
 *
 * Über einen Link geöffnet (Aufkleber, Einladung) liegt unter dem Bildschirm
 * nichts, und `router.back()` täte schlicht nichts: „Fertig" oder „Nicht jetzt"
 * blieben ohne Wirkung.
 */
export function goBack(fallback: Href = '/'): void {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}
