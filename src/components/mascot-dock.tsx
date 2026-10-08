/**
 * Goenni als Begleiter: Er sitzt unten über der Tab-Leiste und läuft mit.
 *
 * ## Was er tut
 *
 * Er SPRICHT NUR, WENN MAN IHN ANTIPPT – nie von selbst, nie beim Scrollen oder
 * Tab-Wechsel (Nutzerwunsch: ungefragtes Reden störte). Von selbst zeigt er nur
 * selten ein ruhiges Kunststück, damit er lebt.
 *
 *  - **Antippen:** Kunststück und ein Satz – der nächste Tipp zum Tab
 *    (`sceneLines`, src/domain/mascot-lines.ts), jedes dritte Mal etwas Freches.
 *  - **Etwas Wichtiges** (ungelesene Nachrichten, Ticket läuft bald ab, eine
 *    Nachricht über `useMascotDock().say` wie nach einem Credit-Kauf): Ein
 *    kleines Sprechblasen-Abzeichen zeigt, dass sich Antippen lohnt; das
 *    nächste Antippen sagt genau das.
 *  - **Festhalten:** Er duckt sich hinter die Leiste, nur die Antenne schaut
 *    heraus. Antippen holt ihn zurück.
 *
 * ## Wann er nicht da ist
 *
 *  - In den Einstellungen abgeschaltet („Goenni als Begleiter").
 *  - Wenn ein Bildschirm ihn ausblendet (`useDockSuppression`): auf der
 *    Startseite, solange Goenni im Kopf schon zu sehen ist; auf der Karte,
 *    solange unten ein Partner-Blatt offen ist.
 *
 * Der Provider liegt im Root-Layout (damit auch das Credits-Blatt `say` rufen
 * kann), die Figur selbst nur in den Tabs (src/components/app-tabs.tsx).
 *
 * ## Ruhig bleiben
 *
 * Er begleitet, er soll nicht zappeln: Die Blase hat eine feste Breite (sonst
 * springt ihr Rand mit jedem Satz) und blendet sanft ein statt hereinzufedern.
 * Kunststücke von selbst kommen selten und nur die ruhigen.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, { Easing, FadeIn, FadeOut, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

import { Mascot, type MascotMood, type MascotTrick } from '@/components/mascot';
import { useSeason } from '@/components/seasonal-decor';
import { Icon } from '@/components/ui/icon';
import { PressableScale } from '@/components/ui/pressable-scale';
import { FontFamily, Radius, Spacing, Stroke } from '@/constants/theme';
import { nextExpiring } from '@/domain/booking-status';
import { BACK_LINE, DUCK_LINE, pokeLine, sceneLines, type MascotScene } from '@/domain/mascot-lines';
import { pokeReaction } from '@/domain/mascot-mood';
import { tipAt, type Tip } from '@/domain/mascot-tips';
import { useTheme } from '@/hooks/use-theme';
import { useAppSettings } from '@/lib/app-settings';
import { useAuth } from '@/lib/auth-context';
import * as haptics from '@/lib/haptics';
import { useMarket } from '@/lib/market-context';
import { useResolvedScheme } from '@/lib/theme-preference';

/** Größe der Figur im Dock. */
const SIZE = 58;

/** So lange steht ein Satz. */
const BUBBLE_MS = 5600;

/** Abstand zwischen zwei kleinen Kunststücken von selbst. */
const IDLE_TRICK_MS = 14_000;

/** Ruhige Kunststücke für zwischendurch – Salto und Tanz gibt es nur aufs Antippen. */
const CALM_TRICKS: readonly MascotTrick[] = ['hop', 'wave', 'hop', 'wiggle'];

type Message = { tip: Tip; trick: MascotTrick; key: number };

type DockValue = {
  scene: MascotScene;
  setScene: (scene: MascotScene) => void;
  /** Ein Bildschirm blendet den Begleiter aus (an) oder gibt ihn wieder frei (aus). */
  suppress: (key: string, on: boolean) => void;
  suppressed: boolean;
  /** Goenni etwas sagen lassen – mit Kunststück. */
  say: (tip: Tip, trick?: MascotTrick) => void;
  message: Message | null;
};

