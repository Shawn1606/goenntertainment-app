/**
 * Glas-Bausteine der App.
 *
 * Auf iOS 26 rendert `expo-glass-effect` echtes „Liquid Glass". Überall sonst
 * (Android, Web, ältere iOS-Versionen) bauen wir denselben Eindruck selbst:
 * milchige Füllung, haarfeine helle Kante, ein Lichtsaum an der Oberkante und
 * ein weicher Schatten. Im Web kommt zusätzlich echtes `backdrop-filter` dazu.
 *
 * Alle Bausteine nehmen nur Darstellungs-Aufgaben wahr – keine Datenlogik.
 * Dadurch bleibt jeder Screen austauschbar, ohne das Aussehen anzufassen.
 */
import { LinearGradient } from 'expo-linear-gradient';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { memo, useEffect, type ReactNode } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type PressableProps,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { Shimmer } from '@/components/ui/glow';
import { BrandGradient, FontFamily, Radius, Spacing } from '@/constants/theme';
import { useBrandSurface, useGlass } from '@/hooks/use-theme';
import { Icon } from '@/components/ui/icon';

/** Einmal auswerten – der Wert ändert sich zur Laufzeit nicht. */
const LIQUID_GLASS = isLiquidGlassAvailable();

/** Echtes Weichzeichnen hinter der Fläche; nur das Web kann das ohne Extra-Paket. */
const webBlur = (radius: number) =>
  Platform.OS === 'web'
    ? ({ backdropFilter: `blur(${radius}px) saturate(140%)` } as unknown as ViewStyle)
    : null;

type Tone = 'card' | 'panel' | 'subtle' | 'accent' | 'frost';

export type GlassSurfaceProps = {
  children?: ReactNode;
  /**
   * `card` = normale Karte, `panel` = kräftiger (Kopfzeilen, Sheets),
   * `subtle` = fast durchsichtig, `accent` = sanftes Akzent-Blau (Platzhalter,
   * leere Regale) – genau der Ton der Kategorie-Kacheln.
   *
   * `frost` ist die kräftige, immer selbst gemalte Stufe – für kleine Flächen
   * AUF einer Akzentkarte (Level-Plakette). Zwei Gründe gegen echtes Glas an
   * dieser Stelle: es mischt sich mit der Unterlage und kippt ins Graue, und
   * eine durchsichtige Füllung lässt die Plakette im Hellmodus verwaschen
   * aussehen. Deckend gemalt bleibt sie eine klare Fläche, den Akzent trägt
   * die Schrift.
   */
  tone?: Tone;
  radius?: number;
  /** Lichtsaum an der Oberkante – bei kleinen Elementen (Chips) besser aus. */
  sheen?: boolean;
  style?: StyleProp<ViewStyle>;
};

/**
 * Die Grundfläche. Alles andere in dieser Datei baut darauf auf.
 */
export function GlassSurface({
  children,
  tone = 'card',
  radius = Radius.card,
  sheen = true,
  style,
}: GlassSurfaceProps) {
  const glass = useGlass();
  const surface = useBrandSurface();
  const accent = tone === 'accent';
  /** Beide Töne malen ihre Fläche selbst, statt sie an Liquid Glass zu geben. */
  const painted = accent || tone === 'frost';
  const fill = accent
    ? surface.chipBg
    : tone === 'panel' || tone === 'frost'
      ? glass.fillStrong
      : tone === 'subtle'
        ? glass.fillSubtle
        : glass.fill;

  const frame: StyleProp<ViewStyle> = [
    styles.surface,
    {
      borderRadius: radius,
      borderColor: accent ? surface.chipBorder : glass.border,
      shadowColor: glass.shadow,
    },
    // Gemalte Flächen liegen flach auf: ein Schatten legte im Hellmodus wieder
    // einen grauen Hof um genau die Flächen, die farbig bzw. klar sein sollen.
    painted && styles.flat,
  ];

  // Liquid Glass mischt jeden Tint mit der Unterlage und käme dadurch nie auf
  // exakt das Blau der Kategorie-Kacheln. Akzentflächen malen wir deshalb selbst.
  // Hier bewusst OHNE `backgroundColor`: eine Füllung würde das echte Glas zudecken.
  if (LIQUID_GLASS && !painted) {
    return (
      <GlassView style={[frame, style]} glassEffectStyle="regular" tintColor={glass.tint}>
        {children}
      </GlassView>
    );
  }

  // Die Füllung des Tons ist nur die Vorgabe: `style` kommt danach und darf sie
  // überschreiben (etwa eine ausgewählte Pille in ihrer Aktivfarbe).
  return (
    <View
      style={[frame, { backgroundColor: fill }, style, accent ? null : webBlur(tone === 'subtle' ? 10 : 18)]}>
      {sheen && !accent ? (
        <LinearGradient
          pointerEvents="none"
          colors={[glass.highlight, 'transparent']}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 0.9, y: 1 }}
          style={[StyleSheet.absoluteFill, { borderRadius: radius, opacity: 0.55 }]}
        />
      ) : null}
      {children}
    </View>
  );
}

