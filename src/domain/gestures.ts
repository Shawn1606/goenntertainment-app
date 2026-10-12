/**
 * Gesten als reine Zahlen: wann ein Wischen den Tab wechselt, wann ein Blatt
 * oder Bildschirm zugeht, wann Scrollen „ganz schnell" war – und wie hoch Goenni
 * dann fliegt.
 *
 * Die Gesten selbst laufen auf dem UI-Thread (react-native-gesture-handler und
 * Reanimated) und rufen diese Funktionen dort auf. Darum trägt jede die
 * Anweisung `'worklet'`: Das Babel-Plugin macht sie damit auf dem UI-Thread
 * aufrufbar. In Node (Tests) ist die Zeile ein wirkungsloser String.
 *
 * Kein React, kein Gerät – damit Tests die Schwellen festhalten.
 */

/* ============================================================ Tabs */

/** Ab diesem Anteil der Breite wechselt auch ein langsames Wischen den Tab. */
export const TAB_SWIPE_DISTANCE = 0.3;

/** … oder ab diesem Tempo (Punkte je Sekunde) – ein kurzer Schubs reicht. */
export const TAB_SWIPE_VELOCITY = 550;

/** Mindestweg für den Schubs: darunter ist es ein Zittern, kein Wischen. */
export const TAB_SWIPE_MIN = 32;

/** Wo es keinen Nachbarn gibt, folgt die Seite nur gedämpft (Gummiband). */
export const EDGE_RESISTANCE = 0.22;

/**
 * Zu welchem Tab ein Wischen führt – oder `null`, wenn die Seite zurückfedert.
 *
 * `dx` ist der Fingerweg (negativ = nach links = zum nächsten Tab rechts),
 * `vx` das Tempo beim Loslassen. Ein Schubs zählt nur in Wischrichtung: Wer erst
 * nach rechts zieht und dann zurückschnippt, will bleiben.
 */
export function tabSwipeTarget(
  index: number,
  count: number,
  dx: number,
  vx: number,
  width: number,
  blocked: readonly number[] = [],
): number | null {
  'worklet';
  if (!(width > 0) || count <= 0 || !Number.isFinite(dx) || dx === 0) return null;
  const target = dx < 0 ? index + 1 : index - 1;
  if (target < 0 || target >= count) return null;
  for (let i = 0; i < blocked.length; i++) if (blocked[i] === target) return null;
  const far = Math.abs(dx) >= width * TAB_SWIPE_DISTANCE;
  const flick = Math.abs(dx) >= TAB_SWIPE_MIN && Math.abs(vx) >= TAB_SWIPE_VELOCITY && vx * dx > 0;
  return far || flick ? target : null;
}

/**
 * Wie weit die Seite dem Finger folgt: höchstens eine Breite, und dort, wo kein
 * Nachbar wartet (erster/letzter Tab, gesperrter Nachbar), nur gedämpft.
 */
export function tabDragOffset(index: number, count: number, dx: number, width: number, blocked: readonly number[] = []): number {
  'worklet';
  if (!Number.isFinite(dx)) return 0;
  const limited = Math.max(-width, Math.min(width, dx));
  const target = dx < 0 ? index + 1 : index - 1;
  let open = target >= 0 && target < count;
  for (let i = 0; i < blocked.length; i++) if (blocked[i] === target) open = false;
  return open ? limited : limited * EDGE_RESISTANCE;
}

/* ============================================================ Blätter und Bildschirme */

/** Ab diesem Tempo nach unten (Punkte je Sekunde) geht es auch nach kurzem Weg zu. */
export const DISMISS_VELOCITY = 800;

/** Mindestweg für den Schubs nach unten. */
export const DISMISS_MIN = 20;

/**
 * Wie weit man ein Blatt (oder einen Bildschirm) der Höhe `height` ziehen muss:
 * ein Viertel, aber mindestens 80 und höchstens 140 Punkte – ein hohes Blatt soll
 * nicht den halben Bildschirm Weg verlangen, ein kleines nicht beim Antippen zugehen.
 */
