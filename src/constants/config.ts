import Constants from 'expo-constants';

/**
 * Basis-URL des JS-Backends (Ordner `server/`, ersetzt das alte Laravel).
 *
 * Fürs Handy zählt NICHT `localhost` (das wäre das Handy selbst), sondern die
 * LAN-IP deines PCs. Im Dev-Betrieb raten wir sie automatisch aus der Metro-
 * Adresse (gleiche Adresse wie Expo, nur Port 8000).
 *
 * Backend dafür so starten (im Ordner `server/`):
 *   npm run dev        (oder: npm start)
 *
 * Wenn das Raten mal nicht passt, trage die URL hier fest ein, z. B.:
 *   const HARDCODED_API_URL = 'http://192.168.178.44:8000';
 */
// Fest auf die WLAN-IP dieses PCs gesetzt: Das automatische Raten aus der Expo-
// Adresse liefert hier eine unbrauchbare Adresse (127.0.0.1 = das Handy selbst,
// oder die Hamachi-VPN-IP 25.x, die das Handy im WLAN nicht erreicht) -> Login
// lief in einen Timeout. Das Handy muss im selben Fritzbox-WLAN (192.168.178.x) sein.
// Aendert sich die PC-IP, hier anpassen (ipconfig -> IPv4 des WLAN-Adapters).
const HARDCODED_API_URL: string | null = 'http://192.168.178.25:8000';

const BACKEND_PORT = 8000;

function guessDevHost(): string {
  const hostUri =
    Constants.expoConfig?.hostUri ??
    // ältere Expo-Go-Variante
    (Constants as unknown as { expoGoConfig?: { debuggerHost?: string } }).expoGoConfig?.debuggerHost;

  const host = hostUri?.split(':')[0];

  return host ? `http://${host}:${BACKEND_PORT}` : `http://localhost:${BACKEND_PORT}`;
}

export const API_BASE_URL = HARDCODED_API_URL ?? guessDevHost();

export const API_URL = `${API_BASE_URL}/api`;
