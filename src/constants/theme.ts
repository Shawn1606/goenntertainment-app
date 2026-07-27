/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#000000',
    background: '#ffffff',
    backgroundElement: '#F0F0F3',
    backgroundSelected: '#E0E1E6',
    textSecondary: '#60646C',
    tint: '#7C3AED',
    tintText: '#ffffff',
  },
  dark: {
    text: '#ffffff',
    background: '#000000',
    backgroundElement: '#212225',
    backgroundSelected: '#2E3135',
    textSecondary: '#B0B4BA',
    tint: '#9F67FF',
    tintText: '#ffffff',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

/**
 * Marken-Design aus der alten Web-App (immer hell/pastell, wie im Original).
 * Verlauf Lila → Pink, weicher Pastell-Hintergrund, weiße Karten.
 */
export const Brand = {
  purple: '#9b6dff',
  pink: '#ff6bb5',
  peach: '#ffb4a2',
  lavender: '#e8d5ff',
  text: '#1f2937', // gray-800
  textMuted: '#6b7280', // gray-500
  card: 'rgba(255,255,255,0.9)',
  inputBg: 'rgba(255,255,255,0.85)',
  inputBorder: '#ede9fe', // purple-100
  handle: '#d1d5db', // gray-300
} as const;

export const BrandGradient = [Brand.purple, Brand.pink] as const;

/**
 * Marken-Oberflächen (Karten, Chips, Texte) in hell UND dunkel. Der helle Satz
 * entspricht exakt dem bisherigen `Brand`-Look; der dunkle kippt in transluzente
 * Nacht-Violett-Töne, damit die Tab-Inhalte im Dark-Mode mitziehen statt als
 * weiße Karten auf dunklem Grund zu „schweben“.
 */
export const BrandSurfaces = {
  light: {
    card: Brand.card,
    cardBorder: Brand.inputBorder,
    text: Brand.text,
    textMuted: Brand.textMuted,
    chipBg: Brand.lavender,
    chipText: Brand.purple,
    accent: Brand.purple,
    accentText: '#ffffff',
  },
  dark: {
    card: 'rgba(32,24,52,0.72)',
    cardBorder: 'rgba(159,103,255,0.28)',
    text: '#f5f3ff',
    textMuted: '#b9b1cc',
    chipBg: 'rgba(159,103,255,0.18)',
    chipText: '#c4b5fd',
    accent: '#9f67ff',
    accentText: '#ffffff',
  },
} as const;

export type BrandSurface = (typeof BrandSurfaces)['light'];

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
