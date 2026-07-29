/**
 * Erzeugt die UI-Klänge unter `assets/sounds/` – ausführen mit
 * `node scripts/make-sounds.mjs`.
 *
 * Warum synthetisiert und nicht heruntergeladen: Ein Klang, der als Binärdatei
 * im Repo liegt, ist nicht nachvollziehbar – niemand kann später sagen, woher er
 * kam, ob er lizenziert ist oder wie man ihn eine Terz höher bekommt. Hier steht
 * er als Rezept, ist lizenzfrei und in einer Zeile veränderbar.
 *
 * Gestalterische Vorgaben (aus den Regeln für Systemklänge, die Apple und
 * Material gleichermaßen aufstellen):
 *  - **Kurz.** Alles unter ~700 ms. Ein UI-Klang, der ausklingt, während man
 *    schon weitertippt, ist im Weg.
 *  - **Weich einsetzen, weich ausklingen.** Ein harter Sample-Start klickt auf
 *    kleinen Lautsprechern; deshalb ein paar Millisekunden Anlauf.
 *  - **Leise.** Auf etwa -9 dBFS normiert statt Vollaussteuerung. Die App darf
 *    nicht lauter sein als die Musik, die daneben läuft.
 *  - **Konsonant.** Reine Intervalle (Terz, Quinte, Oktave) über einem Grundton;
 *    für „ging nicht" abwärts statt dissonant – ein Fehler soll informieren,
 *    nicht erschrecken.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'assets', 'sounds');

const RATE = 44100;
/** Zielpegel. 0.35 entspricht ungefähr -9 dBFS. */
const PEAK = 0.35;

/**
 * Ein Ton mit weichem Ein- und Ausschwingen.
 *
 * Die zweite Harmonische liegt leise darüber: Eine reine Sinusschwingung klingt
 * auf Handy-Lautsprechern dünn und wird bei kleinen Pegeln fast unhörbar.
 */
function tone({ freq, start, duration, gain = 1 }) {
  const attack = 0.006;
  const samples = [];
  const total = Math.round(duration * RATE);
  for (let i = 0; i < total; i += 1) {
    const t = i / RATE;
    const rise = Math.min(1, t / attack);
    // Exponentiell ausklingen – so hört es sich nach Anschlag an, nicht nach
    // abgeschnittenem Dauerton.
    const decay = Math.exp(-t * (3.2 / duration));
    const wave =
      Math.sin(2 * Math.PI * freq * t) + 0.22 * Math.sin(2 * Math.PI * freq * 2 * t);
    samples.push({ at: Math.round(start * RATE) + i, value: wave * rise * decay * gain });
  }
  return samples;
}

/** Mischt Töne in einen Puffer und normiert auf {@link PEAK}. */
function render(voices) {
  const length = Math.max(...voices.flat().map((s) => s.at)) + 1;
  const buffer = new Float64Array(length);
  for (const voice of voices) {
    for (const { at, value } of voice) buffer[at] += value;
  }

  let max = 0;
  for (const value of buffer) max = Math.max(max, Math.abs(value));
  const scale = max === 0 ? 0 : PEAK / max;
  for (let i = 0; i < buffer.length; i += 1) buffer[i] *= scale;
  return buffer;
}

/** 16-Bit-Mono-WAV. Kleiner geht es für eine Datei kaum, die überall läuft. */
function wav(buffer) {
  const data = Buffer.alloc(buffer.length * 2);
  for (let i = 0; i < buffer.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, buffer[i]));
    data.writeInt16LE(Math.round(clamped * 32767), i * 2);
  }

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // Länge des fmt-Blocks
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // Mono
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28); // Bytes pro Sekunde
  header.writeUInt16LE(2, 32); // Bytes pro Frame
  header.writeUInt16LE(16, 34); // Bits pro Sample
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);

  return Buffer.concat([header, data]);
}

/** Gleichstufige Stimmung ab a' = 440 Hz. */
function note(semitonesFromA4) {
  return 440 * 2 ** (semitonesFromA4 / 12);
}

const C6 = note(15);
const E6 = note(19);
const G6 = note(22);
const C7 = note(27);
const A4 = note(0);
const F4 = note(-4);

const SOUNDS = {
  /**
   * „Du bist dabei." Zwei Töne aufwärts, Terz und Quinte – der Moment, auf den
   * die ganze App hinausläuft, darf sich nach etwas anfühlen.
   */
  success: [tone({ freq: C6, start: 0, duration: 0.3 }), tone({ freq: G6, start: 0.085, duration: 0.34 })],

  /**
   * „Ging nicht." Zwei kurze Töne abwärts, tief und stumpf. Kein Dissonanz-
   * Effekt: Ein Fehler ist meistens keine Katastrophe, sondern ein voller Kurs.
   */
  error: [tone({ freq: A4, start: 0, duration: 0.12 }), tone({ freq: F4, start: 0.1, duration: 0.18 })],

  /**
   * „Geschafft." Der längste der vier – für Wochenziel und Abzeichen, also für
   * etwas, das man höchstens einmal am Tag hört.
   */
  goal: [
    tone({ freq: C6, start: 0, duration: 0.26 }),
    tone({ freq: E6, start: 0.075, duration: 0.26 }),
    tone({ freq: G6, start: 0.15, duration: 0.3 }),
    tone({ freq: C7, start: 0.225, duration: 0.42, gain: 0.85 }),
  ],

  /**
   * „Auf." Ein einzelner sehr kurzer Ton, wenn sich ein Blatt öffnet. Bewusst
   * fast nichts – er soll die Bewegung begleiten, nicht kommentiert werden.
   */
  pop: [tone({ freq: G6, start: 0, duration: 0.07, gain: 0.6 })],
};

mkdirSync(OUT, { recursive: true });
for (const [name, voices] of Object.entries(SOUNDS)) {
  const file = join(OUT, `${name}.wav`);
  const bytes = wav(render(voices));
  writeFileSync(file, bytes);
  console.log(`${name}.wav  ${(bytes.length / 1024).toFixed(1)} kB`);
}