const DockContext = createContext<DockValue | null>(null);

const NOOP: DockValue = { scene: 'home', setScene: () => {}, suppress: () => {}, suppressed: false, say: () => {}, message: null };

export function useMascotDock(): DockValue {
  return useContext(DockContext) ?? NOOP;
}

/** Den Begleiter ausblenden, solange `active` gilt. `key` unterscheidet die Gründe. */
export function useDockSuppression(key: string, active: boolean) {
  const { suppress } = useMascotDock();
  useEffect(() => {
    suppress(key, active);
    return () => suppress(key, false);
  }, [key, active, suppress]);
}

export function MascotDockProvider({ children }: { children: ReactNode }) {
  const [scene, setScene] = useState<MascotScene>('home');
  const [reasons, setReasons] = useState<Record<string, true>>({});
  const [message, setMessage] = useState<Message | null>(null);
  const counter = useRef(0);

  const suppress = useCallback((key: string, on: boolean) => {
    setReasons((prev) => {
      if (on === !!prev[key]) return prev;
      const next = { ...prev };
      if (on) next[key] = true;
      else delete next[key];
      return next;
    });
  }, []);

  const say = useCallback((tip: Tip, trick: MascotTrick = 'cheer') => {
    counter.current += 1;
    setMessage({ tip, trick, key: counter.current });
  }, []);

  const suppressed = Object.keys(reasons).length > 0;
  const value = useMemo(() => ({ scene, setScene, suppress, suppressed, say, message }), [scene, suppress, suppressed, say, message]);

  return <DockContext.Provider value={value}>{children}</DockContext.Provider>;
}

