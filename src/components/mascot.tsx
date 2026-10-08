/**
 * „Goenni" – das Maskottchen.
 *
 * ## Wozu die Figur da ist
 *
 * Sie begleitet durch die App: auf der Startseite mit Tipps, beim Buchen, beim
 * Stempeln, in Leerzuständen und bei Fehlern („Oh oh"). Sie soll dabei nach
 * einem Wesen aussehen und nicht nach einem Bild – darum bewegt sie sich ständig
 * ein wenig und zeigt ab und zu ein Kunststück.
 *
 * ## Drei Ebenen Bewegung
 *
 *  - **Lebenszeichen, in Abständen:** ein Hopser mit Stauchen am Boden und
 *    nachwippender Antenne, dann Ruhe; Blinzeln, wandernder Blick (bei offenen
 *    Augen). Bewusst keine Dauerschleifen – jede kostet auf dem Handy jeden Frame.
 *  - **Gesten, wiederkehrend:** winken, umsehen, nicken (`gesture`).
 *  - **Kunststücke, einmalig:** Hüpfer, Salto, Drehung, Tanz, Wackeln, Jubel,
 *    Winken (`trick` + `trickKey`, `jumpKey`, `celebrate`). Mit `lively` zeigt
 *    sie alle paar Sekunden von selbst eines (siehe `pickTrick`).
 *
 * ## Aufbau
 *
 * Die Zeichnung ist in Ebenen zerlegt, damit Teile sich einzeln bewegen können:
 * Antenne (dreht um ihren Fuß), Körper, zwei Arme (drehen um die Schulter),
 * Pupillen (wandern, blinzeln) und ein Funkel-Kranz für den Jubel. Zwei
 * verschachtelte Hüllen tragen die Bewegung: Die äußere verschiebt und dreht um
 * die Mitte (Sprung, Salto, Tanz), die innere staucht und streckt vom Boden aus.
 * Der Schatten liegt außerhalb und bleibt am Boden – nur so liest sich das Auf
 * und Ab als Sprung.
 *
 * ## Worklets
 *
 * In `useAnimatedStyle` stehen nur fertige Zahlen und `interpolate`. Gewöhnliche
 * Funktionen (auch `map` mit Rückruf) laufen dort nicht – im Web fällt das nicht
 * auf, am Gerät stürzt die App ab. Alles Nachschlagen passiert vorher.
 *
 * `useStill()` schaltet alle Bewegung ab – bei „Bewegung reduzieren" und solange
 * die Seite nicht vorn ist (src/components/ui/motion-pause.tsx). Dann steht die
 * Figur still, und das ist in Ordnung – sie trägt keine Information, die nur in
 * der Bewegung steckt.
 *
 * ## Saison-Look
 *
 * Passend zur Jahreszeit (src/domain/season.ts) trägt Goenni etwas: Hexenhut zu
 * Halloween, Weihnachtsmütze im Advent, Partyhut an Silvester, Bommelmütze im
 * Winter, ein Herz zum Valentinstag, Hasenohren zu Ostern, eine Blume im
 * Frühling, Sonnenbrille im Sommer, ein Blatt im Herbst. Hüte sitzen schräg
 * neben der Antenne – die bleibt sein Erkennungszeichen. Mit der Saison-Deko in
 * den Einstellungen abschaltbar; `accessory="none"` lässt ihn pur.
 */
import { useCallback, useEffect, useEffectEvent, useId, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient as SvgLinearGradient, Path, Rect, Stop } from 'react-native-svg';

import { useSeason } from '@/components/seasonal-decor';
import { ThemedText } from '@/components/themed-text';
import { useBeat, useStill } from '@/components/ui/motion-pause';
import { ERROR_REACTION, pickTrick, trickPause, type MascotGesture, type MascotMood, type MascotTrick } from '@/domain/mascot-mood';
import type { SeasonKey } from '@/domain/season';
import { useBrandSurface, useSignals } from '@/hooks/use-theme';
import { useAppSettings } from '@/lib/app-settings';

export type { MascotTrick } from '@/domain/mascot-mood';

/**
 * Die Stimmungen (Gesichter) – Liste und Bedeutung in src/domain/mascot-mood.ts.
 * Seit Okt. 2026 dreizehn: zu den sechs Grundgesichtern kamen zwinkern,
 * verliebt, staunen, albern, stolz, verlegen und müde – damit Antippen jedes
 * Mal anders aussieht.
 */
export type { MascotMood } from '@/domain/mascot-mood';

/** Das Pink des Akzents (constants/theme.ts). Figur UND Schatten brauchen es. */
const DEFAULT_BODY = '#fe2c55';

/** Nur diese Stimmungen haben offene Augen – und damit Blinzeln und Umsehen. */
const OPEN_EYE_MOODS: readonly MascotMood[] = ['idle', 'thinking', 'oops'];

/** Mitte der Augen in der `viewBox` – Bezugspunkt für Blick und Lidschlag. */
const EYE_LINE = 44;

/**
 * Haltestellen des Blicks als Anteil der größten Auslenkung. Die letzte gleicht
 * der ersten: So ist der Rücksprung der Wiederholung unsichtbar.
 */
const GAZE_STOPS = [
  { x: 0, y: 0 },
  { x: -1, y: 0.25 },
  { x: 1, y: 0.25 },
  { x: 0.1, y: -1 },
  { x: 0, y: 0 },
] as const;
const GAZE_INPUT = GAZE_STOPS.map((_, index) => index);
const GAZE_X = GAZE_STOPS.map((stop) => stop.x);
const GAZE_Y = GAZE_STOPS.map((stop) => stop.y);

/** So weit dreht ein Arm, wenn er ganz oben ist (Grad, von hängend aus). */
const ARM_RAISE = 85;

/** Ruhe zwischen zwei Hopsern (dazu je Figur ein eigener Versatz). */
const IDLE_REST_MS = 1700;

/**
 * Wie weit der rechte Arm beim Winken zusätzlich dreht. Hängt er unten, muss er
 * weit hoch, um als Gruß zu lesen; ist er schon oben (Jubel), reicht ein Wedeln.
 */
const WAVE_ANGLE = { down: -55, up: -22 } as const;

/** Schultern und Antennenfuß in der 92er-`viewBox`. */
const SHOULDER_LEFT = [22, 52] as const;
const SHOULDER_RIGHT = [70, 52] as const;
const ANTENNA_FOOT = [46, 20] as const;

