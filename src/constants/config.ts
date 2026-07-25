import Constants from 'expo-constants';

/**
 * Basis-URL des Laravel-Backends.
 *
 * Fürs Handy zählt NICHT `localhost` (das wäre das Handy selbst), sondern die
 * LAN-IP deines PCs. Im Dev-Betrieb raten wir sie automatisch aus der Metro-
 * Adresse (gleiche Adresse wie Expo, nur Port 8000).
 *
 * Backend dafür so starten (im Laravel-Ordner):
 *   php artisan serve --host=0.0.0.0 --port=8000
 *
 * Wenn das Raten mal nicht passt, trage die URL hier fest ein, z. B.:
 *   const HARDCODED_API_URL = 'http://192.168.178.44:8000';
 */
// Fest auf die WLAN-IP dieses PCs gesetzt, damit das Handy das Backend sicher
// erreicht (der PC hat mehrere Netz-Adressen; Auto-Raten kann die falsche treffen).
// Ändert sich die PC-IP (DHCP), hier anpassen. Für Emulator/Web ggf. auf null zurück.
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
