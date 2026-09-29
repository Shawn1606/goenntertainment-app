/**
 * Symbol-Namen für die Oberfläche (reine Deklaration, keine Zeichnung).
 *
 * Warum es diese Schicht gibt: Vorher standen Emojis als Zeichenketten mitten
 * in der Logik – ein Emoji in den Abzeichen-Regeln, ein weiteres in der
 * Plattform-Liste. Das koppelt Regeln an Darstellung und hat drei handfeste
 * Nachteile:
 *
 *  1. **Screenreader.** Ein Emoji wird mit seinem Unicode-Namen vorgelesen
 *     („Party-Popper"), nicht mit dem, was es hier bedeutet. Dekoration wird so
 *     zu Lärm mitten im Satz.
 *  2. **Jedes System zeichnet anders.** Dasselbe Emoji ist auf iOS bunt und
 *     rundlich, auf Android flach, auf Windows wieder anders. Eine App, die
 *     einen eigenen Look haben will, gibt damit die Kontrolle ab.
 *  3. **Farbe lässt sich nicht steuern.** Ein Emoji ignoriert `color`. Damit
 *     ist es im Dunkelmodus, in Warnfarbe oder ausgegraut nicht anpassbar.
 *
 * Die Regeln nennen deshalb nur noch einen **Namen**; welche Linien dazu
 * gehören, entscheidet `src/components/ui/icon.tsx`. Gleiches Muster wie
 * {@link ../domain/category-icon.ts} für Kategorien – nur eben für die
 * Oberfläche selbst. Ein Test wacht darüber, dass jeder Name hier auch eine
 * Zeichnung hat.
 *
 * Emojis bleiben genau dort erlaubt, wo sie **Inhalt** sind und nicht Chrome:
 * in Texten, die Menschen selbst eingeben (Event-Titel, Beschreibungen, Namen).
 */

/**
 * Alle Symbole, die die Oberfläche kennt.
 *
 * Sortiert nach Verwendungszweck, damit man beim Ergänzen sieht, ob es schon
 * etwas Passendes gibt, statt ein zweites Zahnrad zu erfinden.
 */
export const UI_ICON_NAMES = [
  // Serie und Fortschritt
  'flame',
  'sprout',
  'hourglass',
  'medal',
  'trophy',
  'party',
  'rocket',
  'compass',
  'tent',
  'user-check',
  // Zeit und Ort
  'clock',
  'calendar',
  'map-pin',
  'sunrise',
  'sun',
  'sunset',
  'moon',
  // Navigation und Konto
  'id-card',
  'ticket',
  'gear',
  'chart',
  'users',
  'user',
  'incognito',
  'trend-up',
  // Inhalt und Aktion
  'plus',
  'edit',
  'trash',
  'camera',
  'paperclip',
  'search',
  'close',
  'check',
  'send',
  'share',
  'link',
  'mail',
  'eye',
  // Hinweise und Zustände
  'bell',
  'chat',
  'help',
  'flag',
  'document',
  'building',
  'shield',
  'key',
  'lock',
  'info',
  'warning',
  'ban',
  'robot',
  'folder',
  'tag',
  // Akzente (sparsam – sie stehen für „hier ist was besonders")
  'star',
  'star-filled',
  'sparkles',
  'bolt',
  'heart',
  'balloon',
  // Einstellungen
  'contrast',
  'vibrate',
  'speaker',
  // Navigation und Feed im Instagram-/TikTok-Stil
  'home',
  'map',
  'plus-square',
  'bookmark',
  'bookmark-filled',
  'grid',
  'menu',
  'heart-filled',
  'chevron-right',
  'chevron-left',
  'user-plus',
  'logout',
  'phone',
  'copy',
  'shield-check',
] as const;

export type UiIconName = (typeof UI_ICON_NAMES)[number];

/** Bekannter Name? Nützlich für Werte, die aus Speicher oder API kommen. */
export function isUiIconName(value: unknown): value is UiIconName {
  return typeof value === 'string' && (UI_ICON_NAMES as readonly string[]).includes(value);
}

/**
 * Rangzeichen für eine Platzierung in der Rangliste.
 *
 * Löst die drei Medaillen-Emojis ab. Die Farbe (Gold/Silber/Bronze) macht den Unterschied, nicht
 * drei verschiedene Zeichnungen: Ein Podest ist ein Podest, der Platz steckt in
 * der Farbe – und die drei Emojis sind bei kleiner Schriftgröße ohnehin nicht
 * auseinanderzuhalten.
 *
 * @returns `null` ab Platz 4 – dort steht die Zahl selbst, und die ist genauer.
 */
export function rankMedal(rank: number): { icon: UiIconName; tone: 'gold' | 'silver' | 'bronze' } | null {
  if (!Number.isFinite(rank)) return null;
  if (rank === 1) return { icon: 'medal', tone: 'gold' };
  if (rank === 2) return { icon: 'medal', tone: 'silver' };
  if (rank === 3) return { icon: 'medal', tone: 'bronze' };
  return null;
}
