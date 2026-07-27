/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { BrandSurfaces, Colors } from '@/constants/theme';
import { useResolvedScheme } from '@/lib/theme-preference';

export function useTheme() {
  // Aufgelöstes Schema: berücksichtigt die manuelle Dark-Mode-Einstellung aus
  // den App-Settings und fällt sonst auf das System-Schema zurück.
  const scheme = useResolvedScheme();

  return Colors[scheme];
}

/**
 * Marken-Oberflächen (Karten/Chips/Texte im Pastell-Look) passend zum
 * aufgelösten Schema. So dunkeln auch die Tab-Inhalte im Dark-Mode ab.
 */
export function useBrandSurface() {
  const scheme = useResolvedScheme();

  return BrandSurfaces[scheme];
}
