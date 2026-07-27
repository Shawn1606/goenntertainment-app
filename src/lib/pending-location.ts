/**
 * Winziger Zwischenspeicher, um das Ergebnis des Karten-Orts-Pickers zurück an
 * den „Activity erstellen"-Screen zu geben. expo-router kann beim `back()` keine
 * Werte mitgeben, darum legen wir die Auswahl hier ab und holen sie beim
 * erneuten Fokussieren des Formulars ab (siehe create-activity.tsx).
 */
import type { Coords } from '@/lib/geocode';

export type PickedLocation = {
  /** Straße & Hausnummer, z. B. „Musterstraße 12". Leer, wenn nicht ermittelbar. */
  street: string;
  /** Ort/Stadt (ggf. mit PLZ), z. B. „50667 Köln". */
  place: string;
  /** Gut lesbare Gesamtzeile für Anzeigezwecke. */
  label: string;
  coords: Coords;
};

let pending: PickedLocation | null = null;

export function setPickedLocation(value: PickedLocation): void {
  pending = value;
}

/** Holt die Auswahl einmalig ab und leert den Speicher. */
export function takePickedLocation(): PickedLocation | null {
  const value = pending;
  pending = null;
  return value;
}