/** Die Figur im Dock. `bottom` = Höhe der Tab-Leiste; `side` = an welcher Kante. */
export function MascotDock({ bottom }: { bottom: number }) {
  const colors = useTheme();
  const reduced = useReducedMotion();
  const { settings } = useAppSettings();
  const dock = useMascotDock();
  const { user } = useAuth();
  const market = useMarket();
  const season = useSeason();
  const night = useResolvedScheme() === 'dark';

  const [bubble, setBubble] = useState<{ tip: Tip; key: number } | null>(null);
  const [ducked, setDucked] = useState(false);
  const [pokes, setPokes] = useState(0);
  const [trick, setTrick] = useState<MascotTrick>('hop');
  const [trickKey, setTrickKey] = useState(0);
  const [excited, setExcited] = useState<MascotMood | null>(null);
  const steps = useRef<Partial<Record<MascotScene, number>>>({});
  const bubbleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const moodTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bubbleCount = useRef(0);
  /** Welche Nachricht von außen schon gesagt wurde. */
  const [readMessage, setReadMessage] = useState(0);
  /** Welche wichtigen Sätze (je Tab) schon gesagt wurden – dann kein Abzeichen mehr. */
  const [readImportant, setReadImportant] = useState<string[]>([]);
  const { width: screenWidth } = useWindowDimensions();
  /** Feste Breite: Sonst wechselt der Rand der Blase mit jedem Satz. */
  const bubbleWidth = Math.min(250, screenWidth - SIZE - Spacing.two * 2 - 12);

  const hidden = !settings.mascotCompanion || dock.suppressed;
  const side = dock.scene === 'map' ? 'left' : 'right';

  // Kein useMemo: Der React Compiler merkt sich das selbst.
  const now = new Date();
  const expiring = nextExpiring(market.bookings, now);
  const lines = sceneLines(dock.scene, {
    firstName: user?.name?.split(' ')[0] ?? null,
    groups: market.groups.length,
    unread: market.groups.reduce((sum, g) => sum + g.unread, 0),
    openBookings: market.bookings.filter((b) => b.status === 'confirmed').length,
    nextExpiry: expiring ? { title: expiring.booking.offer_title, days: expiring.info.days } : null,
    credits: user?.credits_balance ?? 0,
    stampsRemaining: market.club?.stamps?.remaining ?? 10,
    rewardCredits: market.club?.stamps?.reward_credits ?? 100,
    season: season.key,
    weekday: now.getDay(),
    hour: now.getHours(),
  });

  const show = useCallback((tip: Tip, ms = BUBBLE_MS) => {
    bubbleCount.current += 1;
    setBubble({ tip, key: bubbleCount.current });
    if (bubbleTimer.current) clearTimeout(bubbleTimer.current);
    bubbleTimer.current = setTimeout(() => setBubble(null), ms);
  }, []);

  const perform = useCallback((next: MascotTrick) => {
    setTrick(next);
    setTrickKey((k) => k + 1);
  }, []);

  /** Kurz ein anderes Gesicht zeigen – zum Kunststück passend. */
  const react = useCallback((mood: MascotMood = 'cheer') => {
    setExcited(mood);
    if (moodTimer.current) clearTimeout(moodTimer.current);
    moodTimer.current = setTimeout(() => setExcited(null), 1700);
  }, []);

  useEffect(
    () => () => {
      if (bubbleTimer.current) clearTimeout(bubbleTimer.current);
      if (moodTimer.current) clearTimeout(moodTimer.current);
    },
    [],
  );

  // Selten ein kleines Kunststück, damit er lebt – ohne zu zappeln.
  useEffect(() => {
    if (hidden || ducked || reduced) return;
    let n = 0;
    const timer = setInterval(() => {
      perform(CALM_TRICKS[n % CALM_TRICKS.length]);
      n += 1;
    }, IDLE_TRICK_MS);
    return () => clearInterval(timer);
  }, [hidden, ducked, reduced, perform]);

  // Was auf das nächste Antippen wartet: erst eine Nachricht von außen (z. B. Kauf),
  // dann ein wichtiger Satz zu diesem Tab (ungelesen, Ticket läuft ab).
  const message = dock.message && dock.message.key !== readMessage ? dock.message : null;
  const urgent = dock.scene === 'groups' ? market.groups.some((g) => g.unread > 0) : dock.scene === 'bookings' || dock.scene === 'home' ? expiring?.info.tone === 'urgent' : false;
  const importantKey = urgent && lines[0] ? `${dock.scene}:${lines[0].line}` : null;
  const important = importantKey && !readImportant.includes(importantKey) ? lines[0] : null;
  const hasNews = !hidden && !ducked && (message !== null || important !== null);

  const poke = () => {
    haptics.press();
    if (ducked) {
      setDucked(false);
      show(BACK_LINE, 2600);
      perform('flip');
      react('cheer');
      return;
    }
    if (message) {
      setReadMessage(message.key);
      show(message.tip, 6500);
      perform(message.trick);
      react('cheer');
      return;
    }
    if (important && importantKey) {
      setReadImportant((prev) => [...prev, importantKey]);
      show(important, 6000);
      perform('hop');
      return;
    }
    const count = pokes + 1;
    setPokes(count);
    if (count % 3 === 0) {
      show(pokeLine(count / 3), 4200);
    } else {
      const step = steps.current[dock.scene] ?? 0;
      steps.current[dock.scene] = step + 1;
      show(tipAt(lines, step), 5200);
    }
    const reaction = pokeReaction(count);
    perform(reaction.trick);
    react(reaction.mood);
  };

  const duck = () => {
    if (ducked) return;
    haptics.tap();
    show(DUCK_LINE, 2400);
    perform('wave');
    setTimeout(() => {
      setBubble(null);
      setDucked(true);
    }, 1300);
  };

  // Auftauchen/Abtauchen und Ducken.
  const visible = useSharedValue(0);
  const down = useSharedValue(0);
  useEffect(() => {
    visible.set(reduced ? (hidden ? 0 : 1) : hidden ? withTiming(0, { duration: 200 }) : withSpring(1, { damping: 13, stiffness: 160 }));
  }, [hidden, reduced, visible]);
  useEffect(() => {
    down.set(reduced ? (ducked ? 1 : 0) : withTiming(ducked ? 1 : 0, { duration: 380, easing: Easing.inOut(Easing.cubic) }));
  }, [ducked, reduced, down]);

  const figureStyle = useAnimatedStyle(() => ({
    opacity: visible.value,
    transform: [{ translateY: (1 - visible.value) * (SIZE + 40) + down.value * SIZE * 0.66 }],
  }));

  const bubbleTip = bubble && !hidden && !ducked ? bubble : null;

  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrap, { bottom: bottom - 2, flexDirection: side === 'right' ? 'row' : 'row-reverse' }]}>
      {bubbleTip ? (
        <Animated.View
          key={bubbleTip.key}
          entering={reduced ? undefined : FadeIn.duration(220)}
          exiting={reduced ? undefined : FadeOut.duration(180)}
          style={[styles.bubbleSlot, { width: bubbleWidth }, side === 'right' ? styles.bubbleSlotRight : styles.bubbleSlotLeft]}>
          <PressableScale
            onPress={() => setBubble(null)}
            haptic="none"
            scaleTo={0.97}
            accessibilityRole="button"
            accessibilityLabel={`Goenni sagt: ${bubbleTip.tip.line}. Antippen zum Schließen.`}
            style={[styles.bubble, { backgroundColor: night ? '#2a0c47' : colors.background, borderColor: night ? 'rgba(255,255,255,0.25)' : colors.borderStrong }]}>
            <Text style={[styles.bubbleText, { color: night ? '#ffffff' : colors.text }]} numberOfLines={3}>
              {bubbleTip.tip.line}
            </Text>
          </PressableScale>
          <View
            style={[
              styles.tail,
              side === 'right' ? styles.tailRight : styles.tailLeft,
              { backgroundColor: night ? '#2a0c47' : colors.background, borderColor: night ? 'rgba(255,255,255,0.25)' : colors.borderStrong },
            ]}
          />
        </Animated.View>
      ) : null}

      <Animated.View style={figureStyle} pointerEvents={hidden ? 'none' : 'auto'}>
        <PressableScale
          onPress={poke}
          onLongPress={duck}
          delayLongPress={450}
          haptic="none"
          scaleTo={0.92}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={
            ducked ? 'Goenni zurückholen' : `Goenni antippen${hasNews ? ' – er hat dir etwas zu sagen' : ''}. Gedrückt halten, damit er Pause macht.`
          }>
          <Mascot
            mood={excited ?? (ducked ? 'idle' : bubbleTip?.tip.mood ?? 'happy')}
            size={SIZE}
            lively={false}
            trick={trick}
            trickKey={trickKey}
            waves={excited !== null}
          />
          {/* Er hat etwas zu sagen – aber nur, wenn man ihn fragt. */}
          {hasNews ? (
            <View style={[styles.news, { backgroundColor: colors.tint, borderColor: colors.background }]}>
              <Icon name="chat" size={11} color="#ffffff" />
            </View>
          ) : null}
        </PressableScale>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: Spacing.two,
    right: Spacing.two,
    alignItems: 'flex-end',
    // Packt Figur (und Blase davor) an die gewählte Kante – bei row-reverse links.
    justifyContent: 'flex-end',
  },
  bubbleSlot: { marginBottom: SIZE * 0.42 },
  bubbleSlotRight: { marginRight: 4 },
  bubbleSlotLeft: { marginLeft: 4 },
  bubble: {
    borderWidth: Stroke,
    borderRadius: Radius.card,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    shadowColor: '#1c0833',
    shadowOpacity: 0.16,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  bubbleText: { fontFamily: FontFamily.semibold, fontSize: 13.5, lineHeight: 18 },
  news: { position: 'absolute', top: 2, right: 0, width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  /** Das Spitzchen zur Figur hin. */
  tail: { position: 'absolute', bottom: 12, width: 12, height: 12, transform: [{ rotate: '45deg' }] },
  tailRight: { right: -5, borderTopWidth: Stroke, borderRightWidth: Stroke },
  tailLeft: { left: -5, borderBottomWidth: Stroke, borderLeftWidth: Stroke },
});
