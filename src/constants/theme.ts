/**
 * Farben, Schriften und Abstände der App – hell und dunkel.
 */

import '@/global.css';

import { Platform } from 'react-native';

/**
 * Grundfarben im Stil von Instagram und TikTok.
 *
 * Instagram gibt die Flächen vor: reines Weiß bzw. reines Schwarz, flache Karten
 * mit einer Haarlinie (#dbdbdb / #262626) statt Glas und Schatten, Grautöne für
 * alles Nebensächliche. TikTok gibt den Akzent: ein kräftiges Pink (#fe2c55) für
 * das, was man antippen soll. Der Markenverlauf (Pink → Magenta → Lila) ist der
 * von Instagram-Story-Ringen – er steht nur dort, wo etwas hervorgehoben wird.
 *
 * ## Warum die Schlüssel noch „indigo" heißen
 *
 * Vorher lief die App im cira.systems-Look mit Indigo als Akzent. Die Namen
 * stecken in über hundert Dateien; sie umzubenennen wäre ein riesiger Diff ohne
 * jede sichtbare Wirkung. Also bleibt der Name, und nur der WERT wechselt:
 * „indigo" heißt hier „der Akzent", „violet"/„fuchsia" sind die zwei weiteren
 * Stufen des Verlaufs. Wer neu schreibt, nimmt ohnehin `Colors[scheme].tint`.
 *
 * Kontrast (WCAG): Akzent-Text hell #e8174a auf Weiß 4,5:1, dunkel #ff3b64 auf
 * Schwarz 6,1:1. Das hellere #fe2c55 steht nur als Fläche oder Verlauf.
 */
export const Palette = {
  /** Leinwand: fast weiß statt fast schwarz. */
  canvas: '#ffffff',
  canvasAlt: '#fafafa',
  /** Feines 1px-Raster im Hintergrund – wie bei der Referenz, nur invertiert. */
  grid: 'rgba(0,0,0,0)',
  ink: '#0a0a0a',
  inkMuted: '#737373',
  inkSubtle: '#a8a8a8',
  /** Konturen ersetzen Schatten – das prägt den sachlichen Eindruck. */
  ring: '#dbdbdb',
  ringStrong: '#c7c7c7',
  /** Akzent: Indigo. Auf hellem Grund die kräftigere Stufe für Kontrast. */
  indigo: '#fe2c55',
  indigoStrong: '#e8174a',
  indigoSoft: 'rgba(254,44,85,0.10)',
  /**
   * Zweite Stufe desselben Blaus. Nötig, sobald ein blaues Element auf einer
   * blauen Fläche liegt (Symbol-Kachel in einer Akzent-Karte, gedrückte Zeile):
   * mit nur einer Stufe verschwindet das eine im anderen.
   */
  indigoSofter: 'rgba(254,44,85,0.18)',
  /** Kontur zur sanften Akzentfläche – hält Kachel und Platzhalter in einer Familie. */
  indigoLine: 'rgba(254,44,85,0.30)',
  violet: '#dd2a7b',
  fuchsia: '#8134af',
  cyan: '#25f4ee',
  /**
   * Signalfarben. Bewusst NUR für Zustände, nie als Dekoration – die Palette
   * kennt genau einen Akzent, und der ist Indigo. Wo Bernstein auftaucht, läuft
   * gerade etwas ab (Serie in Gefahr, letzte Plätze); wo Grün auftaucht, ist
   * etwas geschafft. Ein zweiter „nur schöner" Farbton würde diesen Unterschied
   * sofort entwerten.
   */
  amber: '#f59e0b',
  amberStrong: '#d97706',
  amberSoft: 'rgba(245,158,11,0.14)',
  amberLine: 'rgba(245,158,11,0.34)',
  emerald: '#10b981',
  emeraldSoft: 'rgba(16,185,129,0.14)',
  // Dunkelmodus: nahe an den Originalwerten der Referenz.
  canvasDark: '#000000',
  canvasAltDark: '#0a0a0a',
  gridDark: 'rgba(0,0,0,0)',
  surfaceDark: '#121212',
  inkDark: '#f5f5f5',
  inkMutedDark: '#a8a8a8',
  ringDark: '#262626',
  indigoLight: '#ff3b64',
  indigoSoftDark: 'rgba(255,59,100,0.16)',
  indigoSofterDark: 'rgba(255,59,100,0.28)',
  indigoLineDark: 'rgba(255,59,100,0.38)',
  // Signalfarben im Dunkeln: eine Stufe heller, sonst versinkt Bernstein im
  // fast schwarzen Grund und liest sich als Braun.
  amberLight: '#fbbf24',
  amberSoftDark: 'rgba(251,191,36,0.16)',
  amberLineDark: 'rgba(251,191,36,0.38)',
  emeraldLight: '#34d399',
  emeraldSoftDark: 'rgba(52,211,153,0.16)',
} as const;

