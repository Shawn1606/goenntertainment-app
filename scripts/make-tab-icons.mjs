/**
 * Erzeugt die Symbole der unteren Leiste unter `assets/images/tabIcons/` –
 * ausführen mit `node scripts/make-tab-icons.mjs`.
 *
 * Warum gezeichnet und nicht gemalt: Die Symbole lagen vorher als Binärdateien
 * im Repo. Niemand konnte sagen, wie sie entstanden sind, und „mach das Haus
 * etwas größer" hieß: neu malen und hoffen, dass die Strichstärke zu den anderen
 * passt. Hier stehen sie als Rezept – eine Zahl ändern, Skript laufen lassen.
 *
 * ## Die eine Vorgabe, die dieses Skript umsetzt
 *
 * **Home ist größer als die anderen.** Home liegt in der Mitte der Leiste und
 * soll das Ziel sein, das man ohne Hinsehen trifft. Am Handy geht das
 * ausschließlich über die Zeichnung: Androids untere Leiste gibt jedem Eintrag
 * dasselbe Kästchen (24 dp) und skaliert jedes Bild hinein – ein größeres PNG
 * wird einfach kleiner gerechnet. „Größer" heißt hier also: Das Haus füllt sein
 * Kästchen fast vollständig (`COVERAGE.home`), alle anderen füllen deutlich
 * weniger (`COVERAGE.rest`) und sind untereinander gleich groß. Genau dieser
 * Unterschied ist am Ende sichtbar.
 *
 * ## Aufbau
 *
 * Jedes Symbol ist eine Funktion `(x, y) => boolean` im Einheitsquadrat
 * (0…1, y nach unten): „liegt dieser Punkt in der Zeichnung?" Das ist die
 * kürzeste Form, in der man eine Silhouette hinschreiben kann, ohne einen
 * Pfad-Zeichner zu bauen. Kanten werden weich, indem jedes Pixel an 4x4 Stellen
 * gefragt wird – der Mittelwert ist die Deckkraft (Kantenglättung ohne Bibliothek).
 *
 * Gespeichert wird **weiß mit Alpha**, wie das bisherige Karten-Symbol: Die
 * Leiste färbt die Symbole ohnehin selbst (`iconColor`/`selectedColor` in
 * app-tabs.tsx), gebraucht wird also nur die Form. Weiß statt Schwarz, weil ein
 * ungefärbtes Symbol so auf dem dunklen Hintergrund der App sichtbar bleibt.
 *
 * Drei Größen je Symbol (24/48/72 px = @1x/@2x/@3x): Diese Namen erwartet der
 * Metro-Bundler, um je nach Bildschirmdichte das passende zu nehmen.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'assets', 'images', 'tabIcons');

/** @1x, @2x, @3x – dieselben Kantenlängen wie die bisherigen Dateien. */
const SIZES = [24, 48, 72];

/** Wie viele Proben pro Pixel und Achse (4x4 = 16 Proben) für weiche Kanten. */
const SAMPLES = 4;

/**
 * Wie viel von der Fläche ein Symbol einnimmt.
 *
 * Das ist die Stelle, an der die Rangfolge der Leiste steht. Der Abstand
 * zwischen den beiden Zahlen ist der sichtbare Größenunterschied; 1.00 wäre
 * randlos und würde bei runden Formen an den Kanten beschnitten aussehen.
 */
const COVERAGE = {
  home: 0.98,
  rest: 0.72,
  /**
   * Die Nadel bekommt etwas mehr, weil sie SCHMAL ist: Bei 0.72 ist sie 12 px
   * breit, während Zahnrad und Liste 18 px füllen – sie wirkt daneben verloren,
   * obwohl die Zahl dieselbe ist. Verglichen wird hier nicht die Rechenvorgabe,
   * sondern was man sieht.
   */
  pin: 0.84,
};

/* --------------------------------------------------------------- Grundformen */

