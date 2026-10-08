import { LinearGradient } from 'expo-linear-gradient';
import { Tabs, TabList, TabSlot, TabTrigger, type TabListProps, type TabTriggerSlotProps } from 'expo-router/ui';
import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MascotDock, useMascotDock } from '@/components/mascot-dock';
import { Icon } from '@/components/ui/icon';
import { BrandGradient, FontFamily, Spacing, Stroke } from '@/constants/theme';
import { nextExpiring } from '@/domain/booking-status';
import type { MascotScene } from '@/domain/mascot-lines';
import type { UiIconName } from '@/domain/ui-icon';
import { useTheme } from '@/hooks/use-theme';
import * as feedback from '@/lib/feedback';
import { useMarket } from '@/lib/market-context';

/**
 * Die untere Leiste – fünf Ziele:
 *
 *   Home  ·  Gruppen  ·  ( Entdecken )  ·  Tickets  ·  Karte
 *
 * ## Warum Gruppen und Tickets eigene Tabs sind
 *
 * Vorher hingen beide am Konto (Profilbild → Konto → Gruppen). So fand man sie
 * nicht: Gruppen sind der Grund für den Rabatt, Tickets das, was man beim
 * Partner vorzeigt – beides gehört mit einem Tipp erreichbar in die Leiste.
 * Gruppen zeigen Ungelesenes als Zahl, Tickets einen Punkt, wenn eins bald
 * verfällt.
 *
 * ## Warum „Entdecken" in der Mitte heraussticht
 *
 * Der Finder ist der Kern: Wie viele seid ihr, was wollt ihr – und die App sagt,
 * was passt. Er sitzt als runder Verlaufsknopf erhöht in der Mitte, genau dort,
 * wo der Daumen liegt.
 *
 * ## Der Wechsel
 *
 * Tabs gleiten seitlich hinein und hinaus wie Seiten (`SlidingSlot`): nach
 * rechts, wenn das Ziel rechts liegt, sonst nach links. So sieht man, wohin man
 * „gegangen" ist. Bei „Bewegung reduzieren" wechselt der Inhalt sofort.
 *
 * Über der Leiste sitzt Goenni als Begleiter (src/components/mascot-dock.tsx).
 *
 * Eigene Leiste statt der nativen: Nur so lässt sich der Mittelknopf erhöht und
 * im Markenverlauf zeichnen, und iOS, Android und Web sehen gleich aus.
 */
type TabName = 'index' | 'groups' | 'finder' | 'bookings' | 'map';

type TabDef = {
  name: TabName;
  href: '/' | '/groups' | '/finder' | '/bookings' | '/map';
  label: string;
  icon: UiIconName;
};

const TABS: TabDef[] = [
  { name: 'index', href: '/', label: 'Home', icon: 'home' },
  { name: 'groups', href: '/groups', label: 'Gruppen', icon: 'users' },
  { name: 'finder', href: '/finder', label: 'Entdecken', icon: 'compass' },
  { name: 'bookings', href: '/bookings', label: 'Tickets', icon: 'ticket' },
  { name: 'map', href: '/map', label: 'Karte', icon: 'map' },
];

const SCENE: Record<string, MascotScene> = { index: 'home', groups: 'groups', finder: 'finder', bookings: 'bookings', map: 'map' };

/** Grobe Höhe der Leiste, bis sie gemessen ist. */
const BAR_ESTIMATE = 62;

