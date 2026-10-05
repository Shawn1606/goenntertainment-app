/**
 * „Goenni" – das Maskottchen.
 *
 * ## Wozu überhaupt eine Figur
 *
 * Die Leerzustände dieser App standen vorher unter einem Emoji: ein Zelt, ein
 * Händedruck, eine Uhr. Das hat funktioniert, aber drei Nachteile: Es sah auf
 * jedem Gerät anders aus, es ließ sich nicht einfärben, und es gehörte niemandem.
 * Eine eigene Figur löst alle drei – und macht aus „hier ist nichts" einen
 * Moment, der jemandem gehört.
 *
 * ## Wo sie auftaucht
 *
 *  - **Auf jedem Tab**, klein in der Kopfzeile – mit der Stimmung, die zu dem
 *    passt, was man dort tut (`src/domain/mascot-mood.ts`). Sie ist damit die
 *    Begleitung durch die App und nicht mehr nur die Füllung leerer Flächen.
 *  - **Leerzustände**, wo sonst nichts wäre.
 *  - **Fehler** – dort sagt sie „Oh oh" (siehe `MascotError`). Ein Fehler ist der
 *    Moment, in dem eine App am kältesten wirkt; genau da hilft ein Gesicht.
 *  - **Nach einem Erfolg** – kurz, dann ist sie wieder weg.
 *
 * Die frühere Regel „nirgends in Kopfzeilen" ist damit bewusst aufgehoben. Der
 * Preis dafür ist Zurückhaltung an anderer Stelle: in der Kopfzeile bleibt sie
 * klein (40–48 px), ohne Lichthof und ohne Farbe außer dem Akzent.
 *
 * ## Bewegung
 *
 * Zwei Ebenen, die sich überlagern:
 *  - **Hüpfen.** Sie springt dauerhaft auf und ab – 6 % ihrer Höhe, ein voller
 *    Sprung in gut einer Sekunde. Das ist die Bewegung, an der man sie als Figur
 *    erkennt und nicht als Bild.
 *  - **Atmen.** Eine sehr langsame Skalierung um 2 %, deutlich langsamer als das
 *    Hüpfen. Weil beide Läufe unterschiedlich lang sind, wiederholt sich die
 *    Kombination nicht sichtbar – das ist der Unterschied zwischen „lebt" und
 *    „läuft in einer Schleife".
 *
 * **Der Schatten springt nicht mit.** Er liegt als eigene, feste Ebene unter der
 * Figur (`MascotShadow`). Das ist der Grund, warum die Bewegung überhaupt als
 * Sprung liest: Ohne einen Punkt, der liegen bleibt, wandert das ganze Bild – und
 * dieselbe Bewegung sieht dann nach Wackeln aus statt nach Abheben.
 *
 * `useReducedMotion()` schaltet BEIDES ab – dann steht sie einfach da, und das ist
 * vollkommen in Ordnung: Die Figur trägt keine Information, die nur in der
 * Bewegung steckt.
 */
import { useEffect, useId, useState } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient as SvgLinearGradient, Path, Stop } from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { ERROR_REACTION, type MascotGesture } from '@/domain/mascot-mood';
import { useBrandSurface, useSignals } from '@/hooks/use-theme';

/**
 * Die Stimmungen, die es gibt.
 *
 * Absichtlich wenige und klar unterscheidbar: Sechs Gesichter, die man auf 40 px
 * noch auseinanderhält, sind mehr wert als zwölf, die alle gleich aussehen.
 */
export type MascotMood =
  /** Standard: freundlich, wach, wartet. */
  | 'idle'
  /** Etwas hat geklappt. */
  | 'happy'
  /** Es lädt oder es ist gerade nichts da. */
  | 'thinking'
  /** Nichts los – Nacht, leerer Umkreis. */
  | 'asleep'
  /** Der große Moment: beigetreten, Ziel erreicht. */
  | 'cheer'
  /**
   * Etwas ist schiefgegangen. Die einzige Stimmung, die von einem SYSTEM-Zustand
   * erzählt und nicht von dem, was die Nutzer:in getan hat – deshalb betreten und
   * nicht traurig: Schuld hat hier niemand.
   */
  | 'oops';

/**
 * Körperfarbe, wenn keine übergeben wird.
 *
 * Steht als Konstante, weil Figur UND Schatten sie brauchen – als zwei getrennte
 * Ebenen (siehe `MascotShadow`) wäre ein doppeltes Literal genau die Stelle, an
 * der irgendwann ein indigofarbener Körper über einem violetten Schatten steht.
 */
