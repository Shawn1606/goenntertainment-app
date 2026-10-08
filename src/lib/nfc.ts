/**
 * NFC lesen – den GÖ4Fun-Aufkleber an der Kasse eines Partners.
 *
 * ## Warum hier alles „vielleicht" ist
 *
 * NFC braucht ein natives Modul (react-native-nfc-manager). Das gibt es nur in
 * einem eigenen Build (Development Build, TestFlight, Store) – NICHT in Expo Go
 * und nicht im Browser. Das Paket legt beim Laden sofort einen
 * `NativeEventEmitter` an, und der wirft auf dem iPhone, wenn das Modul fehlt.
 * Deshalb wird es erst geladen, wenn feststeht, dass das Modul da ist.
 *
 * Fehlt NFC (Expo Go, Web, Handy ohne NFC, NFC ausgeschaltet), zeigt der
 * Check-in einfach nur den QR-Weg – der Aufkleber trägt beides.
 */
import { NativeModules, Platform } from 'react-native';

type NfcModule = typeof import('react-native-nfc-manager');

let loaded: NfcModule | null | undefined;
let started = false;

function nfcModule(): NfcModule | null {
  if (loaded !== undefined) return loaded;
  if (Platform.OS === 'web' || !NativeModules.NfcManager) {
    loaded = null;
    return null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    loaded = require('react-native-nfc-manager') as NfcModule;
  } catch {
    loaded = null;
  }
  return loaded;
}

export type NfcState = 'ready' | 'disabled' | 'unsupported';

/** Kann dieses Gerät jetzt einen Aufkleber lesen? */
export async function nfcState(): Promise<NfcState> {
  const mod = nfcModule();
  if (!mod) return 'unsupported';
  try {
    const manager = mod.default;
    if (!(await manager.isSupported())) return 'unsupported';
    if (!started) {
      await manager.start();
      started = true;
    }
    return (await manager.isEnabled()) ? 'ready' : 'disabled';
  } catch {
    return 'unsupported';
  }
}

/**
 * Wartet auf einen Aufkleber und gibt dessen Inhalt zurück (die Adresse mit dem
 * Partner-Code) – oder `null`, wenn abgebrochen wurde oder nichts Lesbares
 * darauf stand. Auf dem iPhone erscheint dafür das System-Blatt „Bereit zum
 * Scannen".
 */
export async function readSticker(): Promise<string | null> {
  const mod = nfcModule();
  if (!mod) return null;
  const { default: manager, NfcTech, Ndef } = mod;
  try {
    await manager.requestTechnology(NfcTech.Ndef, {
      alertMessage: 'Halte dein Handy an den GÖ4Fun-Aufkleber.',
    });
    const tag = await manager.getTag();
    const records = tag?.ndefMessage ?? [];
    for (const record of records) {
      const payload = Uint8Array.from(record.payload as number[]);
      // URI-Datensatz (TNF 1, Typ „U") – so steht die Adresse auf dem Aufkleber.
      try {
        const uri = Ndef.uri.decodePayload(payload);
        if (uri) return uri;
      } catch {
        // kein URI – vielleicht Text
      }
      try {
        const text = Ndef.text.decodePayload(payload);
        if (text) return text;
      } catch {
        // weiter mit dem nächsten Datensatz
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    try {
      await manager.cancelTechnologyRequest();
    } catch {
      // schon beendet
    }
  }
}

/** Laufendes Lesen abbrechen (Bildschirm wird verlassen). */
export async function cancelNfc(): Promise<void> {
  const mod = nfcModule();
  if (!mod) return;
  try {
    await mod.default.cancelTechnologyRequest();
  } catch {
    // nichts offen
  }
}
