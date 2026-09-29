import { useRouter, type Href } from 'expo-router';
import { Pressable } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { useTheme } from '@/hooks/use-theme';

/**
 * Zurück-Knopf für Stack-Kopfzeilen, der auch OHNE Verlauf funktioniert.
 *
 * Der eingebaute Zurück-Pfeil erscheint nur, wenn es einen Bildschirm darunter
 * gibt. Öffnet man eine Stack-Route direkt – Neuladen im Browser, ein Link, ein
 * Neustart nach Absturz –, fehlt er, und die Seite liegt als Sackgasse über der
 * Tab-Leiste. Dieser Knopf geht zurück, wenn es geht, und sonst zu `fallback`.
 *
 * Gedacht als `headerLeft` – aber nur, wenn es KEINEN Verlauf gibt; sonst bleibt
 * der eingebaute Pfeil mit seiner Wisch-Geste auf iOS.
 */
export function useHeaderBackFallback(fallback: Href) {
  const router = useRouter();
  const colors = useTheme();
  if (router.canGoBack()) return undefined;
  return () => (
    <Pressable
      onPress={() => router.replace(fallback)}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel="Zurück"
      style={({ pressed }) => [{ paddingRight: 8 }, pressed && { opacity: 0.6 }]}>
      <Icon name="chevron-left" size={26} color={colors.text} />
    </Pressable>
  );
}
