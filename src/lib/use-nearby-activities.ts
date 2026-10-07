import * as Location from 'expo-location';
import { useEffect, useMemo, useRef, useState } from 'react';

import { distanceKm } from '@/domain/distance';
import { RADIUS_STEPS_KM, chooseRadius } from '@/domain/nearby';
import {
  type RunState,
  completeRun,
  initialRunState,
  isResolving,
  startRun,
} from '@/domain/nearby-run';
import { type Activity } from '@/lib/api';
import { type Coords, geocode } from '@/lib/geocode';

/** Grundumkreis, der als „in deiner Nähe" zählt (Luftlinie in km). */
export const NEARBY_RADIUS_KM = RADIUS_STEPS_KM[0];

export type NearbyState = {
  /** IDs der Activities im aktuell gewählten Umkreis. */
  nearbyIds: Set<number>;
  /** Entfernung je Activity-ID in km – auch außerhalb des Umkreises. */
  distanceById: Map<number, number>;
  /** Umkreis, der tatsächlich benutzt wurde (kann automatisch erweitert sein). */
  radiusKm: number;
  /** true, wenn über den Grundumkreis hinaus gesucht werden musste. */
  expanded: boolean;
  /** true, solange Standort/Geocoding noch laufen. */
  resolving: boolean;
  /** false, wenn die Standort-Berechtigung fehlt (Nähe nicht berechenbar). */
  hasLocation: boolean;
};

/**
 * Bestimmt die Entfernung zu jeder Activity: holt den eigenen Standort
 * (expo-location) und wandelt die Orts-Texte in Koordinaten um (geocode, mit
 * geteiltem Cache). Ergebnisse tröpfeln ein, sobald ein Ort aufgelöst ist.
 *
 * Ist im Grundumkreis nichts los, wird der Radius automatisch verdoppelt
 * (Ticket #2) – welche Stufe genommen wird, entscheidet `chooseRadius`.
 */
export function useNearbyActivities(
  activities: Activity[],
  /**
   * false = gar nicht erst nach dem Standort fragen. Kommt aus den
   * Einstellungen: Wer den Schalter ausmacht, soll auch keinen
   * System-Dialog mehr sehen.
   */
  enabled = true,
): NearbyState {
  const [userCoords, setUserCoords] = useState<Coords | null>(null);
  // Starts as `enabled`: switched off from the start means no location.
  const [hasLocation, setHasLocation] = useState(enabled);
  const [distanceById, setDistanceById] = useState<Map<number, number>>(new Map());

  // Abschalten heißt auch: alte Entfernungen verwerfen. Done while rendering,
  // not in the effect (react.dev: "Adjusting some state when a prop changes").
  const [wasEnabled, setWasEnabled] = useState(enabled);
  if (enabled !== wasEnabled) {
    setWasEnabled(enabled);
    if (!enabled) {
      setUserCoords(null);
      setDistanceById(new Map());
      setHasLocation(false);
    }
  }

  // Standort einmalig anfragen.
  useEffect(() => {
    if (!enabled) return;

    let active = true;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (!active) return;
        if (status !== 'granted') {
          setHasLocation(false);
          return;
        }
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (active) {
          setHasLocation(true);
          setUserCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        }
      } catch {
        if (active) setHasLocation(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [enabled]);

  // Signatur der Liste (IDs+Orte), damit sich der Geocode-Lauf nur bei echten
  // Änderungen wiederholt – nicht bei jedem neuen Array mit gleichen Daten.
  const signature = activities.map((a) => `${a.id}:${a.location ?? ''}`).join('|');
  const signatureRef = useRef('');

  /**
   * For which position and list the current geocoding run is, and for which one a run
   * completed. Adjusted while rendering like `wasEnabled` above: a new position or list
   * resets the earlier result before the effect starts the new run, so `resolving` stays
   * true while any run is in flight, also when the list returns to an earlier one.
   */
  const runKey = { coords: userCoords, signature };
  const [run, setRun] = useState<RunState<Coords>>(() => initialRunState(runKey));
  const currentRun = startRun(run, runKey);
  if (currentRun !== run) setRun(currentRun);
  const resolving = isResolving(currentRun, runKey);

  useEffect(() => {
    if (!userCoords) return;
    signatureRef.current = signature;
    let cancelled = false;

    (async () => {
      const found = new Map<number, number>();
      const me = { latitude: userCoords.lat, longitude: userCoords.lng };
      for (const activity of activities) {
        if (!activity.location) continue;
        const coords = await geocode(activity.location);
        if (cancelled) return;
        if (coords) {
          found.set(activity.id, distanceKm(me, { latitude: coords.lat, longitude: coords.lng }));
          // Zwischenstand: die Liste füllt sich nach und nach.
          setDistanceById(new Map(found));
        }
      }
      if (!cancelled) {
        setDistanceById(found);
        setRun((current) => completeRun(current, { coords: userCoords, signature }));
      }
    })();

    return () => {
      cancelled = true;
    };
    // signature deckt Änderungen an der Activity-Liste ab.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userCoords, signature]);

  const choice = useMemo(() => chooseRadius(distanceById), [distanceById]);

  return {
    nearbyIds: choice.ids,
    distanceById,
    radiusKm: choice.radiusKm,
    expanded: choice.expanded,
    resolving,
    hasLocation,
  };
}