export type MascotProps = {
  mood?: MascotMood;
  size?: number;
  /** Körperfarbe. Standard ist der Marken-Akzent. */
  color?: string;
  /** Farbe von Augen und Mund – muss auf `color` lesbar sein. */
  faceColor?: string;
  /** Beim Erscheinen einmal jubeln – für den Erfolgsmoment. */
  celebrate?: boolean;
  /** Wiederkehrende Geste: winken, umsehen, nicken – oder nichts. */
  gesture?: MascotGesture;
  /**
   * Zeigt alle paar Sekunden von selbst ein Kunststück. Für die Stellen, an denen
   * die Figur die App vertritt (Startseite, Club, Credits) – nicht für
   * Leerzustände und nicht in Listen.
   */
  lively?: boolean;
  /** Welches Kunststück bei einem neuen `trickKey` kommt (Standard: Hüpfer). */
  trick?: MascotTrick;
  /** Jede neue Zahl löst `trick` einmal aus. */
  trickKey?: number;
  /** Jede neue Zahl löst einen Hüpfer aus (älterer Weg, gleichwertig zu `trickKey`). */
  jumpKey?: number;
  /** Die türkisen Funkwellen neben der Hand – beim Funken (NFC) und Winken. */
  waves?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Vorgelesene Beschreibung. Ohne Label gilt die Figur als Dekoration. */
  label?: string;
  /** `auto` = Saison-Look (Hut, Ohren …), `none` = ohne. */
  accessory?: 'auto' | 'none';
};

/** Hellere bzw. dunklere Stufe einer Hex-Farbe – für Glanz, Füße und Bäckchen. */
function shade(hex: string, amount: number): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!match) return hex;
  const n = parseInt(match[1], 16);
  const mix = (c: number) => Math.round(amount >= 0 ? c + (255 - c) * amount : c * (1 + amount));
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

/** Alle Werte eines Kunststücks auf Ruhe – vor jedem neuen, damit nichts weiterläuft. */
function settle(values: SharedValue<number>[]) {
  for (const value of values) {
    cancelAnimation(value);
    value.set(0);
  }
}

