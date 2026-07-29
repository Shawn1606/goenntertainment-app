import { useState } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import Animated, { FadeIn, useReducedMotion } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { GlassSurface } from '@/components/ui/glass';
import { Icon } from '@/components/ui/icon';
import { Radius, Spacing } from '@/constants/theme';
import type { UiIconName } from '@/domain/ui-icon';
import { useBrandSurface } from '@/hooks/use-theme';
import * as feedback from '@/lib/feedback';

/**
 * Der Icon-Platz einer Zeile – feste Breite, damit die Titel untereinander
 * fluchten, auch wenn eine Zeile kein Symbol hat.
 *
 * Nimmt nur noch einen **Namen** aus dem Icon-Set. Vorher ging hier auch ein
 * beliebiger String durch, was in der Praxis „Emoji" bedeutete: Die kamen in
 * Systemfarbe, waren auf jedem Gerät anders groß und wurden vom Screenreader
 * mitten in der Zeile vorgelesen. Ein Name lässt sich einfärben, prüfen und als
 * Dekoration überspringen.
 */
function IconSlot({ icon }: { icon?: UiIconName }) {
  const surface = useBrandSurface();
  if (icon == null) return null;
  return (
    <View style={styles.icon}>
      {/* Ohne `label`: Der Titel direkt daneben sagt dasselbe. */}
      <Icon name={icon} size={20} color={surface.accent} />
    </View>
  );
}

/**
 * Bausteine für Einstellungslisten: eine Gruppe mit Überschrift und darin
 * Zeilen – entweder mit Schalter oder als Verweis.
 *
 * Bewusst hier gebündelt statt in jedem Screen neu gebaut: Sobald es mehr als
 * eine Handvoll Einstellungen gibt, entscheidet die Gleichförmigkeit der
 * Zeilen darüber, ob sich der Screen aufgeräumt anfühlt.
 */

/**
 * Eine Gruppe – standardmäßig **zugeklappt**.
 *
 * ## Warum zu und nicht auf
 *
 * Die Einstellungen haben acht Gruppen mit zusammen über zwanzig Zeilen. Offen
 * ist das eine Wand, durch die man scrollt, um die eine Zeile zu finden, die man
 * sucht. Zugeklappt ist es ein Inhaltsverzeichnis: acht Überschriften, von denen
 * man genau die aufmacht, die man braucht.
 *
 * Der Preis ist ein zusätzlicher Tipp pro Einstellung. Den nimmt man in Kauf,
 * weil Einstellungen selten und gezielt aufgerufen werden – niemand geht die
 * Liste von oben nach unten durch.
 *
 * ## Wie der Zustand gehalten wird
 *
 * Jede Gruppe merkt sich ihren Zustand selbst. Bewusst NICHT im Screen und nicht
 * gespeichert: Ein Screen, der acht Zustände verwaltet, wächst mit jeder neuen
 * Gruppe – und ein gespeicherter Zustand würde beim nächsten Öffnen wieder eine
 * halb ausgeklappte Wand ergeben, also genau das, was hier vermieden werden soll.
 *
 * `defaultOpen` gibt es für die eine Gruppe, die beim Öffnen sichtbar sein soll
 * (das Konto) – von dort geht man weiter, dort fängt man nicht mit einem Tipp an.
 */