// Das Pink des Akzents (TikTok-Stil, siehe constants/theme.ts). Vorher Indigo – mit
// dem neuen Akzent stand Goenni als einzige blaue Figur auf einer pinken App.
const DEFAULT_BODY = '#fe2c55';

/**
 * Die Stimmungen mit OFFENEN Augen.
 *
 * Nur sie bekommen die Pupillen-Ebene und damit Blinzeln und Umsehen – bei
 * zusammengekniffenen oder geschlossenen Augen wäre beides sinnlos (und ein
 * Blinzeln mit geschlossenen Augen wäre ein Zucken).
 */
const OPEN_EYE_MOODS: readonly MascotMood[] = ['idle', 'thinking', 'oops'];

/** Mitte der Augen in der `viewBox` – Bezugspunkt für Blick und Lidschlag. */
const EYE_LINE = 44;

/**
 * Die Haltestellen des Blicks, als Anteil der maximalen Auslenkung.
 *
 * `y` ist bei den Seitenblicken leicht positiv (der Blick geht ein wenig nach
 * unten, so schaut man sich um) und beim dritten Halt deutlich negativ (nach oben,
 * „hm"). Die LETZTE Haltestelle ist mit der ersten identisch: Dadurch landet der
 * Blick am Ende wieder in der Mitte und der Rücksprung der Wiederholung ist
 * unsichtbar – ohne dass die Augen dafür quer zurückrasen müssten.
 */
const GAZE_STOPS = [
  { x: 0, y: 0 },
  { x: -1, y: 0.25 },
  { x: 1, y: 0.25 },
  { x: 0.1, y: -1 },
  { x: 0, y: 0 },
] as const;

/**
 * Die Haltestellen als drei fertige Zahlenreihen – Eingabe, x, y.
 *
 * ## Warum das hier steht und nicht im Worklet
 *
 * Die erste Fassung rief `GAZE_STOPS.map((s) => s.x)` INNERHALB von
 * `useAnimatedStyle` auf. Im Browser lief das, am Gerät stürzte die App ab: Ein
 * `useAnimatedStyle`-Rumpf ist ein Worklet und läuft auf dem UI-Thread, und dort
 * gibt es die gewöhnliche Rückruffunktion aus `map` nicht – Reanimated bricht mit
 * „tried to synchronously call a non-worklet function on the UI thread" ab.
 *
 * Genau diese Sorte Fehler ist im Web unsichtbar, weil dort alles auf demselben
 * Thread läuft. Die Regel daraus: **Im Worklet nur fertige Zahlen und
 * `interpolate`.** Alles, was gerechnet, nachgesehen oder abgebildet werden muss,
 * passiert vorher – hier auf Modulebene, sonst im Komponentenkörper.
 *
 * Nebeneffekt, der ohnehin richtig ist: Die Reihen werden einmal gebaut und nicht
 * bei jedem Bild neu.
 */
const GAZE_INPUT = GAZE_STOPS.map((_, index) => index);
const GAZE_X = GAZE_STOPS.map((stop) => stop.x);
const GAZE_Y = GAZE_STOPS.map((stop) => stop.y);

/**
 * Wie weit der Arm beim Winken dreht – je nachdem, wo er anfängt.
 *
 * Hängt der Arm unten, muss er weit hoch, um als Gruß zu lesen. Ist er beim Jubeln
 * schon oben, würde derselbe Winkel ihn hinter den Kopf schwenken; dort reicht ein
 * kleines Wedeln um die schon erhobene Haltung.
 */
const WAVE_ANGLE = { down: -55, up: -26 } as const;

/** Hängen die Arme (Normalfall) oder sind sie oben (Jubeln)? */
function armPose(mood: MascotMood): keyof typeof WAVE_ANGLE {
  return mood === 'cheer' ? 'up' : 'down';
}

/**
 * Der Drehpunkt des Winkarms in Pixeln – der Armansatz an der Schulter.
 *
 * In der `viewBox` sitzt er bei (70, 52) bzw. beim Jubeln bei (69, 44); umgerechnet
 * auf die tatsächliche Größe, weil `transformOrigin` in Pixeln rechnet und nicht in
 * SVG-Einheiten.
 */
function shoulderOrigin(mood: MascotMood, size: number): [number, number, number] {
  const [x, y] = mood === 'cheer' ? [69, 44] : [70, 52];
  return [(x / 92) * size, (y / 92) * size, 0];
}