export function Mascot({
  mood = 'idle',
  size = 96,
  color,
  faceColor = '#4c0519',
  celebrate = false,
  gesture = 'none',
  lively = false,
  trick = 'hop',
  trickKey = 0,
  jumpKey = 0,
  waves = false,
  style,
  label,
  accessory = 'auto',
}: MascotProps) {
  // Steht still bei „Bewegung reduzieren" UND solange die Seite nicht vorn ist (motion-pause.tsx).
  const reduced = useStill();
  const [phase] = useState(() => Math.random());
  const season = useSeason();
  const { settings } = useAppSettings();
  const look: SeasonKey | null = accessory === 'auto' && settings.seasonalDecor ? season.key : null;

  // Lebenszeichen
  const breath = useSharedValue(0);
  const bounce = useSharedValue(0);
  const antenna = useSharedValue(0);
  const blink = useSharedValue(0);
  const gaze = useSharedValue(0);
  // Gesten
  const waveG = useSharedValue(0);
  const nod = useSharedValue(0);
  // Kunststücke
  const lift = useSharedValue(0);
  const spin = useSharedValue(0);
  const turn = useSharedValue(0);
  const tilt = useSharedValue(0);
  const shift = useSharedValue(0);
  const squash = useSharedValue(0);
  const armL = useSharedValue(0);
  const armR = useSharedValue(0);
  const sparkle = useSharedValue(0);
  const hearts = useSharedValue(0);

  const eyesOpen = OPEN_EYE_MOODS.includes(mood);
  const asleep = mood === 'asleep';

  /** Ein Kunststück abspielen. Alle Längen in ms; Höhen als Anteil der Größe. */
  const perform = useCallback(
    (name: MascotTrick) => {
      if (reduced) return;
      settle([lift, spin, turn, tilt, shift, squash, armL, armR, sparkle, hearts]);
      const out = Easing.out(Easing.quad);
      const inn = Easing.in(Easing.quad);
      const land = (delay: number) =>
        withSequence(
          withTiming(0.7, { duration: 110, easing: out }),
          withTiming(0, { duration: 160 }),
          withDelay(delay, withTiming(-1, { duration: 80, easing: inn })),
          withSpring(0, { damping: 7, stiffness: 260, mass: 0.5 }),
        );

      switch (name) {
        case 'hop':
          lift.set(withSequence(withTiming(1, { duration: 250, easing: out }), withTiming(0, { duration: 240, easing: inn })));
          squash.set(land(220));
          break;
        case 'flip':
          lift.set(withSequence(withTiming(1.6, { duration: 330, easing: out }), withTiming(0, { duration: 330, easing: inn })));
          spin.set(withSequence(withDelay(40, withTiming(360, { duration: 600, easing: Easing.inOut(Easing.quad) })), withTiming(0, { duration: 0 })));
          armL.set(withSequence(withTiming(1, { duration: 200 }), withDelay(300, withTiming(0, { duration: 220 }))));
          armR.set(withSequence(withTiming(1, { duration: 200 }), withDelay(300, withTiming(0, { duration: 220 }))));
          squash.set(land(400));
          break;
        case 'spin':
          lift.set(withSequence(withTiming(0.6, { duration: 300, easing: out }), withTiming(0, { duration: 300, easing: inn })));
          turn.set(withSequence(withTiming(360, { duration: 640, easing: Easing.inOut(Easing.cubic) }), withTiming(0, { duration: 0 })));
          armL.set(withSequence(withTiming(0.6, { duration: 220 }), withDelay(220, withTiming(0, { duration: 220 }))));
          break;
        case 'dance': {
          const step = 190;
          shift.set(withSequence(...[-1, 1, -1, 1, 0].map((x) => withTiming(x, { duration: step, easing: Easing.inOut(Easing.quad) }))));
          tilt.set(withSequence(...[-10, 10, -10, 10, 0].map((x) => withTiming(x, { duration: step, easing: Easing.inOut(Easing.quad) }))));
          armL.set(withSequence(...[1, 0.1, 1, 0.1, 0].map((x) => withTiming(x, { duration: step }))));
          armR.set(withSequence(...[0.1, 1, 0.1, 1, 0].map((x) => withTiming(x, { duration: step }))));
          lift.set(withSequence(...[0.35, 0, 0.35, 0, 0.35, 0, 0.35, 0].map((x) => withTiming(x, { duration: step / 2 }))));
          break;
        }
        case 'wiggle':
          tilt.set(withSequence(...[-9, 9, -7, 7, -4, 0].map((x) => withTiming(x, { duration: 75 }))));
          shift.set(withSequence(...[-0.3, 0.3, -0.2, 0.2, 0].map((x) => withTiming(x, { duration: 90 }))));
          break;
        case 'cheer':
          armL.set(withSequence(withTiming(1, { duration: 160, easing: out }), withDelay(1000, withTiming(0, { duration: 260 }))));
          armR.set(withSequence(withTiming(1, { duration: 160, easing: out }), withDelay(1000, withTiming(0, { duration: 260 }))));
          lift.set(
            withSequence(
              withTiming(1.2, { duration: 240, easing: out }),
              withTiming(0, { duration: 230, easing: inn }),
              withTiming(0.8, { duration: 210, easing: out }),
              withTiming(0, { duration: 210, easing: inn }),
            ),
          );
          squash.set(land(180));
          sparkle.set(withSequence(withTiming(1, { duration: 260, easing: out }), withDelay(700, withTiming(0, { duration: 420 }))));
          break;
        case 'wave':
          armR.set(withSequence(...[1, 0.55, 1, 0.55, 1, 0].map((x) => withTiming(x, { duration: 160 }))));
          tilt.set(withSequence(withTiming(-5, { duration: 200 }), withDelay(560, withTiming(0, { duration: 200 }))));
          break;
        case 'bounce':
          lift.set(withSequence(...[0.45, 0, 0.55, 0, 0.7, 0].map((x, i) => withTiming(x, { duration: 150, easing: i % 2 ? inn : out }))));
          squash.set(withSequence(withDelay(300, withTiming(-0.6, { duration: 80 })), withTiming(0, { duration: 220 }), withDelay(200, withTiming(-0.8, { duration: 80 })), withSpring(0, { damping: 7, stiffness: 260, mass: 0.5 })));
          break;
        case 'shake':
          turn.set(withSequence(...[28, -28, 22, -22, 12, 0].map((x) => withTiming(x, { duration: 110, easing: Easing.inOut(Easing.quad) }))));
          tilt.set(withSequence(...[4, -4, 3, -3, 0].map((x) => withTiming(x, { duration: 130 }))));
          break;
        case 'stretch':
          squash.set(withSequence(withTiming(1.4, { duration: 360, easing: out }), withDelay(320, withTiming(-0.7, { duration: 160, easing: inn })), withSpring(0, { damping: 8, stiffness: 220, mass: 0.5 })));
          armL.set(withSequence(withTiming(1.15, { duration: 360 }), withDelay(320, withTiming(0, { duration: 260 }))));
          armR.set(withSequence(withTiming(1.15, { duration: 360 }), withDelay(320, withTiming(0, { duration: 260 }))));
          break;
        case 'shiver':
          shift.set(withSequence(...[-0.16, 0.16, -0.14, 0.14, -0.12, 0.12, -0.08, 0.08, 0].map((x) => withTiming(x, { duration: 45 }))));
          squash.set(withSequence(withTiming(-0.3, { duration: 120 }), withDelay(260, withTiming(0, { duration: 160 }))));
          break;
        case 'clap':
          armL.set(withSequence(...[1.1, 0.7, 1.1, 0.7, 1.1, 0.7, 0].map((x) => withTiming(x, { duration: 120 }))));
          armR.set(withSequence(...[1.1, 0.7, 1.1, 0.7, 1.1, 0.7, 0].map((x) => withTiming(x, { duration: 120 }))));
          lift.set(withSequence(withTiming(0.3, { duration: 200, easing: out }), withTiming(0, { duration: 260, easing: inn })));
          break;
        case 'twist':
          turn.set(withSequence(withTiming(-50, { duration: 260, easing: Easing.inOut(Easing.quad) }), withTiming(50, { duration: 420, easing: Easing.inOut(Easing.quad) }), withTiming(0, { duration: 300, easing: Easing.inOut(Easing.quad) })));
          tilt.set(withSequence(withTiming(-8, { duration: 260 }), withTiming(8, { duration: 420 }), withTiming(0, { duration: 300 })));
          break;
        case 'love':
          hearts.set(withSequence(withTiming(1, { duration: 420, easing: out }), withDelay(900, withTiming(0, { duration: 500 }))));
          armL.set(withSequence(withTiming(0.55, { duration: 220 }), withDelay(900, withTiming(0, { duration: 260 }))));
          armR.set(withSequence(withTiming(0.55, { duration: 220 }), withDelay(900, withTiming(0, { duration: 260 }))));
          lift.set(withSequence(withTiming(0.4, { duration: 260, easing: out }), withTiming(0, { duration: 300, easing: inn })));
          break;
      }
    },
    [reduced, lift, spin, turn, tilt, shift, squash, armL, armR, sparkle, hearts],
  );

  // Ausgelöste Kunststücke.
  useEffect(() => {
    if (jumpKey) perform('hop');
  }, [jumpKey, perform]);
  // Erst der Schlüssel löst aus; `trick` sagt nur, welches Kunststück.
  const performTrick = useEffectEvent(() => perform(trick));
  useEffect(() => {
    if (trickKey) performTrick();
  }, [trickKey]);
  useEffect(() => {
    if (celebrate) perform('cheer');
  }, [celebrate, perform]);

  // Lebendig: von selbst, in ungleichmäßigen Abständen, nie zweimal dasselbe.
  useEffect(() => {
    if (!lively || reduced) return;
    let previous: MascotTrick | null = null;
    let timer: ReturnType<typeof setTimeout>;
    const next = () => {
      timer = setTimeout(() => {
        previous = pickTrick(previous, Math.random());
        perform(previous);
        next();
      }, trickPause(Math.random()));
    };
    timer = setTimeout(() => {
      previous = 'wave';
      perform('wave');
      next();
    }, 900 + phase * 900);
    return () => clearTimeout(timer);
  }, [lively, reduced, perform, phase]);

  // Lebenszeichen im Takt (`useBeat`, motion-pause.tsx): ein Hopser, die Antenne
  // wippt nach, dann Ruhe – und in der Ruhe läuft keine Animation. (Gemessen Okt.
  // 2026: Atmen, Hüpfen und Antenne liefen vorher ununterbrochen und kosteten JEDEN
  // Frame Arbeit, auch als endlose Schleifen mit Pause.) Das kaum sichtbare Atmen
  // (±1 %) fällt ganz weg.
  useEffect(() => {
    breath.set(0.5);
  }, [breath]);

  // Hüpfen: aufwärts bremst es, abwärts beschleunigt es – sonst sieht es aus wie ein
  // Fahrstuhl. Die Antenne wippt im selben Takt nach, damit beides zusammen ruht.
  const rest = Math.round(IDLE_REST_MS * (asleep ? 1.6 : 1) + phase * 900);
  const hopUp = asleep ? 760 : 420;
  const hopDown = asleep ? 820 : 460;
  const wobbles = mood !== 'oops';
  useBeat(
    () => {
      bounce.set(withSequence(withTiming(1, { duration: hopUp, easing: Easing.out(Easing.quad) }), withTiming(0, { duration: hopDown, easing: Easing.in(Easing.quad) })));
      if (!wobbles) return;
      const lead = Math.round(hopUp / 2);
      const swing = Math.round((hopUp + hopDown - lead) / 4);
      const ease = Easing.inOut(Easing.sin);
      antenna.set(
        withSequence(
          withDelay(lead, withTiming(1, { duration: swing, easing: ease })),
          withTiming(-0.7, { duration: swing, easing: ease }),
          withTiming(0.35, { duration: swing, easing: ease }),
          withTiming(0, { duration: hopUp + hopDown - lead - swing * 3, easing: ease }),
        ),
      );
    },
    rest + hopUp + hopDown,
    !reduced,
    rest,
  );

  // Blinzeln: zu schneller als auf, so schlägt ein echtes Lid.
  const looking = !reduced && eyesOpen;
  const blinkRest = Math.round(2400 + phase * 1600);
  useBeat(
    () => blink.set(withSequence(withTiming(1, { duration: 70, easing: Easing.in(Easing.quad) }), withTiming(0, { duration: 110, easing: Easing.out(Easing.quad) }))),
    blinkRest + 180,
    looking,
    blinkRest,
  );

  // Wandernder Blick: vier Stationen reihum; beim Umsehen (`look`) weiter und mit kürzeren Pausen.
  const hold = Math.round(gesture === 'look' ? 700 : 1500 + phase * 600);
  const gazeStep = useRef(0);
  useBeat(
    () => {
      gazeStep.current = (gazeStep.current % 4) + 1;
      const move = withTiming(gazeStep.current, { duration: 400, easing: Easing.inOut(Easing.quad) });
      // Station 4 und 0 sind derselbe Blick: Von 4 zu 1 erst unsichtbar auf 0 springen,
      // sonst wanderten die Augen rückwärts über 3 und 2.
      gaze.set(gazeStep.current === 1 ? withSequence(withTiming(0, { duration: 0 }), move) : move);
    },
    hold + 400,
    looking,
    hold,
  );

  // Winken als wiederkehrende Geste – mit langer Pause, sonst wird es Rauschen.
  const waving = !reduced && gesture === 'wave';
  const waveRest = Math.round(2600 + phase * 1200);
  useBeat(
    () =>
      waveG.set(
        withSequence(
          withTiming(1, { duration: 200, easing: Easing.out(Easing.quad) }),
          withTiming(0.45, { duration: 170 }),
          withTiming(1, { duration: 170 }),
          withTiming(0.45, { duration: 170 }),
          withTiming(0, { duration: 280, easing: Easing.in(Easing.quad) }),
        ),
      ),
    waveRest + 990,
    waving,
    waveRest,
  );

  // Nicken: zweimal kurz einknicken (Stauchen, keine Drehung – sie hat keinen eigenen Kopf).
  const nodding = !reduced && gesture === 'nod';
  const nodRest = Math.round(3000 + phase * 1400);
  useBeat(
    () =>
      nod.set(
        withSequence(
          withTiming(1, { duration: 220, easing: Easing.out(Easing.quad) }),
          withTiming(0, { duration: 260 }),
          withTiming(1, { duration: 200 }),
          withTiming(0, { duration: 300, easing: Easing.inOut(Easing.quad) }),
        ),
      ),
    nodRest + 980,
    nodding,
    nodRest,
  );

  // Angehalten, Augen zu oder Geste gewechselt: zurück in die Ruhe, statt mitten in
  // einer Bewegung stehen zu bleiben.
  useEffect(() => {
    const resting: SharedValue<number>[] = [];
    if (reduced) resting.push(bounce);
    if (reduced || !wobbles) resting.push(antenna);
    if (!looking) {
      resting.push(blink, gaze);
      gazeStep.current = 0;
    }
    if (!waving) resting.push(waveG);
    if (!nodding) resting.push(nod);
    for (const value of resting) {
      cancelAnimation(value);
      value.set(0);
    }
  }, [reduced, wobbles, looking, waving, nodding, bounce, antenna, blink, gaze, waveG, nod]);

  // Fertige Zahlen für die Worklets (siehe Kopfkommentar).
  const bounceHeight = size * (asleep ? 0.03 : 0.07);
  const liftHeight = size * 0.22;
  const shiftWidth = size * 0.09;
  const gazeReach = gesture === 'look' ? 1 : 0.55;
  const gazeX = size * 0.035 * gazeReach;
  const gazeY = size * 0.022 * gazeReach;
  const armBase = mood === 'cheer' ? 1 : 0;
  const waveAngle = mood === 'cheer' ? WAVE_ANGLE.up : WAVE_ANGLE.down;
  const px = (v: number) => (v / 92) * size;

  /** Äußere Hülle: verschieben, springen, drehen – um die Mitte. */
  const moveStyle = useAnimatedStyle(() => ({
    transform: [
      { perspective: 400 },
      { translateX: shift.value * shiftWidth },
      {
        translateY:
          -bounce.value * bounceHeight - lift.value * liftHeight + interpolate(nod.value, [0, 1], [0, size * 0.03]),
      },
      { rotate: `${tilt.value + spin.value}deg` },
      { rotateY: `${turn.value}deg` },
    ],
  }));

  /** Innere Hülle: atmen, stauchen, strecken – vom Boden aus. */
  const squashStyle = useAnimatedStyle(() => {
    // Am Boden des Dauerhüpfens kurz breit, in der Luft leicht gestreckt.
    const ground = interpolate(bounce.value, [0, 0.2, 1], [1, 0, 0.4]);
    const groundY = interpolate(ground, [0, 1], [1, 0.95]);
    const groundX = interpolate(ground, [0, 1], [1, 1.05]);
    const breathe = interpolate(breath.value, [0, 1], [0.99, 1.01]);
    return {
      transform: [
        { scaleX: breathe * groundX * (1 - squash.value * 0.13) },
        { scaleY: breathe * groundY * (1 + squash.value * 0.15) * interpolate(nod.value, [0, 1], [1, 0.94]) },
      ],
    };
  });

  const antennaStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${antenna.value * 9 - tilt.value * 0.6}deg` }],
  }));

  const leftArmStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${Math.min(1.15, armBase + armL.value) * ARM_RAISE}deg` }],
  }));

  const rightArmStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${-Math.min(1.15, armBase + armR.value) * ARM_RAISE + interpolate(waveG.value, [0, 1], [0, waveAngle])}deg` }],
  }));

  const eyeStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(gaze.value, GAZE_INPUT, GAZE_X) * gazeX },
      { translateY: interpolate(gaze.value, GAZE_INPUT, GAZE_Y) * gazeY },
      // Ein Rest bleibt stehen (0.06), sonst wirkt das Gesicht kurz leer.
      { scaleY: interpolate(blink.value, [0, 1], [1, 0.06]) },
    ],
  }));

  const heartsStyle = useAnimatedStyle(() => ({
    opacity: hearts.value,
    transform: [{ translateY: -hearts.value * size * 0.12 }, { scale: 0.6 + hearts.value * 0.5 }],
  }));

  const sparkleStyle = useAnimatedStyle(() => ({
    opacity: sparkle.value,
    transform: [{ scale: 0.5 + sparkle.value * 0.6 }, { rotate: `${sparkle.value * 40}deg` }],
  }));

  /** Je höher die Figur, desto kleiner und blasser der Schatten. */
  const shadowStyle = useAnimatedStyle(() => {
    const up = Math.min(1, bounce.value * 0.25 + lift.value * 0.6);
    return { opacity: 1 - up * 0.55, transform: [{ scaleX: 1 - up * 0.4 }] };
  });

  return (
    <View
      style={[{ width: size, height: size }, style]}
      accessibilityRole={label ? 'image' : undefined}
      accessibilityLabel={label}
      accessibilityElementsHidden={!label}
      importantForAccessibility={label ? 'yes' : 'no-hide-descendants'}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, shadowStyle]}>
        <MascotShadow size={size} color={color} />
      </Animated.View>

      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, moveStyle]}>
        <Animated.View style={[StyleSheet.absoluteFill, { transformOrigin: [size / 2, size * 0.82, 0] }, squashStyle]}>
          <Animated.View style={[StyleSheet.absoluteFill, { transformOrigin: [px(ANTENNA_FOOT[0]), px(ANTENNA_FOOT[1]), 0] }, antennaStyle]}>
            <MascotAntenna mood={mood} size={size} color={color} />
          </Animated.View>
          <MascotBody mood={mood} size={size} color={color} faceColor={faceColor} waves={waves} />
          {/* Arme ÜBER dem Körper: Dahinter verschwänden sie beim Heben fast ganz. */}
          <Animated.View style={[StyleSheet.absoluteFill, { transformOrigin: [px(SHOULDER_LEFT[0]), px(SHOULDER_LEFT[1]), 0] }, leftArmStyle]}>
            <MascotArm side="left" size={size} color={color} />
          </Animated.View>
          <Animated.View style={[StyleSheet.absoluteFill, { transformOrigin: [px(SHOULDER_RIGHT[0]), px(SHOULDER_RIGHT[1]), 0] }, rightArmStyle]}>
            <MascotArm side="right" size={size} color={color} />
          </Animated.View>
          {eyesOpen ? (
            <Animated.View style={[StyleSheet.absoluteFill, { transformOrigin: [size / 2, px(EYE_LINE), 0] }, eyeStyle]}>
              <MascotEyes size={size} faceColor={faceColor} />
            </Animated.View>
          ) : null}
          {look ? <MascotAccessory look={look} size={size} /> : null}
        </Animated.View>
        <Animated.View style={[StyleSheet.absoluteFill, sparkleStyle]}>
          <MascotSparkles size={size} />
        </Animated.View>
        <Animated.View style={[StyleSheet.absoluteFill, heartsStyle]}>
          <MascotHearts size={size} />
        </Animated.View>
      </Animated.View>
    </View>
  );
}

/** Der Schatten – eigene Ebene, er darf nicht mitspringen. */
function MascotShadow({ size, color }: { size: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 92 92" fill="none">
      <Ellipse cx={46} cy={86} rx={20} ry={3.4} fill={color ?? DEFAULT_BODY} opacity={0.2} />
    </Svg>
  );
}

/** Antenne mit Kugel – das Merkmal, an dem man Goenni erkennt. Beim „Oh oh" knickt sie ab. */
function MascotAntenna({ mood, size, color }: { mood: MascotMood; size: number; color?: string }) {
  const body = color ?? DEFAULT_BODY;
  const bent = mood === 'oops';
  const ballX = bent ? 34.4 : 46;
  const ballY = mood === 'cheer' ? 6.4 : bent ? 10.2 : 8.4;
  return (
    <Svg width={size} height={size} viewBox="0 0 92 92" fill="none">
      <Path
        d={mood === 'cheer' ? 'M46 22V9' : bent ? 'M46 22c0-8-3.4-11-8.6-11.4' : 'M46 22V11'}
        stroke={body}
        strokeWidth={3.4}
        strokeLinecap="round"
        fill="none"
      />
      <Circle cx={ballX} cy={ballY} r={4.4} fill={body} />
      <Circle cx={ballX - 1.4} cy={ballY - 1.4} r={1.3} fill="#ffffff" fillOpacity={0.75} />
    </Svg>
  );
}

/** Ein Ärmchen, hängend gezeichnet – gehoben wird es durch Drehen um die Schulter. */
function MascotArm({ side, size, color }: { side: 'left' | 'right'; size: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 92 92" fill="none">
      <Path d={side === 'left' ? 'M23 52l-8.5 6.5' : 'M69 52l8.5 6.5'} stroke={color ?? DEFAULT_BODY} strokeWidth={5.2} strokeLinecap="round" />
    </Svg>
  );
}

/** Augen und Mund je Stimmung – ohne die Pupillen der offenen Augen (eigene Ebene). */
function faceFor(mood: MascotMood, faceColor: string) {
  const stroke = { stroke: faceColor, strokeWidth: 3, strokeLinecap: 'round' as const, fill: 'none' };
  switch (mood) {
    case 'happy':
      return (
        <>
          <Path d="M31 44c1.6-2.6 5.2-2.6 6.8 0M55.2 44c1.6-2.6 5.2-2.6 6.8 0" {...stroke} />
          <Path d="M38 56.5c2.6 3.8 12.4 3.8 15 0" {...stroke} />
        </>
      );
    case 'thinking':
      return <Path d="M40 57h9" {...stroke} />;
    case 'asleep':
      return (
        <>
          <Path d="M28.6 44.4c2-2.8 6.8-2.8 8.8 0M54.6 44.4c2-2.8 6.8-2.8 8.8 0" {...stroke} />
          <Circle cx={46} cy={57.5} r={3.2} fill={faceColor} />
        </>
      );
    case 'cheer':
      return (
        <>
          <Path d="M30 43.6c1.8-3 5.6-3 7.4 0M54.6 43.6c1.8-3 5.6-3 7.4 0" {...stroke} />
          <Path d="M35 55c0 7 4.9 11.4 11 11.4S57 62 57 55z" fill={faceColor} />
          {/* Zunge: macht aus dem offenen Mund ein Lachen statt eines Schreis. */}
          <Path d="M40.5 62.4c1.6-2.2 9.4-2.2 11 0-1.6 2.6-9.4 2.6-11 0z" fill="#ff8fa8" />
        </>
      );
    case 'oops':
      return <Circle cx={46} cy={58} r={4.2} stroke={faceColor} strokeWidth={3} fill="none" />;
    case 'wink':
      return (
        <>
          <Path d="M29.6 44.6c1.8-2.8 6-2.8 7.8 0" {...stroke} />
          <Ellipse cx={58} cy={44} rx={5.2} ry={6} fill={faceColor} />
          <Circle cx={59.8} cy={41.6} r={1.7} fill="#ffffff" opacity={0.9} />
          <Path d="M38.4 55.6c3 3.4 11 3.4 14.6-1.4" {...stroke} />
        </>
      );
    case 'love':
      return (
        <>
          {[34, 58].map((cx) => (
            <Path
              key={cx}
              d={`M${cx} 49.4s-6.2-3.8-6.2-8.2c0-2.2 1.6-3.6 3.4-3.6 1.3 0 2.3.7 2.8 1.7.5-1 1.5-1.7 2.8-1.7 1.8 0 3.4 1.4 3.4 3.6 0 4.4-6.2 8.2-6.2 8.2z`}
              fill="#ffffff"
              stroke={faceColor}
              strokeWidth={1.6}
              strokeLinejoin="round"
            />
          ))}
          <Path d="M37 55.4c2.8 4.6 15.2 4.6 18 0" {...stroke} />
        </>
      );
    case 'wow':
      return (
        <>
          <Circle cx={34} cy={43} r={6.4} fill="#ffffff" stroke={faceColor} strokeWidth={2} />
          <Circle cx={58} cy={43} r={6.4} fill="#ffffff" stroke={faceColor} strokeWidth={2} />
          <Circle cx={34.6} cy={43.6} r={3} fill={faceColor} />
          <Circle cx={58.6} cy={43.6} r={3} fill={faceColor} />
          <Ellipse cx={46} cy={59} rx={3.6} ry={4.6} fill={faceColor} />
        </>
      );
    case 'silly':
      return (
        <>
          <Path d="M30 40.6l6.4 3.4-6.4 3.4M62 40.6l-6.4 3.4 6.4 3.4" {...stroke} />
          <Path d="M36.6 54.6c2.6 4.2 16.2 4.2 18.8 0" {...stroke} />
          <Path d="M45 56.6c0 5.4 7 5.4 7 0z" fill="#ff8fa8" stroke={faceColor} strokeWidth={1.6} strokeLinejoin="round" />
        </>
      );
    case 'proud':
      return (
        <>
          <Path d="M30 44.4c1.8-2.6 5.8-2.6 7.6 0M54.4 44.4c1.8-2.6 5.8-2.6 7.6 0" {...stroke} />
          <Path d="M28.6 37.6c2.4-1.4 5.2-1.6 8-.6M55.4 37c2.8-1 5.6-.8 8 .6" stroke={faceColor} strokeWidth={2} strokeLinecap="round" fill="none" />
          <Path d="M40 56c2.4 2.2 9.4 2.2 12.8-1" {...stroke} />
        </>
      );
    case 'shy':
      return (
        <>
          <Ellipse cx={33} cy={47} rx={3.4} ry={3} fill={faceColor} />
          <Ellipse cx={57} cy={47} rx={3.4} ry={3} fill={faceColor} />
          <Path d="M41.6 58.4c1.4-1.2 2.8 1.2 4.4 0s3-1.2 4.4 0" {...stroke} />
        </>
      );
    case 'sleepy':
      return (
        <>
          <Path d="M28.8 44.6h10M53.2 44.6h10" {...stroke} />
          <Path d="M29.6 42.4c2.6-1.4 6.6-1.4 9 0M53.6 42.4c2.6-1.4 6.6-1.4 9 0" stroke={faceColor} strokeWidth={1.6} strokeLinecap="round" fill="none" opacity={0.6} />
          <Ellipse cx={46} cy={58} rx={2.8} ry={2.2} fill={faceColor} />
        </>
      );
    default:
      return <Path d="M39.5 56.5c2 2.6 11 2.6 13 0" {...stroke} />;
  }
}

/** Körper mit Füßen, Glanz und Bäckchen. */
function MascotBody({ mood, size, color, faceColor, waves }: { mood: MascotMood; size: number; color?: string; faceColor: string; waves: boolean }) {
  const body = color ?? DEFAULT_BODY;
  // Im Web teilen sich alle SVGs einer Seite die IDs – deshalb je Figur eine eigene.
  const skinId = `goenni-skin-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <Svg width={size} height={size} viewBox="0 0 92 92" fill="none" style={StyleSheet.absoluteFill}>
      <Defs>
        <SvgLinearGradient id={skinId} x1="0.2" y1="0" x2="0.8" y2="1">
          <Stop offset="0" stopColor={shade(body, 0.3)} />
          <Stop offset="0.55" stopColor={body} />
          <Stop offset="1" stopColor={shade(body, -0.14)} />
        </SvgLinearGradient>
      </Defs>
      {/* Füßchen – unter dem Körper, damit nur die Spitzen hervorschauen. */}
      <Ellipse cx={37} cy={73.6} rx={6.4} ry={3.4} fill={shade(body, -0.22)} />
      <Ellipse cx={55} cy={73.6} rx={6.4} ry={3.4} fill={shade(body, -0.22)} />
      <Path d="M46 19c15.5 0 25 11.6 25 27.5 0 16.4-9.8 27.5-25 27.5S21 62.9 21 46.5C21 30.6 30.5 19 46 19Z" fill={`url(#${skinId})`} />
      <Ellipse cx={36.5} cy={29} rx={7.5} ry={4.2} transform="rotate(-24 36.5 29)" fill="#ffffff" fillOpacity={0.3} />
      {mood !== 'oops' ? (
        <G opacity={mood === 'shy' || mood === 'love' || mood === 'proud' ? 0.95 : 0.55}>
          <Ellipse cx={28.5} cy={52} rx={4.2} ry={2.6} fill="#ff9db4" />
          <Ellipse cx={63.5} cy={52} rx={4.2} ry={2.6} fill="#ff9db4" />
        </G>
      ) : null}
      {waves ? (
        <Path d="M82.5 30.5c1.9 1.3 2.4 3.4 2 5.8M85.4 26.6c3 2 3.9 5.4 3.2 9.4" stroke="#25f4ee" strokeWidth={1.8} strokeLinecap="round" fill="none" />
      ) : null}
      {faceFor(mood, faceColor)}
    </Svg>
  );
}