export function SettingGroup({
  label,
  hint,
  defaultOpen = false,
  collapsible = true,
  children,
}: {
  label: string;
  /**
   * Kurze Einordnung unter der Überschrift – steht auch im ZUGEKLAPPTEN Zustand
   * da und ist damit das Einzige, was verrät, was in der Gruppe steckt. Ohne sie
   * ist eine zugeklappte Gruppe nur eine Überschrift, die man aufmachen muss, um
   * zu sehen, ob man sie überhaupt gesucht hat. Deshalb hat hier jede Gruppe eine.
   *
   * Form: **ein Satz, der die Tätigkeit nennt** („Zwischen hell und dunkel
   * wechseln."), keine Aufzählung von Nomen und kein Vorbehalt. Erster Versuch war
   * eine Inhaltsliste je Gruppe („Standort, Vibration, Klänge, gespeicherte
   * Zugangsdaten und der Datenschutz.") – fünf Nomen ohne Verb liest man nicht
   * beim Scannen, man überfliegt sie. Was noch nicht greift, gehört als
   * `RowNote` in die Gruppe, nicht hierher: Vor dem Aufklappen fehlt der Bezug.
   */
  hint?: string;
  /** true = beim Öffnen des Screens schon offen. */
  defaultOpen?: boolean;
  /** false = die Gruppe ist immer offen und hat keinen Kopf zum Antippen. */
  collapsible?: boolean;
  children: React.ReactNode;
}) {
  const surface = useBrandSurface();
  const [open, setOpen] = useState(defaultOpen);
  const reduced = useReducedMotion();

  const body = (
    <GlassSurface tone="accent" radius={Radius.card} style={styles.card}>
      {children}
    </GlassSurface>
  );

  if (!collapsible) {
    return (
      <View style={styles.group}>
        <GroupLabel label={label} hint={hint} surface={surface} />
        {body}
      </View>
    );
  }

  return (
    <View style={styles.group}>
      <Pressable
        onPress={() => {
          // Auf- und Zuklappen ist eine Auswahl, keine Aktion – deshalb der
          // leichteste Stoß und kein Ton.
          feedback.selected();
          setOpen((prev) => !prev);
        }}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        // `accessibilityState` allein reicht im Web nicht: React Native Web
        // übersetzt `expanded` bei `role="button"` nicht nach `aria-expanded`, im
        // DOM stand also nur `role=button`. Ohne dieses Attribut kann ein
        // Screenreader nicht sagen, ob die Gruppe offen ist – „auf oder zu" wäre
        // eine rein visuelle Information (gedrehtes ›). Dieselbe Lücke wie bei
        // `aria-selected` in `segmented.tsx`.
        aria-expanded={open}
        accessibilityLabel={`${label}${hint ? `. ${hint}` : ''}`}
        hitSlop={4}
        style={({ pressed }) => [styles.groupHead, pressed && styles.pressed]}>
        <View style={styles.groupHeadText}>
          <GroupLabel label={label} hint={hint} surface={surface} />
        </View>
        {/* Dasselbe Zeichen wie am Ende einer LinkRow, nur gedreht: aufgeklappt
            zeigt es nach unten. Ein zweites Symbol für „mehr" wäre eine zweite
            Sprache für dieselbe Sache. */}
        <ThemedText
          style={[
            styles.chevron,
            { color: surface.textMuted },
            open && styles.chevronOpen,
          ]}>
          ›
        </ThemedText>
      </Pressable>

      {/* Der Inhalt tritt ein, verschwindet aber sofort. Grund wie bei
          `Entrance`: Läuft eine Animation nicht, muss Inhalt DA sein – und beim
          Zuklappen ist „sofort weg" ohnehin das, was man erwartet. */}
      {open ? (
        <Animated.View entering={reduced ? undefined : FadeIn.duration(160)}>{body}</Animated.View>
      ) : null}
    </View>
  );
}

/** Überschrift und Einordnung – in beiden Fassungen der Gruppe dieselbe. */
function GroupLabel({
  label,
  hint,
  surface,
}: {
  label: string;
  hint?: string;
  surface: ReturnType<typeof useBrandSurface>;
}) {
  return (
    <>
      <ThemedText type="smallBold" style={[styles.groupLabel, { color: surface.textMuted }]}>
        {label.toUpperCase()}
      </ThemedText>
      {hint ? (
        <ThemedText type="small" style={[styles.groupHint, { color: surface.textMuted }]}>
          {hint}
        </ThemedText>
      ) : null}
    </>
  );
}

/**
 * Trennlinie zwischen zwei Zeilen einer Gruppe. Indigo statt Grau: eine graue
 * Linie auf der blauen Karte wirkt wie ein Fremdkörper.
 */