export function dismissDistance(height: number): number {
  'worklet';
  const quarter = Number.isFinite(height) && height > 0 ? height * 0.25 : 140;
  return Math.min(140, Math.max(80, quarter));
}

/** Weit oder schnell genug nach unten gezogen, um zu schließen? */
export function shouldDismiss(dy: number, vy: number, height: number): boolean {
  'worklet';
  if (!(dy > 0)) return false;
  if (dy >= dismissDistance(height)) return true;
  return dy >= DISMISS_MIN && vy >= DISMISS_VELOCITY;
}

/* ============================================================ Detailseite nach unten wegziehen */

/** Der Inhalt folgt dem Finger nur halb so weit – das fühlt sich schwer an, nicht wackelig. */
export const PULL_RATIO = 0.5;

/** Weiter als so viele Punkte wandert der Inhalt nicht mit. */
export const PULL_MAX = 160;

/** Ab so viel Zug (nach Dämpfung) ist die Seite „scharf": Loslassen schließt. */
export const PULL_TO_CLOSE = 72;

/** Mit Schwung reicht weniger Zug … */
export const PULL_FLICK_MIN = 28;

/** … ab diesem Tempo nach unten (Punkte je Sekunde). */
export const PULL_FLICK_VELOCITY = 1100;

/** Wie weit der Inhalt bei `dy` Fingerweg mitgeht: gedämpft, nie nach oben, gedeckelt. */
export function pullOffset(dy: number): number {
  'worklet';
  if (!(dy > 0)) return 0;
  return Math.min(PULL_MAX, dy * PULL_RATIO);
}

/** Schließt das Loslassen bei diesem Zug und Tempo die Seite? */
export function shouldClosePull(pull: number, vy: number): boolean {
  'worklet';
  if (!(pull > 0)) return false;
  return pull >= PULL_TO_CLOSE || (pull >= PULL_FLICK_MIN && vy >= PULL_FLICK_VELOCITY);
}

/* ============================================================ Goenni fliegt */

/** Ab diesem Tempo nach unten (Punkte je Millisekunde) war Scrollen „ganz schnell". */
export const FAST_SCROLL = 3.2;

/** Ein Messpunkt beim Scrollen: Lage (Punkte) und Zeit (Millisekunden). */
export type ScrollSample = { y: number; t: number };

/**
 * Tempo zwischen zwei Messpunkten in Punkten je Millisekunde, positiv = nach
 * unten. Zu dicht beieinander (Rauschen) oder zu weit auseinander (eine Pause
 * dazwischen) zählt als 0.
 */
export function scrollSpeed(prev: ScrollSample | null, next: ScrollSample): number {
  if (!prev) return 0;
  const dt = next.t - prev.t;
  if (!(dt >= 8 && dt <= 250)) return 0;
  const dy = next.y - prev.y;
  return Number.isFinite(dy) ? dy / dt : 0;
}

/** Wurde zwischen den beiden Messpunkten ganz schnell nach unten gescrollt? */
export function isFastScrollDown(prev: ScrollSample | null, next: ScrollSample): boolean {
  return scrollSpeed(prev, next) >= FAST_SCROLL;
}

/**
 * Wie hoch Goenni fliegt (Punkte), wenn man mit `speed` gescrollt hat: je
 * schneller, desto höher – zwischen gut einem Viertel und gut vier Zehnteln der
 * Bildschirmhöhe, nie über 360 Punkte.
 */
export function flightHeight(speed: number, screenHeight: number): number {
  const h = Number.isFinite(screenHeight) && screenHeight > 0 ? screenHeight : 700;
  const extra = Number.isFinite(speed) ? Math.min(1, Math.max(0, (speed - FAST_SCROLL) / FAST_SCROLL)) : 0;
  return Math.round(Math.min(360, Math.max(160, h * (0.26 + 0.16 * extra))));
}