/** Nur die Pupillen der offenen Augen – eigene Ebene, damit sie wandern und blinzeln. */
function MascotEyes({ size, faceColor }: { size: number; faceColor: string }) {
  const eye = (cx: number) => (
    <G key={cx}>
      <Ellipse cx={cx} cy={EYE_LINE} rx={5.2} ry={6} fill={faceColor} />
      <Circle cx={cx + 1.8} cy={EYE_LINE - 2.4} r={1.7} fill="#ffffff" opacity={0.9} />
    </G>
  );
  return (
    <Svg width={size} height={size} viewBox="0 0 92 92" fill="none">
      {eye(34)}
      {eye(58)}
    </Svg>
  );
}

/**
 * Der Saison-Look in der 92er-Box. Kopf oben bei y≈19, Augen bei y=44
 * (x=34/58), die Antenne steht bei x=46 – Hüte sitzen deshalb links daneben.
 */
function MascotAccessory({ look, size }: { look: SeasonKey; size: number }) {
  const art = (() => {
    switch (look) {
      case 'halloween':
        return (
          <G transform="rotate(-16 33 21)">
            <Ellipse cx={33} cy={21.5} rx={15} ry={3.6} fill="#2a0c47" stroke="rgba(255,255,255,0.7)" strokeWidth={0.9} />
            <Path d="M25 20.6L33.4 3.6c.7-1.4 2.6-1.6 3.4-.4l-1.5 1.6L41.4 20.6z" fill="#3d1263" stroke="rgba(255,255,255,0.7)" strokeWidth={0.9} strokeLinejoin="round" />
            <Path d="M26.4 16.8h13.6l1.2 3.8H25z" fill="#f97316" />
            <Rect x={31.2} y={16.4} width={4} height={4} rx={0.6} fill="none" stroke="#fde047" strokeWidth={1.2} />
          </G>
        );
      case 'advent':
        return (
          <G transform="rotate(-12 34 21)">
            <Path d="M24.6 21.6C24 12.4 29 6.4 35.6 6c4.4-.3 7.2 2.6 7.6 6.6.3 3-.2 6-.4 9z" fill="#e11d48" />
            <Path d="M35.6 6c-4.4-1-9.6 1.4-12.8 6.6 2.6-.6 4.6-.2 5.8 1" fill="#be123c" />
            <Rect x={22.6} y={18.6} width={22.6} height={5.6} rx={2.8} fill="#ffffff" />
            <Circle cx={22.4} cy={12.8} r={3.4} fill="#ffffff" />
          </G>
        );
      case 'newyear':
        return (
          <G transform="rotate(14 58 21)">
            <Path d="M50 21.6L57.6 2.6 65.2 21.6z" fill="#f5c542" stroke="#b45309" strokeWidth={0.8} strokeLinejoin="round" />
            <Path d="M54.4 12.4l6.4 3.2M52.4 17.6l10.4 3.4" stroke="#fe2c55" strokeWidth={1.6} strokeLinecap="round" />
            <Circle cx={57.6} cy={2.8} r={2.6} fill="#25f4ee" />
          </G>
        );
      case 'winter':
        return (
          <G transform="rotate(-18 33 20)">
            <Path d="M22 22.4c0-8.4 4.8-13.6 11.2-13.6S44.4 14 44.4 22.4z" fill="#38bdf8" />
            <Rect x={20.6} y={19.2} width={25.2} height={5.6} rx={2.6} fill="#0ea5e9" />
            <Path d="M23.4 22h20.4" stroke="#ffffff" strokeWidth={1.2} strokeDasharray="2 2" />
            <Circle cx={33.2} cy={8} r={3.6} fill="#ffffff" />
          </G>
        );
      case 'valentine':
        return (
          <Path
            d="M64 70s-7.4-4.4-7.4-9.6c0-2.6 1.9-4.2 4-4.2 1.5 0 2.7.8 3.4 2 .7-1.2 1.9-2 3.4-2 2.1 0 4 1.6 4 4.2 0 5.2-7.4 9.6-7.4 9.6z"
            fill="#fe2c55"
            stroke="#ffffff"
            strokeWidth={1.6}
            strokeLinejoin="round"
          />
        );
      case 'easter':
        return (
          <G>
            <Path d="M25 27c5.6-8 36.4-8 42 0" stroke="#ffffff" strokeWidth={3} strokeLinecap="round" fill="none" />
            <Ellipse cx={33} cy={11} rx={4.6} ry={10.6} fill="#ffffff" stroke="#f9a8d4" strokeWidth={1} transform="rotate(-14 33 11)" />
            <Ellipse cx={33} cy={11.6} rx={2.2} ry={7} fill="#f9a8d4" transform="rotate(-14 33 11.6)" />
            <Ellipse cx={59} cy={11} rx={4.6} ry={10.6} fill="#ffffff" stroke="#f9a8d4" strokeWidth={1} transform="rotate(14 59 11)" />
            <Ellipse cx={59} cy={11.6} rx={2.2} ry={7} fill="#f9a8d4" transform="rotate(14 59 11.6)" />
          </G>
        );
      case 'spring':
        return (
          <G>
            {[0, 72, 144, 216, 288].map((a) => (
              <Ellipse key={a} cx={30} cy={18.4} rx={3} ry={4.2} fill="#f9a8d4" stroke="#f472b6" strokeWidth={0.6} transform={`rotate(${a} 30 23)`} />
            ))}
            <Circle cx={30} cy={23} r={2.8} fill="#fbbf24" />
          </G>
        );
      case 'summer':
        return (
          <G>
            <Path d="M23 40.6h22.6M46.4 40.6H69" stroke="#1f1033" strokeWidth={2} strokeLinecap="round" />
            <Rect x={24.6} y={38.4} width={19} height={11.6} rx={5} fill="#1f1033" />
            <Rect x={48.4} y={38.4} width={19} height={11.6} rx={5} fill="#1f1033" />
            <Path d="M28 41.6l4 0M51.8 41.6l4 0" stroke="#ffffff" strokeOpacity={0.6} strokeWidth={1.6} strokeLinecap="round" />
          </G>
        );
      case 'autumn':
        return (
          <G transform="rotate(-24 31 17)">
            <Path
              d="M31 6l1.9 4 3.6-1.4-.7 4.2 4.2-.5-2.1 3.8 3 1.9-4.2 1.6.9 3-4-.9L31 25.2l-2.6-3.7-4 .9.9-3-4.2-1.6 3-1.9-2.1-3.8 4.2.5-.7-4.2 3.6 1.4z"
              fill="#ea580c"
              stroke="#9a3412"
              strokeWidth={0.7}
              strokeLinejoin="round"
            />
            <Path d="M31 11.6v15" stroke="#9a3412" strokeWidth={1.1} strokeLinecap="round" />
          </G>
        );
    }
  })();

  return (
    <Svg width={size} height={size} viewBox="0 0 92 92" fill="none" style={StyleSheet.absoluteFill} pointerEvents="none">
      {art}
    </Svg>
  );
}

