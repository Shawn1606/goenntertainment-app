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
 *    Nachricht über `useDockActions().say` wie nach einem Credit-Kauf): Ein
 *    kleines Sprechblasen-Abzeichen zeigt, dass sich Antippen lohnt; das
 *    nächste Antippen sagt genau das.
 *  - **Festhalten:** Er duckt sich hinter die Leiste, nur die Antenne schaut
 *    heraus. Antippen holt ihn zurück.
 *
 * ## In die Ecke (Nutzerwunsch Okt. 2026)
 *
 * Nach `TUCK_AFTER_MS` Ruhe verschwindet er von selbst unten in seiner Ecke:
 * leicht schräg hinter die Leiste, nur Antenne und Hut schauen heraus. Antippen
 * holt ihn hervor; etwas Neues zeigt sein Abzeichen auch aus der Ecke heraus.
 *
 * ## Der Flug (Nutzerwunsch Okt. 2026)
 *
 * Wer auf einer Tab-Seite ganz schnell nach unten scrollt (`useDockScroll`),
 * wirft ihn hoch: Er fliegt mit dem Schwung nach oben, überschlägt sich, fällt
 * wieder herunter und landet mit einem Wackler – je schneller gescrollt, desto
 * höher (`flightHeight`, src/domain/gestures.ts). Er sagt dabei nichts; wer ihn
 * kurz danach antippt, hört, wie es war (`flightLine`).
 *
 * ## Wann er nicht da ist
 *
 *  - In den Einstellungen abgeschaltet („Goenni als Begleiter").
 *  - Wenn ein Bildschirm ihn ausblendet (`useDockSuppression`): auf der
 *    Startseite, solange Goenni im Kopf schon zu sehen ist; auf der Karte.
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
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { Mascot, type MascotMood, type MascotTrick } from '@/components/mascot';
import { useSeason } from '@/components/seasonal-decor';
import { Icon } from '@/components/ui/icon';
import { MotionPause } from '@/components/ui/motion-pause';
import { PressableScale } from '@/components/ui/pressable-scale';
import { FontFamily, Radius, Spacing, Stroke } from '@/constants/theme';
import { nextExpiring } from '@/domain/booking-status';
import { flightHeight, isFastScrollDown, scrollSpeed, type ScrollSample } from '@/domain/gestures';
import { BACK_LINE, DUCK_LINE, flightLine, pokeLine, sceneLines, type MascotScene } from '@/domain/mascot-lines';
import { pokeReaction } from '@/domain/mascot-mood';
import { tipAt, type Tip } from '@/domain/mascot-tips';
import { useTheme } from '@/hooks/use-theme';
import { useNow } from '@/hooks/use-now';
import { useAppSettings } from '@/lib/app-settings';
import { useAuth } from '@/lib/auth-context';
import * as haptics from '@/lib/haptics';
import { useMarket } from '@/lib/market-context';
import { useResolvedScheme } from '@/lib/theme-preference';

/** Größe der Figur im Dock. */
const SIZE = 58;

/** So lange steht ein Satz. */
const BUBBLE_MS = 5600;

/**
 * Nach so langer Ruhe zeigt er von selbst ein kleines Kunststück – EINES, bevor er
 * in die Ecke abtaucht (`TUCK_AFTER_MS`). Länger als das Abtauchen kam es nie dran.
 */
const IDLE_TRICK_MS = 6000;

/** Nach so langer Ruhe verschwindet Goenni von selbst in seiner Ecke. */
const TUCK_AFTER_MS = 9000;

/** So weit taucht er in der Ecke ab (Anteil seiner Größe) – Antenne und Hut bleiben sichtbar. */
const TUCK_DEPTH = 0.66;

/** Mindestabstand zwischen zwei Flügen: Ein Schwung, ein Flug. */
const FLIGHT_COOLDOWN_MS = 2500;

/** Steig- und Fallzeit des Flugs. */
const RISE_MS = 380;
const FALL_MS = 470;

/** So lange nach der Landung erzählt das nächste Antippen vom Flug. */
const FLIGHT_STORY_MS = 10_000;

/** Ruhige Kunststücke für zwischendurch – Salto und Tanz gibt es nur aufs Antippen. */
const CALM_TRICKS: readonly MascotTrick[] = ['hop', 'wave', 'hop', 'wiggle'];

type Message = { tip: Tip; trick: MascotTrick; key: number };

/** Ein Wurf nach oben: Höhe in Punkten, `key` unterscheidet zwei gleich hohe. */
type Flight = { key: number; height: number };

type DockActions = {
  setScene: (scene: MascotScene) => void;
  /** Ein Bildschirm blendet den Begleiter aus (an) oder gibt ihn wieder frei (aus). */
  suppress: (key: string, on: boolean) => void;
  /** Goenni etwas sagen lassen – mit Kunststück. */
  say: (tip: Tip, trick?: MascotTrick) => void;
  /** Goenni hochwerfen – `speed` in Punkten je Millisekunde (siehe `useDockScroll`). */
  fling: (speed: number, screenHeight: number) => void;
};

type DockState = {
  scene: MascotScene;
  suppressed: boolean;
  message: Message | null;
  flight: Flight | null;
};

/**
 * Zwei Kontexte statt einem: Die Aktionen bleiben immer dieselben, der Zustand
 * ändert sich ständig (jeder Tab-Wechsel setzt die Szene, jeder schnelle Wisch
 * wirft Goenni, der Kopf der Startseite blendet ihn beim Scrollen aus und ein).
 * Bildschirme brauchen nur die Aktionen. Hingen sie am Zustand, zeichnete jede
 * dieser Änderungen ALLE Tab-Seiten neu – gemessen der größte Ruckler beim
 * Tab-Wechsel und mitten im Scrollen.
 */
const DockActionsContext = createContext<DockActions | null>(null);
const DockStateContext = createContext<DockState | null>(null);

const NOOP_ACTIONS: DockActions = { setScene: () => {}, suppress: () => {}, say: () => {}, fling: () => {} };
const IDLE_STATE: DockState = { scene: 'home', suppressed: false, message: null, flight: null };

/** Goenni steuern (Szene, ausblenden, sagen, werfen) – ohne bei seinen Änderungen mitzurendern. */
export function useDockActions(): DockActions {
  return useContext(DockActionsContext) ?? NOOP_ACTIONS;
}

/** Nur für die Figur selbst: was sie gerade zeigen soll. */
function useDockState(): DockState {
  return useContext(DockStateContext) ?? IDLE_STATE;
}

/** Den Begleiter ausblenden, solange `active` gilt. `key` unterscheidet die Gründe. */
export function useDockSuppression(key: string, active: boolean) {
  const { suppress } = useDockActions();
  useEffect(() => {
    suppress(key, active);
    return () => suppress(key, false);
  }, [key, active, suppress]);
}

/**
 * Für die Tab-Seiten: an `onScroll` der Liste hängen (mit `scrollEventThrottle`
 * 16–64). Wer ganz schnell nach unten scrollt, wirft Goenni hoch.
 *
 * Gemessen wird mit der Uhr beim Eintreffen. Kommen Ereignisse gebündelt an
 * (weniger als 8 ms auseinander), bleibt der alte Messpunkt stehen – so wird
 * über die ganze Strecke gemittelt statt durch fast null geteilt.
 */
export function useDockScroll(): (event: NativeSyntheticEvent<NativeScrollEvent>) => void {
  const { fling } = useDockActions();
  const { height } = useWindowDimensions();
  const last = useRef<ScrollSample | null>(null);
  return useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const sample = { y: event.nativeEvent.contentOffset.y, t: Date.now() };
      const prev = last.current;
      if (isFastScrollDown(prev, sample)) fling(scrollSpeed(prev, sample), height);
      if (!prev || sample.t - prev.t >= 8) last.current = sample;
    },
    [fling, height],
  );
}