export type MascotProps = {
  mood?: MascotMood;
  size?: number;
  /** Körperfarbe. Standard ist der Marken-Akzent des Themas. */
  color?: string;
  /** Farbe von Augen und Mund – muss auf `color` lesbar sein. */
  faceColor?: string;
  /**
   * Einmal hüpfen, sobald die Figur erscheint. Für den Erfolgsmoment; im
   * Leerzustand wäre es Zappeln.
   */
  celebrate?: boolean;
  /**
   * Was der Körper tut: winken, sich umsehen, nicken – oder nichts.
   *
   * Blinzeln und der wandernde Blick gehören NICHT dazu: Die laufen immer (bei
   * offenen Augen), weil sie kein Ausdruck sind, sondern das Lebenszeichen. Eine
   * Figur, die minutenlang starrt, sieht aus wie ein Bild.
   */
  gesture?: MascotGesture;
  style?: StyleProp<ViewStyle>;
  /**
   * Vorgelesene Beschreibung. Ohne Label gilt die Figur als Dekoration – und das
   * ist der Normalfall: Neben ihr steht immer ein Satz, der dasselbe sagt.
   */
  label?: string;
  /**
   * Die türkisen Funkwellen neben der erhobenen Hand – wie im Instagram-Logo.
   * Sie stehen dort, wo Goenni „funkt": beim NFC-Check-in und beim Winken.
   */
  waves?: boolean;
  /** Jede neue Zahl lässt die Figur einmal springen (siehe `MascotBuddy`). */
  jumpKey?: number;
};

/**
 * Hellere bzw. dunklere Stufe einer Hex-Farbe – für den Glanz-Verlauf des
 * Körpers. Unbekannte Formate kommen unverändert zurück (dann eben ohne Glanz).
 */
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

/**
 * Augen und Mund je Stimmung – OHNE die Pupillen der offenen Augen.
 *
 * Die stecken in `MascotEyes` und damit in einer eigenen, beweglichen Ebene. Was
 * hier bleibt, ist der Rest des Gesichts: geschlossene Lider als Striche, Münder,
 * und bei offenen Augen gar nichts (die Ebene darüber malt sie).
 */
function faceFor(mood: MascotMood, faceColor: string) {
  switch (mood) {
    case 'happy':
      return (
        <>
          {/* Zusammengekniffene Augen – das liest sich als Lächeln mit. */}
          <Path
            d="M31 44c1.6-2.6 5.2-2.6 6.8 0M55.2 44c1.6-2.6 5.2-2.6 6.8 0"
            stroke={faceColor}
            strokeWidth={3}
            strokeLinecap="round"
            fill="none"
          />
          <Path
            d="M38 57c2.6 3.4 12.4 3.4 15 0"
            stroke={faceColor}
            strokeWidth={3}
            strokeLinecap="round"
            fill="none"
          />
        </>
      );
    case 'thinking':
      return (
        /* Mund seitlich verschoben – der klassische „hm"-Ausdruck. */
        <Path d="M40 57h9" stroke={faceColor} strokeWidth={3} strokeLinecap="round" fill="none" />
      );
    case 'asleep':
      return (
        <>
          <Path
            d="M28.6 44.4c2-2.8 6.8-2.8 8.8 0M54.6 44.4c2-2.8 6.8-2.8 8.8 0"
            stroke={faceColor}
            strokeWidth={3}
            strokeLinecap="round"
            fill="none"
          />
          <Circle cx={46} cy={57.5} r={3.2} fill={faceColor} />
        </>
      );
    case 'cheer':
      return (
        <>
          <Path
            d="M30 43.6c1.8-3 5.6-3 7.4 0M54.6 43.6c1.8-3 5.6-3 7.4 0"
            stroke={faceColor}
            strokeWidth={3}
            strokeLinecap="round"
            fill="none"
          />
          {/* Offener, gefüllter Mund: der breiteste Ausdruck im Set. */}
          <Path d="M35 55c0 7 4.9 11.4 11 11.4S57 62 57 55z" fill={faceColor} />
        </>
      );
    case 'oops':
      return (
        /* Kleiner runder Mund als Kontur statt als Fläche: gefüllt sähe er aus
           wie ein Schrei, als Ring wie ein verlegenes „oh". */
        <Circle cx={46} cy={58} r={4.2} stroke={faceColor} strokeWidth={3} fill="none" />
      );
    default:
      return (
        <Path
          d="M39.5 56.5c2 2.6 11 2.6 13 0"
          stroke={faceColor}
          strokeWidth={3}
          strokeLinecap="round"
          fill="none"
        />
      );
  }
}