/** Drei Herzen um den Kopf – nur beim Kunststück „love" sichtbar. */
/** Ein Herz in einer 10er-Box. */
const HEART = 'M5 9S.5 6.2.5 3.2C.5 1.7 1.6.6 2.9.6c1 0 1.7.6 2.1 1.4C5.4 1.2 6.1.6 7.1.6c1.3 0 2.4 1.1 2.4 2.6C9.5 6.2 5 9 5 9z';

function MascotHearts({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 92 92" fill="none">
      <Path d={HEART} fill="#ff3b64" stroke="#ffffff" strokeWidth={0.6} transform="translate(8 8) scale(1.5)" />
      <Path d={HEART} fill="#ff8fa8" stroke="#ffffff" strokeWidth={0.7} transform="translate(70 4) scale(1.2)" />
      <Path d={HEART} fill="#fe2c55" stroke="#ffffff" strokeWidth={0.8} transform="translate(77 34) scale(1)" />
    </Svg>
  );
}

/** Vier Funkelsterne um den Kopf – nur beim Jubel sichtbar. */
function MascotSparkles({ size }: { size: number }) {
  const star = (x: number, y: number, r: number, fill: string) => (
    <Path
      key={`${x}-${y}`}
      d={`M${x} ${y - r}C${x + r * 0.18} ${y - r * 0.18} ${x + r * 0.18} ${y - r * 0.18} ${x + r} ${y}C${x + r * 0.18} ${y + r * 0.18} ${x + r * 0.18} ${y + r * 0.18} ${x} ${y + r}C${x - r * 0.18} ${y + r * 0.18} ${x - r * 0.18} ${y + r * 0.18} ${x - r} ${y}C${x - r * 0.18} ${y - r * 0.18} ${x - r * 0.18} ${y - r * 0.18} ${x} ${y - r}Z`}
      fill={fill}
    />
  );
  return (
    <Svg width={size} height={size} viewBox="0 0 92 92" fill="none">
      {star(13, 20, 6, '#ffd24a')}
      {star(80, 15, 5, '#25f4ee')}
      {star(86, 47, 4, '#ffd24a')}
      {star(6, 46, 4, '#25f4ee')}
    </Svg>
  );
}