export function RowDivider() {
  const surface = useBrandSurface();
  return <View style={[styles.divider, { backgroundColor: surface.chipBorder }]} />;
}

/**
 * Ein Hinweis am Fuß einer Gruppe – kein Eintrag, nichts zum Antippen.
 *
 * Gedacht für den Vorbehalt, der zu den Zeilen darüber gehört ("das greift noch
 * nicht"). Der stand vorher in der Einordnung unter der Überschrift, also an der
 * Stelle, an der man erst entscheidet, ob man die Gruppe überhaupt aufmacht –
 * dort ist er eine Warnung ohne Gegenstand. Hier steht er direkt bei den
 * Schaltern, auf die er sich bezieht.
 */
export function RowNote({ children }: { children: React.ReactNode }) {
  const surface = useBrandSurface();
  return (
    <View style={styles.note}>
      <ThemedText type="small" style={{ color: surface.textMuted }}>
        {children}
      </ThemedText>
    </View>
  );
}

export function SwitchRow({
  icon,
  title,
  hint,
  value,
  onValueChange,
  disabled,
}: {
  icon?: UiIconName;
  title: string;
  hint?: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  const surface = useBrandSurface();

  return (
    <View style={styles.row}>
      <IconSlot icon={icon} />
      <View style={styles.rowText}>
        <ThemedText style={[styles.title, { color: surface.text }]}>{title}</ThemedText>
        {hint ? (
          <ThemedText type="small" style={{ color: surface.textMuted }}>
            {hint}
          </ThemedText>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ true: surface.accent, false: surface.chipBorder }}
        thumbColor="#ffffff"
      />
    </View>
  );
}

export function LinkRow({
  icon,
  title,
  hint,
  value,
  onPress,
  danger,
}: {
  icon?: UiIconName;
  title: string;
  hint?: string;
  /** Aktueller Wert rechts (statt des Pfeils, z. B. eine Version). */
  value?: string;
  onPress?: () => void;
  danger?: boolean;
}) {
  const surface = useBrandSurface();
  const color = danger ? '#ef4444' : surface.text;

  const body = (
    <View style={styles.row}>
      <IconSlot icon={icon} />
      <View style={styles.rowText}>
        <ThemedText style={[styles.title, { color }]}>{title}</ThemedText>
        {hint ? (
          <ThemedText type="small" style={{ color: surface.textMuted }}>
            {hint}
          </ThemedText>
        ) : null}
      </View>
      {value ? (
        <ThemedText type="small" style={{ color: surface.textMuted }}>
          {value}
        </ThemedText>
      ) : onPress ? (
        <ThemedText style={{ color: surface.textMuted, fontSize: 20 }}>›</ThemedText>
      ) : null}
    </View>
  );

  if (!onPress) return body;

  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => pressed && styles.pressed}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  group: { gap: Spacing.two },
  groupLabel: { letterSpacing: 0.8, marginLeft: Spacing.half, fontSize: 12 },
  groupHint: { marginLeft: Spacing.half, marginTop: -Spacing.one },
  /** Der antippbare Kopf. `minHeight` macht ihn zur bequemen Trefferfläche. */
  groupHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: 32,
    paddingRight: Spacing.two,
  },
  groupHeadText: { flex: 1, gap: Spacing.two },
  chevron: { fontSize: 20, lineHeight: 24 },
  chevronOpen: { transform: [{ rotate: '90deg' }] },
  card: { paddingHorizontal: Spacing.three },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
    minHeight: 56,
  },
  icon: { width: 24, alignItems: 'center', justifyContent: 'center' },
  // Kein `minHeight` wie bei `row`: Der Hinweis ist keine Zeile, die man trifft.
  note: { paddingTop: Spacing.one, paddingBottom: Spacing.three },
  rowText: { flex: 1, gap: 1 },
  title: { fontSize: 15, lineHeight: 20, fontWeight: '600' },
  divider: { height: StyleSheet.hairlineWidth * 2 },
  pressed: { opacity: 0.6 },
});
