/**
 * Umkreis-Wahl für „In deiner Nähe" (Ticket #2).
 *
 * Ist im Grundumkreis nichts los, wird der Radius verdoppelt statt eine leere
 * Liste zu zeigen – so steht in einer ruhigen Gegend trotzdem etwas da, und die
 * Oberfläche kann ehrlich dazuschreiben, dass weiter gesucht wurde.
 */

/** Grundumkreis und die Verdopplungsstufen (km). */
export const RADIUS_STEPS_KM = [30, 60, 120, 240] as const;

export type RadiusChoice = {
  /** Der Umkreis, der am Ende benutzt wurde. */
  radiusKm: number;
  /** true, wenn über den Grundumkreis hinaus gesucht wurde. */
  expanded: boolean;
  /** IDs innerhalb dieses Umkreises. */
  ids: Set<number>;
};

/**
 * Wählt die kleinste Stufe, in der mindestens eine Aktivität liegt.
 * Liegt nichts in Reichweite, bleibt die Trefferliste leer.
 */
export function chooseRadius(
  distanceById: ReadonlyMap<number, number>,
  steps: readonly number[] = RADIUS_STEPS_KM,
): RadiusChoice {
  const base = steps[0];

  if (distanceById.size === 0) {
    return { radiusKm: base, expanded: false, ids: new Set() };
  }

  for (const radiusKm of steps) {
    const ids = new Set<number>();
    for (const [id, distance] of distanceById) {
      if (distance <= radiusKm) ids.add(id);
    }
    if (ids.size > 0) {
      return { radiusKm, expanded: radiusKm > base, ids };
    }
  }

  return { radiusKm: steps[steps.length - 1], expanded: true, ids: new Set() };
}
