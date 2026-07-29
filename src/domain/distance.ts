/**
 * Entfernungen zwischen zwei Koordinaten – reine Rechenlogik, ohne React,
 * React Native oder API-Zugriff. Dadurch in Node direkt testbar
 * (`npm test`) und in jeder Schicht der App wiederverwendbar.
 */

export type LatLng = { latitude: number; longitude: number };

const EARTH_RADIUS_KM = 6371;

const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Luftlinie in Kilometern (Haversine). */
export function distanceKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/**
 * Entfernung so schreiben, wie man sie sagt: „350 m", „1,2 km", „35 km".
 * Unbekannte Entfernungen ergeben `null`, damit die Oberfläche einfach nichts
 * anzeigt statt „NaN km".
 */
export function formatDistance(km: number | null | undefined): string | null {
  if (km === null || km === undefined || !Number.isFinite(km) || km < 0) {
    return null;
  }
  if (km < 1) {
    // Auf 50 m runden – mehr Genauigkeit täuscht bei geocodierten Adressen nur vor.
    const meters = Math.max(50, Math.round((km * 1000) / 50) * 50);
    return `${meters} m`;
  }
  if (km < 10) {
    return `${km.toFixed(1).replace('.', ',')} km`;
  }
  return `${Math.round(km)} km`;
}