/** Karte mit Innenabstand – der Standard für Inhalte. */
export function GlassCard({
  children,
  style,
  tone = 'card',
  radius = Radius.card,
}: GlassSurfaceProps) {
  return (
    <GlassSurface tone={tone} radius={radius} style={[styles.card, style]}>
      {children}
    </GlassSurface>
  );
}

export type GlassChipProps = {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  /**
   * Zeichen vor dem Text – als Element, nicht als Zeichenkette.
   *
   * Absichtlich `ReactNode`: Die Pille ist ein Layout-Baustein und soll nicht
   * wissen müssen, aus welchem Set das Zeichen kommt. Kategorien liefern
   * `<CategoryIcon>`, Plattformen `<SocialIcon>`, alles andere `<Icon>` – alle
   * drei passen hier hinein, ohne dass die Pille eine Tabelle davon braucht.
   */
  icon?: ReactNode;
  accessibilityLabel?: string;
};

/** Auswahl-Pille für Kategorien, Zeitfenster und Umkreis. */
export function GlassChip({ label, selected = false, onPress, icon, accessibilityLabel }: GlassChipProps) {
  const surface = useBrandSurface();
  const glass = useGlass();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityState={{ selected }}
      accessibilityLabel={accessibilityLabel ?? label}
      style={({ pressed }) => [pressed && styles.pressed]}>
      <GlassSurface
        tone={selected ? 'panel' : 'subtle'}
        radius={Radius.chip}
        sheen={false}
        style={[
          styles.chip,
          selected && { borderColor: surface.accent, backgroundColor: surface.chipBg },
          !selected && { borderColor: glass.border },
        ]}>
        {icon}
        <Text
          numberOfLines={1}
          style={[styles.chipText, { color: selected ? surface.chipText : surface.textMuted }]}>
          {label}
        </Text>
      </GlassSurface>
    </Pressable>
  );
}

export type GlassButtonProps = PressableProps & {
  title: string;
  /** `primary` = Verlauf (eine pro Bildschirm), `ghost` = Glas. */
  variant?: 'primary' | 'ghost';
  style?: StyleProp<ViewStyle>;
};

export function GlassButton({ title, variant = 'primary', style, ...rest }: GlassButtonProps) {
  const surface = useBrandSurface();

  if (variant === 'primary') {
    return (
      <Pressable accessibilityRole="button" {...rest} style={({ pressed }) => [pressed && styles.pressed, style]}>
        <LinearGradient
          colors={[...BrandGradient]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.button}>
          <Text style={[styles.buttonText, { color: '#ffffff' }]}>{title}</Text>
        </LinearGradient>
      </Pressable>
    );
  }

  return (
    <Pressable accessibilityRole="button" {...rest} style={({ pressed }) => [pressed && styles.pressed, style]}>
      <GlassSurface tone="panel" radius={Radius.field} style={styles.button}>
        <Text style={[styles.buttonText, { color: surface.accent }]}>{title}</Text>
      </GlassSurface>
    </Pressable>
  );
}

export type GlassSearchFieldProps = TextInputProps & {
  /** Wird rechts eingeblendet, sobald Text drinsteht. */
  onClear?: () => void;
  containerStyle?: StyleProp<ViewStyle>;
};

/**
 * Suchfeld im Glas-Look.
 *
 * `memo`, weil dieses Feld über der Ergebnisliste sitzt: jeder Tastendruck
 * ändert den Filter im Eltern-Screen und rendert damit auch die Liste neu.
 * Ohne `memo` läuft dieser Re-Render durch das Feld hindurch – das ist die
 * Sorte Kette, an deren Ende auf Android der Fokus (und damit die Tastatur)
 * verloren geht.
 *
 * Die eigenen Vorgaben (`returnKeyType`, `autoCorrect`) stehen absichtlich VOR
 * `...rest`, damit ein Aufrufer sie überschreiben kann, und `style` danach,
 * damit die Glas-Optik nicht versehentlich wegfällt.
 */
