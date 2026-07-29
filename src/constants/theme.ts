/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

/**
 * Grundfarben, abgeleitet von cira.systems – aber als HELLE Variante.
 *
 * Die Referenz läuft auf fast schwarzem Grund (#0a0a0a) mit milchigen Flächen,
 * 1px-Konturen statt Schlagschatten und einem Indigo-Akzent (#6366f1). Wir
 * drehen nur die Leinwand ins Helle (#fafafa) und behalten alles andere:
 * neutrale Grautöne, haarfeine Konturen, ein Akzent, viel Luft.
 *
 * Werte per Browser aus cira.systems ausgelesen (siehe change/ai.md, STEP 18).
 */
export const Palette = {
  /** Leinwand: fast weiß statt fast schwarz. */
  canvas: '#fafafa',
  canvasAlt: '#f4f4f5',
  /** Feines 1px-Raster im Hintergrund – wie bei der Referenz, nur invertiert. */
  grid: 'rgba(23,23,23,0.045)',
  ink: '#171717',
  inkMuted: '#737373',
  inkSubtle: '#a3a3a3',
  /** Konturen ersetzen Schatten – das prägt den sachlichen Eindruck. */
  ring: 'rgba(23,23,23,0.09)',
  ringStrong: 'rgba(23,23,23,0.15)',
  /** Akzent: Indigo. Auf hellem Grund die kräftigere Stufe für Kontrast. */
  indigo: '#6366f1',
  indigoStrong: '#4f46e5',
  indigoSoft: 'rgba(99,102,241,0.12)',
  /**
   * Zweite Stufe desselben Blaus. Nötig, sobald ein blaues Element auf einer
   * blauen Fläche liegt (Symbol-Kachel in einer Akzent-Karte, gedrückte Zeile):
   * mit nur einer Stufe verschwindet das eine im anderen.
   */
  indigoSofter: 'rgba(99,102,241,0.22)',
  /** Kontur zur sanften Akzentfläche – hält Kachel und Platzhalter in einer Familie. */
  indigoLine: 'rgba(99,102,241,0.26)',
  violet: '#8b5cf6',
  fuchsia: '#d946ef',
  cyan: '#06b6d4',
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
  canvasDark: '#0a0a0a',
  canvasAltDark: '#111111',
  gridDark: 'rgba(255,255,255,0.05)',
  surfaceDark: '#171717',
  inkDark: '#f5f5f5',
  inkMutedDark: '#a3a3a3',
  ringDark: 'rgba(255,255,255,0.10)',
  indigoLight: '#818cf8',
  indigoSoftDark: 'rgba(129,140,248,0.16)',
  indigoSofterDark: 'rgba(129,140,248,0.30)',
  indigoLineDark: 'rgba(129,140,248,0.32)',
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
    backgroundSelected: '#e7e7ea',
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
    tintText: '#0a0a0a',
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
  card: 'rgba(255,255,255,0.72)',
  inputBg: 'rgba(255,255,255,0.85)',
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
    chipBgSolid: '#ecedfd',
    chipText: Palette.indigoStrong,
    accent: Palette.indigoStrong,
    accentText: '#ffffff',
    /**
     * Eingabefelder sind bewusst KEIN Glas: milchiges Weiß auf fast weißem
     * Grund lässt die Feldkante verschwinden, und der Schatten/`elevation`
     * einer Glasfläche legt im Hellmodus einen grauen Hof um jedes Feld.
     * Deckendes Weiß mit klarer Kontur liest sich sauber und erwartbar.
     */
    fieldBg: '#ffffff',
    fieldBorder: 'rgba(23,23,23,0.14)',
    fieldPlaceholder: '#9ca3af',
  },
  dark: {
    card: 'rgba(23,23,23,0.72)',
    cardBorder: Palette.ringDark,
    text: Palette.inkDark,
    textMuted: Palette.inkMutedDark,
    chipBg: Palette.indigoSoftDark,
    chipBgStrong: Palette.indigoSofterDark,
    chipBorder: Palette.indigoLineDark,
    chipBgSolid: '#1d1f30',
    chipText: '#a5b4fc',
    accent: Palette.indigoLight,
    accentText: '#0a0a0a',
    fieldBg: 'rgba(255,255,255,0.06)',
    fieldBorder: 'rgba(255,255,255,0.16)',
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
    fill: 'rgba(255,255,255,0.66)',
    fillStrong: 'rgba(255,255,255,0.86)',
    fillSubtle: 'rgba(255,255,255,0.42)',
    /** Kontur statt Schatten – das prägt den Look der Referenz. */
    border: Palette.ring,
    edge: 'rgba(23,23,23,0.06)',
    highlight: 'rgba(255,255,255,0.95)',
    shadow: 'rgba(23,23,23,0.10)',
    tint: 'rgba(255,255,255,0.6)',
    /**
     * Schleier hinter Blättern und Popups. Bewusst zurückhaltend: Die Trennung
     * leistet der Weichzeichner, der Schleier nimmt nur noch die Unruhe aus dem,
     * was durchscheint.
     */
    scrim: 'rgba(23,23,23,0.20)',
  },
  dark: {
    fill: 'rgba(23,23,23,0.58)',
    fillStrong: 'rgba(23,23,23,0.84)',
    fillSubtle: 'rgba(23,23,23,0.36)',
    border: Palette.ringDark,
    edge: 'rgba(0,0,0,0.4)',
    highlight: 'rgba(255,255,255,0.07)',
    shadow: 'rgba(0,0,0,0.5)',
    tint: 'rgba(23,23,23,0.55)',
    scrim: 'rgba(0,0,0,0.45)',
  },
} as const;

export type GlassSurface = (typeof Glass)['light'];

/**
 * Rundungen wie bei der Referenz: eher knapp (6–16 px) plus echte Pillen.
 * Knappe Radien wirken sachlich; das Freundliche kommt aus Licht und Verlauf.
 */
export const Radius = {
  chip: 999,
  field: 10,
  card: 14,
  panel: 18,
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

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