/** Leerzustand mit Figur, Überschrift und Erklärung. */
export function MascotEmpty({
  mood = 'thinking',
  size = 92,
  color,
  faceColor,
  gesture,
  children,
  style,
}: {
  mood?: MascotMood;
  size?: number;
  color?: string;
  faceColor?: string;
  /** Ein Leerzustand ist kein Ort für Betriebsamkeit – außer er IST eine Einladung. */
  gesture?: MascotGesture;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.empty, style]}>
      <Mascot mood={mood} size={size} color={color} faceColor={faceColor} gesture={gesture} />
      {children}
    </View>
  );
}

/**
 * Der Fehlerzustand: Figur („Oh oh"), ein trockener Satz, was los ist, und ein
 * Weg zurück. Die Texte stehen in `src/domain/mascot-mood.ts`.
 */
export function MascotError({
  detail,
  onRetry,
  size = 84,
  style,
}: {
  detail?: string | null;
  /** Ohne Rückruf kein Knopf: Ein „Nochmal" ohne Wirkung wäre eine Lüge. */
  onRetry?: () => void;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const surface = useBrandSurface();
  const signal = useSignals();

  return (
    <View
      style={[styles.error, style]}
      accessibilityRole="alert"
      accessibilityLabel={`${ERROR_REACTION.headline}. ${ERROR_REACTION.line} ${detail ?? ''}`.trim()}>
      <Mascot mood={ERROR_REACTION.mood} size={size} color={signal.warn} />
      <ThemedText style={[styles.errorHeadline, { color: surface.text }]}>{ERROR_REACTION.headline}</ThemedText>
      <ThemedText type="small" style={[styles.errorLine, { color: surface.text }]}>
        {ERROR_REACTION.line}
      </ThemedText>
      {detail ? (
        <ThemedText type="small" style={[styles.errorLine, { color: surface.textMuted }]}>
          {detail}
        </ThemedText>
      ) : null}
      {onRetry ? (
        <Pressable
          onPress={onRetry}
          accessibilityRole="button"
          hitSlop={8}
          style={({ pressed }) => [styles.retry, { borderColor: surface.chipBorder, backgroundColor: surface.chipBg }, pressed && styles.retryPressed]}>
          <ThemedText type="smallBold" style={{ color: surface.accent }}>
            Nochmal versuchen
          </ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', gap: 8 },
  error: { alignItems: 'center', gap: 4, paddingVertical: 8 },
  errorHeadline: { fontSize: 20, lineHeight: 26, fontWeight: '800', letterSpacing: -0.3 },
  errorLine: { textAlign: 'center' },
  retry: {
    marginTop: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth * 2,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  retryPressed: { opacity: 0.7 },
});