export const GlassSearchField = memo(function GlassSearchField({
  onClear,
  containerStyle,
  value,
  style,
  ...rest
}: GlassSearchFieldProps) {
  const surface = useBrandSurface();

  return (
    <GlassSurface tone="panel" radius={Radius.field} style={[styles.search, containerStyle]}>
      <Icon name="search" size={17} color={surface.textMuted} />
      <TextInput
        returnKeyType="search"
        autoCorrect={false}
        {...rest}
        value={value}
        placeholderTextColor={surface.textMuted}
        style={[styles.searchInput, { color: surface.text }, style]}
      />
      {value && onClear ? (
        <Pressable onPress={onClear} hitSlop={10} accessibilityRole="button" accessibilityLabel="Suche leeren">
          <Icon name="close" size={16} color={surface.textMuted} />
        </Pressable>
      ) : null}
    </GlassSurface>
  );
});

/** Überschrift einer Sektion, optional mit Zusatz rechts. */
export function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  const surface = useBrandSurface();

  return (
    <View style={styles.sectionHeader}>
      <Text style={[styles.sectionTitle, { color: surface.text }]}>{title}</Text>
      {action}
    </View>
  );
}

/**
 * Dünner Fortschrittsbalken im Markenverlauf (Level, Abzeichen).
 *
 * Der Balken WÄCHST auf seinen Wert, statt fertig dazustehen. Das ist der
 * Unterschied zwischen „du bist bei 60 %" und „du hast eben etwas geschafft":
 * Ein Balken, der schon voll ist, wenn man hinschaut, hat nie erzählt, dass er
 * gewachsen ist. Beim ersten Erscheinen läuft er von 0 los, danach nur noch von
 * seinem alten Wert – so wirkt jede Rückkehr auf den Bildschirm nicht wie ein
 * Neustart.
 *
 * Kurz vor dem nächsten Level zieht zusätzlich ein Lichtband darüber. Das ist
 * genau der Moment, in dem sich „noch 20 XP" nach lohnenswert anfühlen soll.
 */
export function GlassProgressBar({
  progress,
  height = 8,
  /** Ab wann das Lichtband über den Balken zieht („gleich geschafft"). */
  glowAt = 0.85,
}: {
  progress: number;
  height?: number;
  glowAt?: number;
}) {
  const glass = useGlass();
  const reduced = useReducedMotion();
  const clamped = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0));

  const grown = useSharedValue(0);

  useEffect(() => {
    grown.value = reduced
      ? clamped
      : withTiming(clamped, { duration: 900, easing: Easing.out(Easing.cubic) });
  }, [clamped, reduced, grown]);

  const fill = useAnimatedStyle(() => ({
    width: `${grown.value * 100}%`,
  }));

  return (
    <View style={[styles.progressTrack, { height, borderRadius: height, backgroundColor: glass.fillSubtle }]}>
      <Animated.View style={[{ height: '100%', borderRadius: height, overflow: 'hidden' }, fill]}>
        <LinearGradient
          colors={[...BrandGradient]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
      {clamped >= glowAt && clamped < 1 ? (
        <Shimmer color="rgba(255,255,255,0.85)" radius={height} durationMs={1800} restMs={2600} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  surface: {
    borderWidth: StyleSheet.hairlineWidth * 2,
    overflow: 'hidden',
    ...Platform.select({
      android: { elevation: 2 },
      default: {
        shadowOpacity: 1,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 8 },
      },
    }),
  },
  flat: {
    ...Platform.select({
      android: { elevation: 0 },
      default: { shadowOpacity: 0, shadowRadius: 0 },
    }),
  },
  card: {
    padding: Spacing.three,
  },
  pressed: {
    opacity: 0.75,
    transform: [{ scale: 0.985 }],
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    minHeight: 36,
    justifyContent: 'center',
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
    fontFamily: FontFamily.semibold,
  },
  button: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
    borderRadius: Radius.field,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '700',
    fontFamily: FontFamily.bold,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    minHeight: 48,
  },
  searchIcon: {
    fontSize: 15,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    fontFamily: FontFamily.regular,
    paddingVertical: Spacing.two,
    // Web: der blaue Fokusrahmen passt nicht zum Glas-Look.
    ...Platform.select({ web: { outlineStyle: 'none' } as object, default: {} }),
  },
  searchClear: {
    fontSize: 15,
    paddingHorizontal: Spacing.one,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    fontFamily: FontFamily.bold,
    letterSpacing: -0.3,
  },
  progressTrack: {
    width: '100%',
    overflow: 'hidden',
  },
});