/**
 * Nur die Pupillen der offenen Augen – als eigene Ebene, damit sie sich bewegen
 * können.
 *
 * Warum eine SVG-Ebene und keine animierten SVG-Attribute: `cx` eines `Ellipse`
 * ließe sich über `useAnimatedProps` bewegen, aber das ist der Weg, der im Web und
 * über react-native-svg-Versionen hinweg am ehesten bricht. Eine zweite,
 * absolut liegende Ebene mit derselben `viewBox` bewegt sich über ein ganz
 * gewöhnliches `transform` auf einer View – dieselbe Technik wie beim Schatten,
 * und sie funktioniert überall gleich.
 */
function MascotEyes({ size, faceColor }: { size: number; faceColor: string }) {
  const eye = (cx: number) => (
    <G key={cx}>
      <Ellipse cx={cx} cy={EYE_LINE} rx={5.2} ry={6} fill={faceColor} />
      {/* Lichtpunkt: macht aus einem Fleck ein Auge, das irgendwohin schaut. */}
      <Circle cx={cx + 1.8} cy={EYE_LINE - 2.4} r={1.7} fill="#ffffff" opacity={0.9} />
    </G>
  );

  return (
    <Svg width={size} height={size} viewBox="0 0 92 92" fill="none" pointerEvents="none">
      {eye(34)}
      {eye(58)}
    </Svg>
  );
}