/**
 * Zustandsfarben pro Schema, an einer Stelle gebündelt.
 *
 * Getrennt von {@link BrandSurfaces}, weil das eine andere Aufgabe ist: Dort
 * geht es um Flächen und Text, hier ausschließlich um „was ist gerade los".
 * Zugriff über `useSignals()`.
 */
export const Signals = {
  light: {
    /** Läuft ab, wird knapp, braucht jetzt Aufmerksamkeit. */
    warn: Palette.amberStrong,
    warnGlow: Palette.amber,
    warnBg: Palette.amberSoft,
    warnBorder: Palette.amberLine,
    /** Geschafft, verdient, erledigt. */
    good: Palette.emerald,
    /**
     * Lichthof für etwas Erreichtes – das Gegenstück zu `warnGlow`.
     *
     * Gibt es, seit die Serie nicht mehr für „läuft ab" leuchtet, sondern für
     * „Wochenziel steht". Ohne diesen Wert müsste ein positiver Moment sich die
     * Warnfarbe leihen, und dann bedeutet Gelb irgendwann beides.
     */
    goodGlow: Palette.emerald,
    goodBg: Palette.emeraldSoft,
  },
  dark: {
    warn: Palette.amberLight,
    warnGlow: Palette.amberLight,
    warnBg: Palette.amberSoftDark,
    warnBorder: Palette.amberLineDark,
    good: Palette.emeraldLight,
    goodGlow: Palette.emeraldLight,
    goodBg: Palette.emeraldSoftDark,
  },
} as const;

export type SignalSurface = (typeof Signals)['light'];

