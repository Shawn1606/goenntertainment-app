import { useRouter, type Href } from 'expo-router';

import { BackButton } from '@/components/ui/icon-button';

/**
 * Zurück-Knopf für Stack-Kopfzeilen, der auch OHNE Verlauf funktioniert.
 *
 * Öffnet man eine Stack-Route direkt – Neuladen im Browser, ein Link, ein
 * Neustart nach Absturz –, gibt es keinen Bildschirm darunter, und die Seite
 * läge als Sackgasse über der Tab-Leiste. Dieser Knopf geht dann zu `fallback`
 * statt zur Startseite – aus den Sicherheits-Screens z. B. in die Einstellungen.
 *
 * Gedacht als `headerLeft` – aber nur, wenn es KEINEN Verlauf gibt; sonst zeichnet
 * `AppHeader` seinen eigenen Zurück-Knopf (derselbe Kreis, siehe icon-button.tsx).
 */
export function useHeaderBackFallback(fallback: Href) {
  const router = useRouter();
  if (router.canGoBack()) return undefined;
  return function HeaderBack() {
    return <BackButton fallback={fallback} />;
  };
}