export function MascotDockProvider({ children }: { children: ReactNode }) {
  const [scene, setScene] = useState<MascotScene>('home');
  const [reasons, setReasons] = useState<Record<string, true>>({});
  const [message, setMessage] = useState<Message | null>(null);
  const [flight, setFlight] = useState<Flight | null>(null);
  const counter = useRef(0);
  const lastFlight = useRef(0);
  /** Ausgeblendet? Dann zählt ein Wurf nicht (und verbraucht keine Wartezeit). */
  const hiddenNow = useRef(false);

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

  const fling = useCallback((speed: number, screenHeight: number) => {
    const now = Date.now();
    if (hiddenNow.current || now - lastFlight.current < FLIGHT_COOLDOWN_MS) return;
    lastFlight.current = now;
    counter.current += 1;
    setFlight({ key: counter.current, height: flightHeight(speed, screenHeight) });
  }, []);

  const suppressed = Object.keys(reasons).length > 0;
  // Auf der Startseite verschwindet der Kopf mit Goenni oft im selben Schwung, der
  // ihn hochwerfen soll: Erst wenn er im Dock sichtbar ist, zählt der Wurf.
  useLayoutEffect(() => {
    hiddenNow.current = suppressed;
  }, [suppressed]);
  const actions = useMemo(() => ({ setScene, suppress, say, fling }), [suppress, say, fling]);
  const state = useMemo(() => ({ scene, suppressed, message, flight }), [scene, suppressed, message, flight]);

  return (
    <DockActionsContext.Provider value={actions}>
      <DockStateContext.Provider value={state}>{children}</DockStateContext.Provider>
    </DockActionsContext.Provider>
  );
}

