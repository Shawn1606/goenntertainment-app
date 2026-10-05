import { LinearGradient } from 'expo-linear-gradient';
import { Tabs, TabList, TabSlot, TabTrigger, type TabListProps, type TabTriggerSlotProps } from 'expo-router/ui';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/ui/icon';
import { BrandGradient, FontFamily, Spacing, Stroke } from '@/constants/theme';
import type { UiIconName } from '@/domain/ui-icon';
import { useTheme } from '@/hooks/use-theme';
import * as feedback from '@/lib/feedback';

/**
 * Die untere Leiste – drei Ziele, mehr nicht:
 *
 *   Home  ·  ( Finden )  ·  Karte
 *
 * ## Warum nur drei
 *
 * Die App hat eine Aufgabe: etwas finden, das zu uns passt, und hingehen. Alles
 * andere (Buchungen, Gruppen, Credits, Stempel, Konto) hängt an der Startseite
 * oder in der Kopfzeile. Weniger Symbole heißt: Man muss nie überlegen, wo etwas
 * ist.
 *
 * ## Warum „Finden" in der Mitte heraussticht
 *
 * Der Gruppen-Finder ist der Kern: Wie viele seid ihr, wie alt, was wollt ihr
 * ausgeben – und die App sagt, was passt. Er sitzt deshalb als runder
 * Verlaufsknopf erhöht in der Mitte, genau dort, wo der Daumen ohnehin liegt.
 *
 * Eigene Leiste statt der nativen: Nur so lässt sich der Mittelknopf erhöht und
 * im Markenverlauf zeichnen, und iOS, Android und Web sehen gleich aus.
 */
type TabDef = {
  name: string;
  href: '/' | '/finder' | '/map';
  label: string;
  icon: UiIconName;
};

const TABS: TabDef[] = [
  { name: 'index', href: '/', label: 'Home', icon: 'home' },
  { name: 'finder', href: '/finder', label: 'Finden', icon: 'search' },
  { name: 'map', href: '/map', label: 'Karte', icon: 'map' },
];

export default function AppTabs() {
  return (
    <Tabs style={styles.root} options={{ backBehavior: 'history' }}>
      <TabSlot style={styles.slot} />
      <TabList asChild>
        <BottomBar>
          {TABS.map((tab) => (
            <TabTrigger key={tab.name} name={tab.name} href={tab.href} asChild>
              <TabButton tab={tab} />
            </TabTrigger>
          ))}
        </BottomBar>
      </TabList>
    </Tabs>
  );
}

function TabButton({ tab, isFocused, onPress, ...props }: TabTriggerSlotProps & { tab: TabDef }) {
  const colors = useTheme();
  const color = isFocused ? colors.text : colors.textSecondary;
  const center = tab.name === 'finder';

  return (
    <Pressable
      {...props}
      onPress={(event) => {
        if (!isFocused) feedback.selected();
        onPress?.(event);
      }}
      accessibilityRole="tab"
      accessibilityLabel={center ? 'Finden: was passt zu uns?' : tab.label}
      accessibilityState={{ selected: !!isFocused }}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
      {center ? (
        <View style={styles.centerSlot}>
          <LinearGradient
            colors={[...BrandGradient]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.centerButton, { borderColor: colors.background }, isFocused && styles.centerFocused]}>
            <Icon name="search" size={26} color="#ffffff" />
          </LinearGradient>
        </View>
      ) : (
        <View style={styles.iconSlot}>
          <Icon name={tab.icon} size={26} color={color} />
        </View>
      )}
      <Text
        style={[
          styles.label,
          { color: center ? (isFocused ? colors.tint : colors.text) : color, fontFamily: isFocused || center ? FontFamily.bold : FontFamily.medium },
        ]}
        numberOfLines={1}>
        {tab.label}
      </Text>
    </Pressable>
  );
}

function BottomBar(props: TabListProps) {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      {...props}
      style={[
        styles.bar,
        {
          backgroundColor: colors.background,
          borderTopColor: colors.border,
          paddingBottom: Math.max(insets.bottom, Spacing.two),
        },
      ]}>
      <View style={styles.inner}>{props.children}</View>
    </View>
  );
}

const CENTER = 58;

const styles = StyleSheet.create({
  root: { flex: 1 },
  slot: { flex: 1 },
  bar: { borderTopWidth: Stroke, paddingTop: Spacing.one + 2, alignItems: 'center' },
  inner: { flexDirection: 'row', width: '100%', maxWidth: 520, alignSelf: 'center' },
  button: { flex: 1, alignItems: 'center', gap: 3, paddingVertical: Spacing.one },
  iconSlot: { height: 32, alignItems: 'center', justifyContent: 'center' },
  /** Gleiche Höhe wie die anderen – der Knopf ragt nach OBEN hinaus, die Beschriftungen bleiben auf einer Linie. */
  centerSlot: { height: 32, alignItems: 'center', justifyContent: 'flex-end' },
  centerButton: {
    width: CENTER,
    height: CENTER,
    borderRadius: CENTER / 2,
    borderWidth: 4,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: -4,
    shadowColor: '#dd2a7b',
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  centerFocused: { transform: [{ scale: 1.05 }] },
  pressed: { opacity: 0.7 },
  label: { fontSize: 11.5 },
});