export const Colors = {
  light: {
    text: Palette.ink,
    background: Palette.canvas,
    backgroundElement: Palette.canvasAlt,
    backgroundSelected: '#efefef',
    textSecondary: Palette.inkMuted,
    tint: Palette.indigoStrong,
    tintText: '#ffffff',
  },
  dark: {
    text: Palette.inkDark,
    background: Palette.canvasDark,
    backgroundElement: Palette.surfaceDark,
    backgroundSelected: '#262626',
    textSecondary: Palette.inkMutedDark,
    tint: Palette.indigoLight,
    tintText: '#ffffff',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

/**
 * Marken-Werte. Die Schlüssel heißen weiter wie früher (`purple`, `pink`, …),
 * damit jeder Screen unverändert weiterläuft – die Werte tragen jetzt aber die
 * helle cira-Palette: Indigo als Akzent, neutrale Grautöne, Konturen statt
 * Pastellflächen.
 */
export const Brand = {
  /** Akzent (früher Lila). */
  purple: Palette.indigo,
  /** Zweite Verlaufsfarbe (früher Pink). */
  pink: Palette.fuchsia,
  /** Dritte Verlaufs-/Signalfarbe (früher Pfirsich). */
  peach: Palette.cyan,
  /** Sanfte Akzentfläche für Chips (früher Lavendel). */
  lavender: Palette.indigoSoft,
  text: Palette.ink,
  textMuted: Palette.inkMuted,
  card: '#ffffff',
  inputBg: '#fafafa',
  inputBorder: Palette.ring,
  handle: 'rgba(23,23,23,0.18)',
} as const;

/**
 * Verlauf wie auf cira.systems: Indigo → Violett → Fuchsia. Drei Stufen statt
 * zwei, dadurch wirkt er lebendiger, ohne bunt zu werden.
 */
export const BrandGradient = [Palette.indigo, Palette.violet, Palette.fuchsia] as const;

/** Zweiter Verlauf der Referenz (Cyan → Indigo) – für Abwechslung, z. B. Fortschritt. */
export const CoolGradient = [Palette.cyan, Palette.indigo] as const;

/**
 * Marken-Oberflächen (Karten, Chips, Texte) in hell UND dunkel. Der helle Satz
 * entspricht exakt dem bisherigen `Brand`-Look; der dunkle kippt in transluzente
 * Nacht-Violett-Töne, damit die Tab-Inhalte im Dark-Mode mitziehen statt als
 * weiße Karten auf dunklem Grund zu „schweben“.
 */
export const BrandSurfaces = {
  light: {
    card: Brand.card,
    cardBorder: Palette.ring,
    text: Palette.ink,
    textMuted: Palette.inkMuted,
    chipBg: Palette.indigoSoft,
    chipBgStrong: Palette.indigoSofter,
    chipBorder: Palette.indigoLine,
    /**
     * Dasselbe Blau, nur deckend: `chipBg` über der Leinwand ausgerechnet. Für
     * Flächen, die NICHT auf der Leinwand liegen (Hinweis-Pillen über der
     * Karte) – dort würde die durchsichtige Variante die Kartenkacheln
     * durchscheinen lassen und der Text wäre nicht mehr zu lesen.
     */
    chipBgSolid: '#ffe8ed',
    chipText: Palette.indigoStrong,
    accent: Palette.indigoStrong,
    accentText: '#ffffff',
    /**
     * Eingabefelder sind bewusst KEIN Glas: milchiges Weiß auf fast weißem
     * Grund lässt die Feldkante verschwinden, und der Schatten/`elevation`
     * einer Glasfläche legt im Hellmodus einen grauen Hof um jedes Feld.
     * Deckendes Weiß mit klarer Kontur liest sich sauber und erwartbar.
     */
    fieldBg: '#fafafa',
    fieldBorder: '#dbdbdb',
    fieldPlaceholder: '#9ca3af',
  },
  dark: {
    card: '#121212',
    cardBorder: Palette.ringDark,
    text: Palette.inkDark,
    textMuted: Palette.inkMutedDark,
    chipBg: Palette.indigoSoftDark,
    chipBgStrong: Palette.indigoSofterDark,
    chipBorder: Palette.indigoLineDark,
    chipBgSolid: '#2a0f16',
    chipText: '#ff6b8a',
    accent: Palette.indigoLight,
    accentText: '#ffffff',
    fieldBg: '#121212',
    fieldBorder: '#363636',
    fieldPlaceholder: '#6b7280',
  },
} as const;

export type BrandSurface = (typeof BrandSurfaces)['light'];

/**
 * Glas-Oberflächen: milchige Flächen mit haarfeiner Kante und einem hellen
 * Lichtsaum an der Oberkante. Auf iOS 26 übernimmt echtes „Liquid Glass"
 * (expo-glass-effect), überall sonst bilden diese Werte den Look nach.
 *
 * Ruhig und professionell gehalten (klare Kanten, viel Weißraum, ein einziger
 * Akzent) – die Verspieltheit kommt aus Verlauf und Rundung, nicht aus Farbe.
 */
export const Glass = {
  light: {
    fill: '#ffffff',
    fillStrong: '#ffffff',
    fillSubtle: '#fafafa',
    /** Kontur statt Schatten – das prägt den Look der Referenz. */
    border: Palette.ring,
    edge: 'rgba(0,0,0,0)',
    highlight: 'rgba(255,255,255,0)',
    shadow: 'rgba(0,0,0,0)',
    tint: '#ffffff',
    /**
     * Schleier hinter Blättern und Popups. Bewusst zurückhaltend: Die Trennung
     * leistet der Weichzeichner, der Schleier nimmt nur noch die Unruhe aus dem,
     * was durchscheint.
     */
    scrim: 'rgba(0,0,0,0.40)',
  },
  dark: {
    fill: '#121212',
    fillStrong: '#121212',
    fillSubtle: '#0a0a0a',
    border: Palette.ringDark,
    edge: 'rgba(0,0,0,0)',
    highlight: 'rgba(255,255,255,0)',
    shadow: 'rgba(0,0,0,0)',
    tint: '#121212',
    scrim: 'rgba(0,0,0,0.60)',
  },
} as const;

export type GlassSurface = (typeof Glass)['light'];

/**
 * Rundungen wie bei der Referenz: eher knapp (6–16 px) plus echte Pillen.
 * Knappe Radien wirken sachlich; das Freundliche kommt aus Licht und Verlauf.
 */
export const Radius = {
  chip: 999,
  field: 8,
  card: 12,
  panel: 16,
} as const;

/** Schriftfamilie der Referenz. Wird in _layout.tsx geladen. */
export const FontFamily = {
  regular: 'InstrumentSans_400Regular',
  medium: 'InstrumentSans_500Medium',
  semibold: 'InstrumentSans_600SemiBold',
  bold: 'InstrumentSans_700Bold',
} as const;

/**
 * Passende Schriftdatei zu einem `fontWeight`.
 *
 * Nötig, weil eingebundene Schriften auf Android keine Stärken ableiten: ohne
 * die richtige Datei bleibt alles in Normalstärke. So bleibt `fontWeight` im
 * Code erhalten und die Schrift stimmt trotzdem.
 */
export function fontFamilyForWeight(weight?: number | string): string {
  const value = typeof weight === 'string' ? Number(weight) : weight;
  if (weight === 'bold' || (value !== undefined && value >= 700)) return FontFamily.bold;
  if (value !== undefined && value >= 600) return FontFamily.semibold;
  if (value !== undefined && value >= 500) return FontFamily.medium;
  return FontFamily.regular;
}

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

/**
 * Wie weit Inhalt über der unteren Leiste enden muss.
 *
 * 0, seit die Leiste eine eigene ist (src/components/app-tabs.tsx): Sie steht im
 * normalen Fluss UNTER dem Tab-Inhalt und überdeckt nichts mehr. Die native
 * Leiste lag durchscheinend über dem Inhalt, dafür waren 50/80 px nötig. Der
 * Wert bleibt als Name stehen, damit die Stellen, die ihn brauchten, auffindbar
 * sind, falls die Leiste je wieder schwebt.
 */
export const BottomTabInset = 0;
export const MaxContentWidth = 800;
