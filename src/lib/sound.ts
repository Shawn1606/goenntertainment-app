/**
 * Kurze Klänge für einzelne Momente.
 *
 * ## Warum das standardmäßig AUS ist
 *
 * Klang ist der übergriffigste Rückkanal, den eine App hat: Vibration spürt nur
 * die Person am Gerät, ein Ton hören alle im Bus mit. Entsprechend ist die
 * verbreitetste Beschwerde über App-Klänge nicht, dass sie schlecht klingen,
 * sondern dass sie ungefragt an waren. Deshalb:
 *
 *  - **Vorgabe: aus.** Wer sie will, schaltet sie in den Einstellungen ein.
 *  - **Stummschalter gilt.** `playsInSilentMode: false` – ist das Gerät stumm,
 *    bleibt die App stumm. Ein UI-Klang ist niemals wichtig genug, um den
 *    Schalter zu übergehen.
 *  - **Fremde Musik läuft weiter.** `interruptionMode: 'mixWithOthers'` – genau
 *    der Modus, den die Dokumentation für kurze Effekte empfiehlt. Niemand will,
 *    dass sein Podcast stoppt, weil er einem Event beigetreten ist.
 *  - **Nur bei Bedeutung.** Vier Klänge für vier Ereignisse, kein Ton pro Tipp.
 *    Ein Klang, den man zwanzigmal pro Sitzung hört, wird abgeschaltet – und
 *    nimmt die drei nützlichen mit.
 *
 * ## Warum das so robust gebaut ist
 *
 * `expo-audio` ist ein Native-Modul. In einem Dev-Client, der vor der
 * Installation gebaut wurde, fehlt es – dann wirft der erste Zugriff. Ein
 * fehlender Klang darf aber nie einen Beitritt verhindern: Alles hier schluckt
 * Fehler und merkt sich beim ersten Misserfolg, dass Klang in dieser Sitzung
 * nicht geht. Danach kostet der Aufruf nichts mehr.
 *
 * Gleiches Muster wie `haptics.ts`: Modul-Zustand statt Hook, weil diese
 * Funktionen aus Ereignis-Handlern überall in der App gerufen werden – ein Hook
 * würde jeden Aufrufer zur Komponente machen.
 */
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';

/** Die Klänge, die es gibt. Neuer Klang = Datei, Zeile hier, Zeile in SOURCES. */
export type SoundName = 'success' | 'error' | 'goal' | 'pop';

/**
 * Die Dateien. Erzeugt von `scripts/make-sounds.mjs` – dort steht auch, wie sie
 * klingen sollen und warum.
 */
const SOURCES: Record<SoundName, number> = {
  success: require('../../assets/sounds/success.wav'),
  error: require('../../assets/sounds/error.wav'),
  goal: require('../../assets/sounds/goal.wav'),
  pop: require('../../assets/sounds/pop.wav'),
};

/** Folgt dem Schalter in den Einstellungen. Vorgabe: aus. */
let enabled = false;

/** Einmal fehlgeschlagen heißt: in dieser Sitzung gibt es keinen Klang. */
let unavailable = false;

/** Der Audio-Modus wird beim ersten Ton gesetzt, nicht beim Start der App. */
let modeSet = false;

const players = new Map<SoundName, AudioPlayer>();

/** Klänge an-/abschalten (folgt dem Schalter in den Einstellungen). */
export function setSoundEnabled(value: boolean): void {
  enabled = value;
}

/**
 * Alles freigeben.
 *
 * Native Player halten Ressourcen. Beim Abschalten in den Einstellungen werden
 * sie deshalb weggeräumt statt still weiterzuleben – wer Klänge aus hat, soll
 * auch nichts mehr davon im Speicher haben.
 */
export function releaseSounds(): void {
  for (const player of players.values()) {
    try {
      player.remove();
    } catch {
      // Ein Player, der sich nicht abräumen lässt, ist kein Grund für einen Absturz.
    }
  }
  players.clear();
}

/**
 * Audio-Modus setzen: Stummschalter gilt, fremde Wiedergabe läuft weiter.
 *
 * Bewusst nicht `await`-et vom Aufrufer: Der erste Ton kommt dann eventuell
 * einen Wimpernschlag zu früh, aber der Tipp fühlt sich sofort an. Beim zweiten
 * Ton steht der Modus.
 */
function ensureMode(): void {
  if (modeSet) return;
  modeSet = true;
  void setAudioModeAsync({
    playsInSilentMode: false,
    interruptionMode: 'mixWithOthers',
  }).catch(() => {});
}

function playerFor(name: SoundName): AudioPlayer | null {
  const existing = players.get(name);
  if (existing) return existing;

  const created = createAudioPlayer(SOURCES[name]);
  // Etwas unter der Vollaussteuerung: Die Dateien sind schon leise gemischt,
  // hier kommt der Sicherheitsabstand für laute Geräte dazu.
  created.volume = 0.7;
  players.set(name, created);
  return created;
}

/**
 * Einen Klang spielen. Tut nichts, wenn Klänge aus sind oder nicht gehen.
 *
 * Wird bewusst nicht exportiert: Aufrufer sollen ein **Ereignis** benennen
 * (`feedback.joined()`), nicht einen Klang auswählen. Sonst liegt die
 * Entscheidung „welcher Ton passt zu welchem Moment" wieder in fünfzig Screens.
 */
function play(name: SoundName, force = false): void {
  if ((!enabled && !force) || unavailable) return;
  try {
    ensureMode();
    const player = playerFor(name);
    if (!player) return;
    // Zurückspulen: Ein Player, der schon am Ende steht, spielt sonst nichts.
    void player.seekTo(0).catch(() => {});
    player.play();
  } catch {
    // Native-Modul fehlt (alter Dev-Client) oder das Gerät mag die Datei nicht.
    // Ab hier bleibt es still, ohne weitere Versuche.
    unavailable = true;
  }
}

/** Handlung geglückt – beigetreten, Event erstellt. */
export function success(): void {
  play('success');
}

/** Handlung ging nicht – voll, keine Verbindung. */
export function error(): void {
  play('error');
}

/** Etwas erreicht – Wochenziel, Abzeichen. Der einzige längere Klang. */
export function goal(): void {
  play('goal');
}

/** Ein Blatt geht auf. Sehr kurz, begleitet nur die Bewegung. */
export function pop(): void {
  play('pop');
}

/**
 * Einmal vorspielen, auch wenn der Schalter (noch) aus ist.
 *
 * Gibt es genau für einen Fall: Man legt den Schalter in den Einstellungen um
 * und will hören, was man da eingeschaltet hat. Ohne diesen Weg passiert nichts –
 * `setSoundEnabled` läuft erst im Effekt nach dem Render, der Ton käme also ins
 * Leere und der Schalter würde wirken, als sei er kaputt.
 *
 * Absichtlich die einzige Ausnahme vom Schalter, und absichtlich nur vom
 * Einstellungs-Bildschirm aus benutzt.
 */
export function preview(): void {
  play('goal', true);
}