export function Mascot({
  mood = 'idle',
  size = 96,
  color,
  faceColor = '#4c0519',
  celebrate = false,
  gesture = 'none',
  style,
  label,
  waves = false,
  jumpKey = 0,
}: MascotProps) {
  const reduced = useReducedMotion();
  const breath = useSharedValue(0);
  /** Das dauerhafte Hüpfen: 0 = unten, 1 = oben. */
  const bounce = useSharedValue(0);
  /** Der einmalige, große Sprung für den Erfolgsmoment. */
  const jump = useSharedValue(0);
  /** Lidschlag: 0 = offen, 1 = zu. */
  const blink = useSharedValue(0);
  /** Blickrichtung als Nummer der Haltestelle – siehe `GAZE_STOPS`. */
  const gaze = useSharedValue(0);
  /** Winken: 0 = Arm unten (Ruhestellung), 1 = ganz oben. */
  const wave = useSharedValue(0);
  /** Nicken: 0 = aufrecht, 1 = eingeknickt. */
  const nod = useSharedValue(0);

  /**
   * Eine eigene Phase pro Figur, damit mehrere gleichzeitig sichtbare Maskottchen
   * nicht im Gleichschritt blinzeln – das sähe nach Bildschirmfehler aus, nicht
   * nach Leben. Einmal beim Einhängen gezogen und danach fest.
   */
  const [phase] = useState(() => Math.random());

  const eyesOpen = OPEN_EYE_MOODS.includes(mood);

  // Atmen. Sehr langsam und sehr klein – man soll es nicht bemerken, sondern nur
  // merken, dass die Figur nicht gemalt aussieht.
  useEffect(() => {
    cancelAnimation(breath);
    if (reduced) {
      breath.value = 0.5;
      return;
    }
    breath.value = 0;
    breath.value = withRepeat(
      withTiming(1, { duration: mood === 'asleep' ? 4200 : 2800, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
    return () => cancelAnimation(breath);
  }, [reduced, mood, breath]);

  /**
   * Das Hüpfen. Läuft immer und in jeder Stimmung – auch im Schlaf, dort nur
   * langsamer und flacher (ein schlafendes Wesen atmet ja auch).
   *
   * Zwei getrennte Läufe statt `withRepeat(..., true)`: Hoch soll sich anders
   * anfühlen als runter. Aufwärts bremst es aus (`out`), wie etwas, das gegen die
   * Schwerkraft steigt; abwärts beschleunigt es (`in`) und landet weich. Mit einer
   * symmetrischen Kurve sieht dieselbe Bewegung aus wie ein Fahrstuhl.
   */
  useEffect(() => {
    cancelAnimation(bounce);
    if (reduced) {
      bounce.value = 0;
      return;
    }
    const up = mood === 'asleep' ? 700 : 460;
    const down = mood === 'asleep' ? 800 : 560;
    bounce.value = 0;
    bounce.value = withRepeat(
      withSequence(
        withTiming(1, { duration: up, easing: Easing.out(Easing.quad) }),
        withTiming(0, { duration: down, easing: Easing.in(Easing.quad) }),
      ),
      -1,
      false,
    );
    return () => cancelAnimation(bounce);
  }, [reduced, mood, bounce]);

  // Der Sprung beim Erscheinen: hoch mit Feder, zurück mit Feder. Einmal – und
  // noch einmal bei jedem neuen `jumpKey` (Antippen, frischer Stempel).
  useEffect(() => {
    cancelAnimation(jump);
    if ((!celebrate && !jumpKey) || reduced) {
      jump.value = 0;
      return;
    }
    jump.value = 0;
    jump.value = withSequence(
      withSpring(1, { damping: 9, stiffness: 220, mass: 0.6 }),
      withDelay(60, withSpring(0, { damping: 14, stiffness: 180 })),
    );
    return () => cancelAnimation(jump);
  }, [celebrate, jumpKey, reduced, jump]);

  /**
   * Blinzeln.
   *
   * Zu geht schneller als auf (70 ms gegen 110 ms) – so schlägt ein echtes Lid.
   * Symmetrisch sieht es aus wie ein Zwinkern mit Absicht. Die Pause dazwischen
   * variiert je Figur (`phase`), damit der Lidschlag nicht in den Takt des Hüpfens
   * fällt und dann als ein zusammengesetzter Effekt wahrgenommen wird.
   */
  useEffect(() => {
    cancelAnimation(blink);
    if (reduced || !eyesOpen) {
      blink.value = 0;
      return;
    }
    blink.value = 0;
    blink.value = withRepeat(
      withSequence(
        withDelay(2400 + phase * 1600, withTiming(1, { duration: 70, easing: Easing.in(Easing.quad) })),
        withTiming(0, { duration: 110, easing: Easing.out(Easing.quad) }),
      ),
      -1,
      false,
    );
    return () => cancelAnimation(blink);
  }, [reduced, eyesOpen, phase, blink]);

  /**
   * Der wandernde Blick.
   *
   * Läuft die Haltestellen aus `GAZE_STOPS` der Reihe nach ab: links, rechts, hoch,
   * Mitte. Die letzte Haltestelle hat dieselben Werte wie die erste – dadurch ist
   * der Rücksprung der Wiederholung unsichtbar, ohne dass die Augen zurückrasen.
   *
   * Auf der Karte (`look`) schaut sie weiter und mit kürzeren Pausen: Dort IST
   * Suchen die Tätigkeit. Überall sonst bleibt es ein Lebenszeichen und soll vom
   * Text daneben nicht ablenken.
   */
  useEffect(() => {
    cancelAnimation(gaze);
    if (reduced || !eyesOpen) {
      gaze.value = 0;
      return;
    }
    const hold = gesture === 'look' ? 700 : 1500 + phase * 600;
    gaze.value = 0;
    gaze.value = withRepeat(
      withSequence(
        ...GAZE_STOPS.slice(1).map((_, index) =>
          withDelay(hold, withTiming(index + 1, { duration: 400, easing: Easing.inOut(Easing.quad) })),
        ),
      ),
      -1,
      false,
    );
    return () => cancelAnimation(gaze);
  }, [reduced, eyesOpen, gesture, phase, gaze]);

  /**
   * Winken: heben, zweimal wedeln, senken – und dann eine lange Pause.
   *
   * Die Pause ist das Wichtigste daran. Ein Arm, der ohne Unterbrechung wedelt,
   * ist nach zehn Sekunden Rauschen; einer, der alle paar Sekunden einmal grüßt,
   * bleibt eine Begrüßung.
   */
  useEffect(() => {
    cancelAnimation(wave);
    if (reduced || gesture !== 'wave') {
      wave.value = 0;
      return;
    }
    wave.value = 0;
    wave.value = withRepeat(
      withSequence(
        withDelay(2600 + phase * 1200, withTiming(1, { duration: 200, easing: Easing.out(Easing.quad) })),
        withTiming(0.45, { duration: 170 }),
        withTiming(1, { duration: 170 }),
        withTiming(0.45, { duration: 170 }),
        withTiming(0, { duration: 280, easing: Easing.in(Easing.quad) }),
      ),
      -1,
      false,
    );
    return () => cancelAnimation(wave);
  }, [reduced, gesture, phase, wave]);

  /**
   * Nicken: zweimal kurz einknicken.
   *
   * Umgesetzt als Stauchen nach unten und NICHT als Drehung: Die Figur hat keinen
   * eigenen Kopf, eine Drehung wäre ein Kippen zur Seite und liest sich als
   * Zweifel statt als Zustimmung. Weil der Bezugspunkt aller Verformungen unten
   * liegt (siehe `bodyOrigin`), sackt sie dabei in sich, statt zu schrumpfen.
   */
  useEffect(() => {
    cancelAnimation(nod);
    if (reduced || gesture !== 'nod') {
      nod.value = 0;
      return;
    }
    nod.value = 0;
    nod.value = withRepeat(
      withSequence(
        withDelay(3000 + phase * 1400, withTiming(1, { duration: 220, easing: Easing.out(Easing.quad) })),
        withTiming(0, { duration: 260 }),
        withTiming(1, { duration: 200 }),
        withTiming(0, { duration: 300, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
    return () => cancelAnimation(nod);
  }, [reduced, gesture, phase, nod]);

  /** Wie hoch das dauerhafte Hüpfen geht – im Schlaf nur ein Andeuten. */
  const bounceHeight = size * (mood === 'asleep' ? 0.03 : 0.06);

  /** Wie weit die Augen wandern. Auf der Karte deutlich, sonst zurückhaltend. */
  const gazeReach = gesture === 'look' ? 1 : 0.55;
  const gazeX = size * 0.035 * gazeReach;
  const gazeY = size * 0.022 * gazeReach;

  /**
   * Der Winkel des Winkens – HIER nachgesehen, nicht im Worklet.
   *
   * `armPose` ist eine gewöhnliche Funktion; ein Aufruf aus dem Worklet heraus
   * bringt die App auf dem Gerät zum Absturz (siehe die Notiz an `GAZE_X`). Was das
   * Worklet braucht, ist eine fertige Zahl.
   */
  const waveAngle = WAVE_ANGLE[armPose(mood)];

  /**
   * Bezugspunkt aller Verformungen der Figur: unten Mitte, also da, wo sie steht.
   *
   * Mit dem voreingestellten Mittelpunkt würde das Atmen die Figur auch nach unten
   * wachsen lassen – sie sänke in den eigenen Schatten. Vom Boden aus wächst sie
   * nach oben, und das Nicken sackt in sich statt zu schrumpfen.
   */
  const bodyOrigin: ViewStyle = { transformOrigin: [size / 2, size, 0] };

  const bodyStyle = useAnimatedStyle(() => ({
    transform: [
      // Alle Höhen addieren sich: Der große Sprung setzt auf dem Hüpfen auf, statt
      // es zu ersetzen – sonst stockte die Figur genau im Erfolgsmoment. Das
      // Nicken zieht dagegen nach unten.
      {
        translateY:
          interpolate(bounce.value, [0, 1], [0, -bounceHeight]) +
          interpolate(jump.value, [0, 1], [0, -size * 0.14]) +
          interpolate(nod.value, [0, 1], [0, size * 0.03]),
      },
      { scaleX: interpolate(breath.value, [0, 1], [0.99, 1.01]) },
      {
        scaleY:
          interpolate(breath.value, [0, 1], [0.99, 1.01]) *
          interpolate(nod.value, [0, 1], [1, 0.94]),
      },
    ],
  }));

  const eyeStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(gaze.value, GAZE_INPUT, GAZE_X) * gazeX },
      { translateY: interpolate(gaze.value, GAZE_INPUT, GAZE_Y) * gazeY },
      // Das Lid: die Pupillen werden flach gedrückt. Ein Rest bleibt stehen (0.06
      // statt 0), sonst verschwinden die Augen für einen Moment ganz und das
      // Gesicht wirkt kurz leer statt geschlossen.
      { scaleY: interpolate(blink.value, [0, 1], [1, 0.06]) },
    ],
  }));

  const armStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${interpolate(wave.value, [0, 1], [0, waveAngle])}deg` }],
  }));

  return (
    <View
      style={style}
      accessibilityRole={label ? 'image' : undefined}
      accessibilityLabel={label}
      accessibilityElementsHidden={!label}
      importantForAccessibility={label ? 'yes' : 'no-hide-descendants'}>
      {/* Der Schatten liegt AUSSERHALB der bewegten Ebene und bleibt dadurch
          liegen, während die Figur steigt. Genau das macht aus dem Auf und Ab
          einen Sprung: Ohne festen Bezugspunkt wandert das ganze Bild, und dann
          sieht dieselbe Bewegung nach Wackeln aus. Er liegt zuerst im Baum, also
          hinter der Figur – und `pointerEvents: none`, damit er keine Tipps
          abfängt, wenn die Figur in einem Knopf sitzt. */}
      <MascotShadow size={size} color={color} />

      <Animated.View style={[bodyOrigin, bodyStyle]}>
        <MascotBody mood={mood} size={size} color={color} faceColor={faceColor} waves={waves} />

        {/* Der Winkarm. Eigene Ebene, weil er um die SCHULTER drehen muss und nicht
            um die Bildmitte – dafür sitzt der Bezugspunkt auf dem Ansatz. Er liegt
            immer hier, auch ohne Geste: ein zweiter Zeichenweg für „winkt nicht"
            wäre die Stelle, an der später ein Arm fehlt. */}
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { transformOrigin: shoulderOrigin(mood, size) },
            armStyle,
          ]}>
          <MascotArm mood={mood} size={size} color={color} />
        </Animated.View>

        {/* Die Pupillen – nur bei offenen Augen. Bezugspunkt auf der Augenlinie,
            damit das Zusammendrücken beim Blinzeln dort passiert, wo das Lid ist. */}
        {eyesOpen ? (
          <Animated.View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              { transformOrigin: [size / 2, (EYE_LINE / 92) * size, 0] },
              eyeStyle,
            ]}>
            <MascotEyes size={size} faceColor={faceColor} />
          </Animated.View>
        ) : null}
      </Animated.View>
    </View>
  );
}

/**
 * Der Schatten – als eigene Ebene, weil er sich nicht mitbewegen darf.
 *
 * Dieselbe `viewBox` und dieselbe Größe wie die Figur, damit die Ellipse ohne
 * eigene Rechnung genau dort sitzt, wo sie vorher in der Zeichnung saß. Absolut
 * positioniert: So bestimmt weiter die Figur die Größe des Elternteils, und ein
 * `translateY` auf ihr verschiebt den Schatten nicht mit (Transformationen ändern
 * kein Layout).
 */
function MascotShadow({ size, color }: { size: number; color?: string }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 92 92"
      fill="none"
      pointerEvents="none"
      style={StyleSheet.absoluteFill}>
      <Ellipse cx={46} cy={86} rx={20} ry={3.4} fill={color ?? DEFAULT_BODY} opacity={0.18} />
    </Svg>
  );
}

/**
 * Nur die Zeichnung – getrennt, damit die Animation oben nichts über SVG wissen
 * muss und diese Datei an einer Stelle geändert wird, wenn sich die Form ändert.
 */
function MascotBody({
  mood,
  size,
  color,
  faceColor,
  waves,
}: {
  mood: MascotMood;
  size: number;
  color?: string;
  faceColor: string;
  waves: boolean;
}) {
  const body = color ?? DEFAULT_BODY;
  /**
   * Eindeutige Verlaufs-ID je Figur. Im Web teilen sich alle SVGs einer Seite
   * EINEN Namensraum für IDs – zwei Figuren mit derselben ID bekämen sonst den
   * Verlauf der ersten, auch wenn die zweite eine andere Farbe hat.
   */
  const skinId = `goenni-skin-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  return (
    <Svg width={size} height={size} viewBox="0 0 92 92" fill="none">
      {/* Glanz wie im Instagram-Logo: oben heller, unten satter. */}
      <Defs>
        <SvgLinearGradient id={skinId} x1="0.2" y1="0" x2="0.8" y2="1">
          <Stop offset="0" stopColor={shade(body, 0.28)} />
          <Stop offset="0.55" stopColor={body} />
          <Stop offset="1" stopColor={shade(body, -0.12)} />
        </SvgLinearGradient>
      </Defs>
      {/* Der Schatten steht NICHT hier: Er gehört zur festen Ebene darunter
          (`MascotShadow`), sonst würde er beim Hüpfen mitspringen. */}

      {/* Antenne mit Kugel. Das eine Merkmal, an dem man die Figur wiedererkennt.
          Beim „Oh oh" knickt sie zur Seite ab – das trägt den Zustand auch dann,
          wenn die Figur zu klein ist, um das Gesicht zu erkennen. */}
      <Path
        d={
          mood === 'cheer'
            ? 'M46 20V9'
            : mood === 'oops'
              ? 'M46 20c0-6.5-3.4-9-8.6-9.4'
              : 'M46 20V11'
        }
        stroke={body}
        strokeWidth={3.4}
        strokeLinecap="round"
        fill="none"
      />
      <Circle
        cx={mood === 'oops' ? 34.4 : 46}
        cy={mood === 'cheer' ? 6.4 : mood === 'oops' ? 10.2 : 8.4}
        r={4.2}
        fill={body}
      />
      {/* Lichtpunkt auf der Antennen-Kugel. */}
      <Circle
        cx={(mood === 'oops' ? 34.4 : 46) - 1.4}
        cy={(mood === 'cheer' ? 6.4 : mood === 'oops' ? 10.2 : 8.4) - 1.4}
        r={1.2}
        fill="#ffffff"
        fillOpacity={0.7}
      />

      {/* Körper: ein weicher Tropfen, unten breiter als oben – mit Glanz. */}
      <Path
        d="M46 19c15.5 0 25 11.6 25 27.5 0 16.4-9.8 27.5-25 27.5S21 62.9 21 46.5C21 30.6 30.5 19 46 19Z"
        fill={`url(#${skinId})`}
      />
      {/* Glanzlicht oben links: macht aus der Fläche einen Körper. */}
      <Ellipse cx={36.5} cy={29} rx={7.5} ry={4.2} transform="rotate(-24 36.5 29)" fill="#ffffff" fillOpacity={0.28} />

      {waves ? (
        <Path
          d="M82.5 30.5c1.9 1.3 2.4 3.4 2 5.8M85.4 26.6c3 2 3.9 5.4 3.2 9.4"
          stroke="#25f4ee"
          strokeWidth={1.8}
          strokeLinecap="round"
          fill="none"
        />
      ) : null}

      {/* Linkes Ärmchen. Beim Jubeln nach oben – der Unterschied trägt den Moment
          stärker als jedes Gesicht, weil man ihn auch klein noch sieht. Das RECHTE
          fehlt hier bewusst: Es liegt in `MascotArm`, damit es winken kann. */}
      <Path
        d={mood === 'cheer' ? 'M23 44 13.5 33.5' : 'M22 52l-8 6'}
        stroke={body}
        strokeWidth={5}
        strokeLinecap="round"
      />

      {faceFor(mood, faceColor)}
    </Svg>
  );
}

/**
 * Das rechte Ärmchen – allein, damit es sich um die Schulter drehen kann.
 *
 * Dass es IMMER in dieser Ebene liegt (und nicht nur beim Winken), ist Absicht:
 * Zwei Zeichenwege für „winkt" und „winkt nicht" wären die Stelle, an der später
 * jemand einen Arm vergisst. Ohne Geste steht die Ebene einfach still.
 */
function MascotArm({
  mood,
  size,
  color,
}: {
  mood: MascotMood;
  size: number;
  color?: string;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 92 92" fill="none" pointerEvents="none">
      <Path
        d={mood === 'cheer' ? 'M69 44l9.5-10.5' : 'M70 52l8 6'}
        stroke={color ?? DEFAULT_BODY}
        strokeWidth={5}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/**
 * Leerzustand mit Figur, Überschrift und Erklärung.
 *
 * Liegt hier und nicht in jedem Screen, weil ein Leerzustand fast immer dieselben
 * drei Teile hat – und weil die Reihenfolge (Figur, dann fetter Satz, dann
 * Erklärung) genau die ist, in der Leute so eine Fläche lesen.
 */
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
  /**
   * Geste für diesen Leerzustand. Ohne Angabe steht die Figur still (außer
   * Atmen, Hüpfen, Blinzeln) – ein Leerzustand ist kein Ort für Betriebsamkeit.
   * Wo der Zustand aber eine Einladung IST („such dir Leute"), passt ein Winken.
   */
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
 * Der Fehlerzustand – überall dort, wo vorher eine rote Textzeile stand.
 *
 * ## Warum eine Figur und nicht nur Text
 *
 * „Aktivitäten konnten nicht geladen werden." als roter Satz mitten auf der Seite
 * ist die kälteste Stelle einer App: Man liest eine Beschwerde, weiß nicht, ob man
 * schuld ist, und hat keinen nächsten Schritt. Die Figur nimmt die Schärfe raus
 * („Oh oh"), der zweite Satz sagt trocken, was los ist, und der Knopf gibt einen
 * Weg zurück. Genau in dieser Reihenfolge.
 *
 * Die Texte kommen aus `src/domain/mascot-mood.ts` (`ERROR_REACTION`), damit
 * „Oh oh" nicht in fünf Screens einzeln steht und ein Test sie festhalten kann.
 */
export function MascotError({
  detail,
  onRetry,
  size = 84,
  style,
}: {
  /**
   * Was genau schiefging – die Zeile, die der Screen vorher als roten Text
   * gezeigt hat. Optional: Ohne konkrete Ursache bleibt es bei den zwei Sätzen.
   */
  detail?: string | null;
  /** Ohne Rückrufe kein Knopf: Ein „Nochmal" ohne Wirkung wäre eine Lüge. */
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
      <ThemedText style={[styles.errorHeadline, { color: surface.text }]}>
        {ERROR_REACTION.headline}
      </ThemedText>
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
          style={({ pressed }) => [
            styles.retry,
            { borderColor: surface.chipBorder, backgroundColor: surface.chipBg },
            pressed && styles.retryPressed,
          ]}>
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
