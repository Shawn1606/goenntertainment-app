import { Tabs, TabList, TabTrigger, TabSlot, TabTriggerSlotProps, TabListProps } from 'expo-router/ui';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from './themed-text';
import { ThemedView } from './themed-view';

import { MaxContentWidth, Spacing } from '@/constants/theme';

/**
 * Web-Pendant der unteren Leiste – dieselben fünf Ziele in derselben Reihenfolge.
 *
 * Im Web gäbe es Androids Fünf-Ziele-Grenze nicht; die Leiste zeigt trotzdem
 * genau dieselben Einträge. Sonst wäre der Business-Bereich im Browser ein Tab
 * und am Telefon ein Eintrag im Konto-Blatt, und jede Anleitung müsste zwei Wege
 * beschreiben.
 *
 * ## Home in der Mitte – und hier wirklich größer
 *
 * Die Reihenfolge ist dieselbe wie am Handy (Karte · Freunde · **Home** ·
 * Aktivitäten · Einstellungen). Der Unterschied: Diese Leiste ist selbst gebaut,
 * also lässt sich der mittlere Eintrag tatsächlich vergrößern – mehr Fläche,
 * fettere Schrift, in der Akzentfarbe. Am Handy geht das nicht, dort trägt die
 * Zeichnung den Unterschied (siehe `app-tabs.tsx`).
 *
 * ## Warum sieben gleich breite Spalten
 *
 * Die Wortmarke stand vorher links und schob die Einträge mit `marginRight: auto`
 * nach rechts – Home lag damit irgendwo rechts außen. Die Einträge einfach
 * mittig zu setzen genügt aber nicht: „Map" ist 61 px breit, „Einstellungen"
 * 121 px, und dadurch landet Home rund 40 px links der Mitte. Gemessen ist das
 * schief, und die Vorgabe hieß Mitte.
 *
 * Deshalb bekommen Marke, die fünf Einträge und ein leerer Platzhalter rechts
 * jeweils `flex: 1`: sieben gleich breite Spalten, Home in der vierten – also
 * exakt in der Mitte, unabhängig davon, wie lang die Wörter sind. Das ist
 * außerdem dieselbe Aufteilung wie am Handy, wo die native Leiste ihren fünf
 * Einträgen ohnehin gleich breite Felder gibt.
 */
export default function AppTabs() {
  return (
    <Tabs>
      <TabSlot style={{ height: '100%' }} />
      <TabList asChild>
        <CustomTabList>
          <TabTrigger name="map" href="/map" asChild>
            <TabButton>Map</TabButton>
          </TabTrigger>
          <TabTrigger name="friends" href="/friends" asChild>
            <TabButton>Freunde</TabButton>
          </TabTrigger>
          <TabTrigger name="home" href="/" asChild>
            <TabButton primary>Home</TabButton>
          </TabTrigger>
          <TabTrigger name="my-activities" href="/my-activities" asChild>
            <TabButton>Aktivitäten</TabButton>
          </TabTrigger>
          <TabTrigger name="settings" href="/settings" asChild>
            <TabButton>Einstellungen</TabButton>
          </TabTrigger>
        </CustomTabList>
      </TabList>
    </Tabs>
  );
}

/**
 * Ein Eintrag der Leiste. `primary` ist der große in der Mitte.
 *
 * `isFocused` und `primary` sind absichtlich getrennt: Der eine Zustand sagt
 * „hier bist du", der andere „das ist der Weg nach Hause". Wären sie dasselbe,
 * würde Home beim Wechsel auf einen anderen Tab schrumpfen.
 */
export function TabButton({ children, isFocused, primary, ...props }: TabTriggerSlotProps & { primary?: boolean }) {
  return (
    <Pressable {...props} style={({ pressed }) => [styles.slot, pressed && styles.pressed]}>
      <ThemedView
        type={isFocused ? 'backgroundSelected' : 'backgroundElement'}
        style={[styles.tabButtonView, primary && styles.tabButtonPrimary]}>
        <ThemedText
          type={primary ? 'default' : 'small'}
          style={primary ? styles.primaryLabel : undefined}
          themeColor={primary ? 'tint' : isFocused ? 'text' : 'textSecondary'}>
          {children}
        </ThemedText>
      </ThemedView>
    </Pressable>
  );
}

export function CustomTabList(props: TabListProps) {
  return (
    <View {...props} style={styles.tabListContainer}>
      <ThemedView type="backgroundElement" style={styles.innerContainer}>
        <ThemedText type="smallBold" style={styles.brandText}>
          GÖ4Fun
        </ThemedText>

        {props.children}

        {/* Gegengewicht zur Wortmarke: ohne diese leere Spalte wären es sechs
            Spalten, und die Mitte läge zwischen Home und Aktivitäten. */}
        <View style={styles.slot} />
      </ThemedView>
    </View>
  );
}

const styles = StyleSheet.create({
  tabListContainer: {
    position: 'absolute',
    width: '100%',
    padding: Spacing.three,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
  },
  innerContainer: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.five,
    borderRadius: Spacing.five,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexGrow: 1,
    gap: Spacing.two,
    maxWidth: MaxContentWidth,
  },
  brandText: {
    // Eine Spalte wie jeder Eintrag – siehe die Erklärung oben.
    flex: 1,
  },
  /** Eine der sieben gleich breiten Spalten. */
  slot: { flex: 1, alignItems: 'center' },
  pressed: {
    opacity: 0.7,
  },
  tabButtonView: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  tabButtonPrimary: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.five,
    borderRadius: Spacing.four,
  },
  primaryLabel: { fontWeight: '700' },
});