export default function AppTabs() {
  const insets = useSafeAreaInsets();
  const [barHeight, setBarHeight] = useState(BAR_ESTIMATE + Math.max(insets.bottom, Spacing.two));

  return (
    <Tabs style={styles.root} options={{ backBehavior: 'history' }}>
      <SlidingSlot />
      {/* Vor der Leiste gezeichnet: Beim Ducken verschwindet Goenni HINTER ihr. */}
      <MascotDock bottom={barHeight} />
      <TabList asChild>
        <BottomBar onHeight={setBarHeight}>
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

/* ============================================================ Übergang */

type Motion = {
  from: SharedValue<number>;
  to: SharedValue<number>;
  progress: SharedValue<number>;
  /** Welcher Tab zuletzt vorn war – −1 bis zum ersten. */
  current: SharedValue<number>;
  width: number;
};

const MotionContext = createContext<Motion | null>(null);

/**
 * Der Inhalt der Tabs, jeder als eigene Seite übereinander. Beim Wechsel
 * schieben sich alte und neue Seite gemeinsam zur Seite (wie ein Blättern);
 * alle übrigen liegen unsichtbar außerhalb.
 */
function SlidingSlot() {
  const { width } = useWindowDimensions();
  const from = useSharedValue(0);
  const to = useSharedValue(0);
  const progress = useSharedValue(1);
  const current = useSharedValue(-1);

  return (
    <MotionContext.Provider value={{ from, to, progress, current, width }}>
      <TabSlot
        style={styles.slot}
        detachInactiveScreens={false}
        renderFn={(descriptor, { index, isFocused, loaded }) => {
          if (!loaded && !isFocused) return null;
          return (
            <TabPane key={descriptor.route.key} index={index} name={descriptor.route.name} focused={isFocused}>
              {descriptor.render()}
            </TabPane>
          );
        }}
      />
    </MotionContext.Provider>
  );
}

function TabPane({ index, name, focused, children }: { index: number; name: string; focused: boolean; children: ReactNode }) {
  const motion = useContext(MotionContext)!;
  const reduced = useReducedMotion();
  const dock = useMascotDock();
  const { from, to, progress, current, width } = motion;

  useLayoutEffect(() => {
    if (!focused) return;
    const previous = current.get();
    current.set(index);
    if (previous < 0 || previous === index || reduced) {
      from.set(index);
      to.set(index);
      progress.set(1);
    } else {
      from.set(previous);
      to.set(index);
      progress.set(0);
      progress.set(withTiming(1, { duration: 320, easing: Easing.out(Easing.cubic) }));
    }
    dock.setScene(SCENE[name] ?? 'home');
    // Nur beim Fokuswechsel – die Werte selbst sind stabil.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused]);

  const style = useAnimatedStyle(() => {
    const a = from.value;
    const b = to.value;
    const p = progress.value;
    const dir = b >= a ? 1 : -1;
    if (index === b) return { opacity: 1, transform: [{ translateX: (1 - p) * dir * width }] };
    if (index === a && p < 1) return { opacity: 1 - p * 0.35, transform: [{ translateX: -p * dir * width }] };
    return { opacity: 0, transform: [{ translateX: width * 2 }] };
  });

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, style]}
      pointerEvents={focused ? 'auto' : 'none'}
      accessibilityElementsHidden={!focused}
      importantForAccessibility={focused ? 'auto' : 'no-hide-descendants'}>
      {children}
    </Animated.View>
  );
}

/* ============================================================ Leiste */

function TabButton({ tab, isFocused, onPress, ...props }: TabTriggerSlotProps & { tab: TabDef }) {
  const colors = useTheme();
  const market = useMarket();
  const color = isFocused ? colors.tint : colors.textSecondary;
  const center = tab.name === 'finder';

  const unread = market.groups.reduce((sum, g) => sum + g.unread, 0);
  const expiring = nextExpiring(market.bookings, new Date());
  const badge = tab.name === 'groups' && unread > 0 ? (unread > 9 ? '9+' : String(unread)) : null;
  /** Punkt statt Zahl: „da läuft bald etwas ab" – die Zahl steht auf dem Ticket. */
  const dot = tab.name === 'bookings' && expiring?.info.tone === 'urgent';

  return (
    <Pressable
      {...props}
      onPress={(event) => {
        if (!isFocused) feedback.selected();
        onPress?.(event);
      }}
      accessibilityRole="tab"
      accessibilityLabel={center ? 'Entdecken: was passt zu uns?' : `${tab.label}${badge ? `, ${badge} neu` : ''}${dot ? ', ein Ticket verfällt bald' : ''}`}
      accessibilityState={{ selected: !!isFocused }}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
      {center ? (
        <View style={styles.centerSlot}>
          <LinearGradient
            colors={[...BrandGradient]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.centerButton, { borderColor: colors.background }, isFocused && styles.centerFocused]}>
            <Icon name="compass" size={27} color="#ffffff" />
          </LinearGradient>
        </View>
      ) : (
        <View style={styles.iconSlot}>
          {/* Aktiver Tab: getönte Pille hinter dem Symbol – man sieht sofort, wo man ist. */}
          <View style={[styles.pill, isFocused && { backgroundColor: colors.backgroundSelected }]}>
            <Icon name={tab.icon} size={24} color={color} />
          </View>
          {badge ? (
            <View style={[styles.badge, { backgroundColor: colors.tint, borderColor: colors.background }]}>
              <Text style={styles.badgeText}>{badge}</Text>
            </View>
          ) : null}
          {dot ? <View style={[styles.dot, { borderColor: colors.background }]} /> : null}
        </View>
      )}
      <Text
        style={[
          styles.label,
          { color: center ? (isFocused ? colors.tint : colors.text) : isFocused ? colors.text : colors.textSecondary, fontFamily: isFocused || center ? FontFamily.bold : FontFamily.medium },
        ]}
        numberOfLines={1}>
        {tab.label}
      </Text>
    </Pressable>
  );
}

function BottomBar({ onHeight, ...props }: TabListProps & { onHeight: (height: number) => void }) {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      {...props}
      onLayout={(event: LayoutChangeEvent) => onHeight(Math.round(event.nativeEvent.layout.height))}
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
  slot: { flex: 1, overflow: 'hidden' },
  bar: { borderTopWidth: Stroke, paddingTop: Spacing.one + 2, alignItems: 'center' },
  inner: { flexDirection: 'row', width: '100%', maxWidth: 560, alignSelf: 'center' },
  button: { flex: 1, alignItems: 'center', gap: 3, paddingVertical: Spacing.one },
  iconSlot: { height: 32, alignItems: 'center', justifyContent: 'center' },
  pill: { width: 48, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
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
  centerFocused: { transform: [{ scale: 1.06 }] },
  pressed: { opacity: 0.7 },
  label: { fontSize: 11 },
  badge: {
    position: 'absolute',
    top: -3,
    right: -2,
    minWidth: 19,
    height: 19,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: { color: '#ffffff', fontFamily: FontFamily.bold, fontSize: 10 },
  dot: { position: 'absolute', top: 0, right: 6, width: 11, height: 11, borderRadius: 6, borderWidth: 2, backgroundColor: '#f59e0b' },
});