const rect = (x0, y0, x1, y1) => (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1;

const circle = (cx, cy, r) => (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;

/** Dreieck über Vorzeichen der drei Kantenprodukte (alle gleich = innen). */
function triangle([ax, ay], [bx, by], [cx, cy]) {
  const side = (px, py, x0, y0, x1, y1) => (x1 - x0) * (py - y0) - (y1 - y0) * (px - x0);
  return (x, y) => {
    const d1 = side(x, y, ax, ay, bx, by);
    const d2 = side(x, y, bx, by, cx, cy);
    const d3 = side(x, y, cx, cy, ax, ay);
    return (d1 >= 0 && d2 >= 0 && d3 >= 0) || (d1 <= 0 && d2 <= 0 && d3 <= 0);
  };
}

/** Strich mit runden Enden (Abstand Punkt–Strecke <= halbe Dicke). */
function capsule([ax, ay], [bx, by], thickness) {
  const r = thickness / 2;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  return (x, y) => {
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
    return (x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2 <= r * r;
  };
}

const union = (...shapes) => (x, y) => shapes.some((s) => s(x, y));
const minus = (base, ...holes) => (x, y) => base(x, y) && !holes.some((h) => h(x, y));

/* ------------------------------------------------------------------ Symbole */

/**
 * Haus: Dach als Dreieck, darunter der Körper, die Tür ausgeschnitten.
 *
 * Die Tür ist nicht Zierde – ohne sie ist die Silhouette bei dieser Größe ein
 * Fünfeck und von einem Zelt nicht zu unterscheiden. Das Dach ragt links und
 * rechts über den Körper hinaus, weil ein Dach genau das tut.
 */
const home = minus(
  union(
    triangle([0.5, 0.02], [0.0, 0.44], [1.0, 0.44]),
    rect(0.13, 0.42, 0.87, 0.98),
  ),
  rect(0.43, 0.7, 0.57, 0.99),
);

/**
 * Karten-Nadel: Kopf mit Loch, darunter die Spitze.
 *
 * Ersetzt das bisherige Karten-Symbol maßgleich zu den übrigen. Es füllte vorher
 * fast die ganze Höhe und war damit optisch so groß wie Home – der Unterschied,
 * um den es hier geht, wäre daneben nicht zu sehen gewesen.
 */
const mapPin = minus(
  union(circle(0.5, 0.36, 0.34), triangle([0.19, 0.55], [0.81, 0.55], [0.5, 1.0])),
  circle(0.5, 0.36, 0.13),
);

/**
 * Zwei Personen (Freunde): vorne größer, hinten halb dahinter.
 *
 * Eine Person ist Kopf + Schultern, und die Schultern sind die UNTERE Hälfte
 * eines großen Kreises – das ist die Form, die man von Kontakt-Symbolen kennt,
 * und sie bleibt bei 24 dp als Oberkörper lesbar (ein Dreieck wird dort zum
 * Kegel).
 *
 * Der Trick ist der Zwischenraum: Ohne ihn verschmelzen zwei Silhouetten zu
 * einem Klecks. Deshalb wird von der hinteren Person die vordere in leicht
 * größerer Fassung abgezogen (`halo`) – so entsteht eine Lücke von immer
 * gleicher Breite, egal wie groß das PNG ist. Genau so machen es Symbolsätze,
 * die keine zweite Farbe zur Verfügung haben.
 */
function personShape(headX, headY, headR, bodyX, bodyY, bodyR, grow = 0) {
  return union(
    circle(headX, headY, headR + grow),
    minus(circle(bodyX, bodyY, bodyR + grow), rect(0, 0, 1, bodyY - bodyR - grow)),
  );
}

const GAP = 0.05;
const frontPerson = personShape(0.36, 0.3, 0.2, 0.36, 0.98, 0.34);
const people = union(
  frontPerson,
  minus(
    personShape(0.74, 0.25, 0.15, 0.76, 0.9, 0.26),
    personShape(0.36, 0.3, 0.2, 0.36, 0.98, 0.34, GAP),
  ),
);

/**
 * Liste (Aktivitäten): drei Zeilen mit Punkt davor.
 *
 * Drei Zeilen, nicht vier: Bei 24 dp verschmelzen vier Zeilen samt Lücken zu
 * einem Block.
 */
const list = union(
  ...[0.16, 0.5, 0.84].flatMap((y) => [
    // Quadrat statt Kreis als Aufzählungspunkt: Ein Kreis von 3 px Durchmesser
    // ist bei 24 dp ein grauer Fleck, ein Quadrat bleibt eine Kante.
    rect(0.02, y - 0.1, 0.22, y + 0.1),
    capsule([0.42, y], [0.96, y], 0.2),
  ]),
);

/**
 * Zahnrad (Einstellungen): Kranz mit sechs Zähnen und Loch.
 *
 * In Polarkoordinaten hingeschrieben statt als gedrehte Rechtecke – die
 * Zähnezahl ist so eine Zahl im Code und keine Schleife mit Drehmatrix.
 *
 * Sechs Zähne, nicht acht: Der Kranz ist am Ende ~17 px breit. Bei acht Zähnen
 * bleiben je 2 px – das sind Stacheln, keine Zähne. Zahn und Lücke sind gleich
 * breit (Schwelle 0), damit keine Seite in der Anzeige verschwindet.
 */
const GEAR_TEETH = 6;

function gearShape(x, y) {
  const dx = x - 0.5;
  const dy = y - 0.5;
  const r = Math.hypot(dx, dy);
  if (r <= 0.15) return false; // Loch
  const angle = Math.atan2(dy, dx);
  const tooth = Math.cos(angle * GEAR_TEETH) > 0 ? 0.49 : 0.35;
  return r <= tooth;
}

const GLYPHS = {
  home: { shape: home, coverage: COVERAGE.home },
  map: { shape: mapPin, coverage: COVERAGE.pin },
  people: { shape: people, coverage: COVERAGE.rest },
  list: { shape: list, coverage: COVERAGE.rest },
  gear: { shape: gearShape, coverage: COVERAGE.rest },
};

/* ------------------------------------------------------------------ Rastern */

/**
 * Zeichnet ein Symbol in ein PNG der Kantenlänge `size`.
 *
 * `coverage` verkleinert die Zeichnung um ihre Mitte: Der Prüfpunkt wird vor der
 * Abfrage nach außen gerechnet, dadurch schrumpft die Form, ohne dass jede
 * einzelne Koordinate angefasst werden muss.
 */
function render(shape, coverage, size) {
  const png = new PNG({ width: size, height: size });
  const step = 1 / (size * SAMPLES);

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let hits = 0;
      for (let sy = 0; sy < SAMPLES; sy += 1) {
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const u = (px * SAMPLES + sx + 0.5) * step;
          const v = (py * SAMPLES + sy + 0.5) * step;
          if (shape((u - 0.5) / coverage + 0.5, (v - 0.5) / coverage + 0.5)) hits += 1;
        }
      }
      const i = (py * size + px) * 4;
      png.data[i] = 255;
      png.data[i + 1] = 255;
      png.data[i + 2] = 255;
      png.data[i + 3] = Math.round((hits / (SAMPLES * SAMPLES)) * 255);
    }
  }
  return png;
}

mkdirSync(OUT, { recursive: true });

for (const [name, { shape, coverage }] of Object.entries(GLYPHS)) {
  SIZES.forEach((size, index) => {
    const suffix = index === 0 ? '' : `@${index + 1}x`;
    const file = join(OUT, `${name}${suffix}.png`);
    writeFileSync(file, PNG.sync.write(render(shape, coverage, size)));
    console.log(`${name}${suffix}.png (${size}x${size})`);
  });
}