/** Die Figur im Dock. `bottom` = Höhe der Tab-Leiste. */
export function MascotDock({ bottom }: { bottom: number }) {
  const colors = useTheme();
  const reduced = useReducedMotion();
  const { settings } = useAppSettings();
  const dock = useDockState();
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
  /** Zähler für Ruhe: Jede Begegnung erhöht ihn und startet die Zeit bis zur Ecke neu. */
  const [activity, setActivity] = useState(0);
  /** Wie viele Flüge es gab und wann der letzte landete – für den Satz beim nächsten Antippen. */
  const [flights, setFlights] = useState(0);
  const [landedAt, setLandedAt] = useState(0);
  const steps = useRef<Partial<Record<MascotScene, number>>>({});
  const bubbleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const moodTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const landTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Festhalten: Er taucht erst nach seinem Satz ab – Antippen davor bricht das ab. */
  const duckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const now = useNow();
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

  /** Etwas ist passiert: Die Zeit bis zur Ecke beginnt von vorn. */
  const touch = useCallback(() => setActivity((n) => n + 1), []);

  const show = useCallback(
    (tip: Tip, ms = BUBBLE_MS) => {
      bubbleCount.current += 1;
      setBubble({ tip, key: bubbleCount.current });
      if (bubbleTimer.current) clearTimeout(bubbleTimer.current);
      bubbleTimer.current = setTimeout(() => {
        setBubble(null);
        touch();
      }, ms);
    },
    [touch],
  );

  const perform = useCallback((next: MascotTrick) => {
    setTrick(next);
    setTrickKey((k) => k + 1);
  }, []);

  /** Kurz ein anderes Gesicht zeigen – zum Kunststück passend. */
  const react = useCallback((mood: MascotMood = 'cheer', ms = 1700) => {
    setExcited(mood);
    if (moodTimer.current) clearTimeout(moodTimer.current);
    moodTimer.current = setTimeout(() => setExcited(null), ms);
  }, []);

  useEffect(
    () => () => {
      if (bubbleTimer.current) clearTimeout(bubbleTimer.current);
      if (moodTimer.current) clearTimeout(moodTimer.current);
      if (landTimer.current) clearTimeout(landTimer.current);
      if (duckTimer.current) clearTimeout(duckTimer.current);
    },
    [],
  );

  // Selten ein kleines Kunststück, damit er lebt – ohne zu zappeln: eines nach jeder
  // Ruhephase, bevor er abtaucht. Jede Berührung (`activity`) fängt die Zeit neu an.
  const idleTricks = useRef(0);
  useEffect(() => {
    if (hidden || ducked || reduced || bubble) return;
    const timer = setTimeout(() => {
      perform(CALM_TRICKS[idleTricks.current % CALM_TRICKS.length]);
      idleTricks.current += 1;
    }, IDLE_TRICK_MS);
    return () => clearTimeout(timer);
  }, [hidden, ducked, reduced, bubble, activity, perform]);

  // Nach einer Weile Ruhe: still in die Ecke. Nicht, solange er spricht.
  useEffect(() => {
    if (hidden || ducked || bubble) return;
    const timer = setTimeout(() => setDucked(true), TUCK_AFTER_MS);
    return () => clearTimeout(timer);
  }, [hidden, ducked, bubble, activity]);

  // Was auf das nächste Antippen wartet: erst eine Nachricht von außen (z. B. Kauf),
  // dann ein wichtiger Satz zu diesem Tab (ungelesen, Ticket läuft ab).
  const message = dock.message && dock.message.key !== readMessage ? dock.message : null;
  const urgent = dock.scene === 'groups' ? market.groups.some((g) => g.unread > 0) : dock.scene === 'bookings' || dock.scene === 'home' ? expiring?.info.tone === 'urgent' : false;
  const importantKey = urgent && lines[0] ? `${dock.scene}:${lines[0].line}` : null;
  const important = importantKey && !readImportant.includes(importantKey) ? lines[0] : null;
  // Das Abzeichen schaut auch aus der Ecke heraus – es sitzt oben an der Figur.
  const hasNews = !hidden && (message !== null || important !== null);

  const poke = () => {
    haptics.press();
    touch();
    // Gerade erst festgehalten? Dann bleibt er jetzt vorn.
    if (duckTimer.current) clearTimeout(duckTimer.current);
    duckTimer.current = null;
    const wasDucked = ducked;
    if (wasDucked) setDucked(false);
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
    if (wasDucked) {
      show(BACK_LINE, 2600);
      perform('flip');
      react('cheer');
      return;
    }
    if (flights > 0 && Date.now() - landedAt < FLIGHT_STORY_MS) {
      const line = flightLine(flights);
      setLandedAt(0);
      show(line, 4200);
      perform('shake');
      react(line.mood);
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
    if (duckTimer.current) clearTimeout(duckTimer.current);
    duckTimer.current = setTimeout(() => {
      duckTimer.current = null;
      setBubble(null);
      setDucked(true);
    }, 1300);
  };

  // Auftauchen/Abtauchen, Ecke und Flug.
  const visible = useSharedValue(0);
  const down = useSharedValue(0);
  const flyY = useSharedValue(0);
  const flyTurn = useSharedValue(0);
  useEffect(() => {
    visible.set(reduced ? (hidden ? 0 : 1) : hidden ? withTiming(0, { duration: 200 }) : withSpring(1, { damping: 13, stiffness: 160 }));
  }, [hidden, reduced, visible]);
  useEffect(() => {
    down.set(reduced ? (ducked ? 1 : 0) : withTiming(ducked ? 1 : 0, { duration: ducked ? 520 : 380, easing: Easing.inOut(Easing.cubic) }));
  }, [ducked, reduced, down]);

  // Ein neuer Wurf: aus der Ecke heraus, Sprechblase weg, staunendes Gesicht.
  // (Zustand beim Rendern anpassen statt im Effekt – so gibt es keinen zweiten Durchlauf.)
  const [seenFlight, setSeenFlight] = useState(0);
  const [launched, setLaunched] = useState<Flight | null>(null);
  if (dock.flight && dock.flight.key !== seenFlight) {
    setSeenFlight(dock.flight.key);
    if (!hidden && !reduced) {
      setLaunched(dock.flight);
      setDucked(false);
      setBubble(null);
      setExcited('wow');
    }
  }

  // Der Flug: hoch mit dem Schwung (bremst oben ab), Überschlag, herunterfallen
  // (wird schneller), Landung mit Wackler und verdutztem Gesicht.
  useEffect(() => {
    if (!launched) return;
    flyY.set(
      withSequence(
        withTiming(-launched.height, { duration: RISE_MS, easing: Easing.out(Easing.quad) }),
        withTiming(0, { duration: FALL_MS, easing: Easing.in(Easing.quad) }),
      ),
    );
    flyTurn.set(withSequence(withTiming(-360, { duration: RISE_MS + FALL_MS - 60, easing: Easing.inOut(Easing.quad) }), withTiming(0, { duration: 0 })));
    if (landTimer.current) clearTimeout(landTimer.current);
    landTimer.current = setTimeout(() => {
      haptics.tap();
      perform('shake');
      react('oops', 1600);
      setFlights((n) => n + 1);
      setLandedAt(Date.now());
      touch();
    }, RISE_MS + FALL_MS);
  }, [launched, flyY, flyTurn, perform, react, touch]);

  const figureStyle = useAnimatedStyle(() => ({
    opacity: visible.value,
    transform: [
      { translateY: (1 - visible.value) * (SIZE + 40) + down.value * SIZE * TUCK_DEPTH + flyY.value },
      // In der Ecke leicht schräg – er lugt heraus, statt gerade abzusinken.
      { rotate: `${down.value * -14 + flyTurn.value}deg` },
    ],
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
            accessibilityLabel={`Goenni sagt: ${bubbleTip.tip.line}${/[.!?]$/.test(bubbleTip.tip.line) ? '' : '.'} Antippen zum Schließen.`}
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

      {/* Ausgeblendet: auch für Screenreader weg – sonst bliebe ein unsichtbarer Knopf erreichbar. */}
      <Animated.View
        style={figureStyle}
        pointerEvents={hidden ? 'none' : 'auto'}
        accessibilityElementsHidden={hidden}
        importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}>
        <PressableScale
          onPress={poke}
          onLongPress={duck}
          delayLongPress={450}
          haptic="none"
          scaleTo={0.92}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={
            ducked
              ? `Goenni zurückholen${hasNews ? ' – er hat dir etwas zu sagen' : ''}`
              : `Goenni antippen${hasNews ? ' – er hat dir etwas zu sagen' : ''}. Gedrückt halten, damit er Pause macht.`
          }>
          {/* Unsichtbar oder in der Ecke: Die Figur ruht (kein Frame Arbeit). */}
          <MotionPause paused={hidden || ducked}>
            <Mascot
              mood={excited ?? (ducked ? 'idle' : bubbleTip?.tip.mood ?? 'happy')}
              size={SIZE}
              lively={false}
              trick={trick}
              trickKey={trickKey}
              waves={excited !== null && excited !== 'wow' && excited !== 'oops'}
            />
          </MotionPause>
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
