import { Tabs, TabList, TabTrigger, TabSlot, type TabTriggerSlotProps, type TabListProps } from 'expo-router/ui';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/ui/icon';
import { FontFamily, MaxContentWidth, Spacing } from '@/constants/theme';
import type { UiIconName } from '@/domain/ui-icon';
import { useTheme } from '@/hooks/use-theme';

/**
 * Untere Leiste im Web – dieselben fünf Ziele wie am Handy (siehe app-tabs.tsx).
 *
 * Im Browser gibt es keine native Leiste, also bauen wir sie nach: Symbol über
 * Beschriftung, aktiv = kräftige Farbe und fettere Schrift. Früher lag hier eine
 * schwebende Pille OBEN über dem Inhalt; sie verdeckte bei breitem Fenster den
 * Konto-Knopf, der dann nicht mehr anklickbar war. Jetzt steht die Leiste im
 * normalen Fluss unter dem Inhalt und kann nichts mehr verdecken.
 */
const TABS: { name: string; href: '/' | '/map' | '/create' | '/friends' | '/me'; label: string; icon: UiIconName }[] = [
  { name: 'index', href: '/', label: 'Home', icon: 'home' },
  { name: 'map', href: '/map', label: 'Karte', icon: 'map' },
  { name: 'create', href: '/create', label: 'Erstellen', icon: 'plus-square' },
  { name: 'friends', href: '/friends', label: 'Freunde', icon: 'users' },
  { name: 'me', href: '/me', label: 'Profil', icon: 'user' },
];

export default function AppTabs() {
  return (
    <Tabs style={styles.root}>
      <TabSlot style={styles.slot} />
      <TabList asChild>
        <BottomBar>
          {TABS.map((tab) => (
            <TabTrigger key={tab.name} name={tab.name} href={tab.href} asChild>
              <TabButton icon={tab.icon} accent={tab.name === 'create'}>
                {tab.label}
              </TabButton>
            </TabTrigger>
          ))}
        </BottomBar>
      </TabList>
    </Tabs>
  );
}

function TabButton({
  children,
  isFocused,
  icon,
  accent,
  ...props
}: TabTriggerSlotProps & { icon: UiIconName; accent?: boolean }) {
  const colors = useTheme();
  const color = accent ? colors.tint : isFocused ? colors.text : colors.textSecondary;
  return (
    <Pressable
      {...props}
      accessibilityRole="tab"
      accessibilityState={{ selected: !!isFocused }}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
      <Icon name={icon} size={26} color={color} />
      <Text
        style={[
          styles.label,
          { color, fontFamily: isFocused ? FontFamily.bold : FontFamily.medium },
        ]}>
        {children}
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
          borderTopColor: colors.backgroundSelected,
          paddingBottom: Math.max(insets.bottom, Spacing.two),
        },
      ]}>
      <View style={styles.inner}>{props.children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  slot: { flex: 1 },
  bar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.two,
    alignItems: 'center',
  },
  inner: {
    flexDirection: 'row',
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  button: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
    paddingVertical: Spacing.one,
  },
  pressed: { opacity: 0.6 },
  label: { fontSize: 11 },
});
