import * as Location from 'expo-location';
import { useEffect, useRef, useState } from 'react';

import { type Activity } from '@/lib/api';
import { type Coords, geocode } from '@/lib/geocode';

/** Umkreis, der als „in deiner Nähe" zählt (Luftlinie in km). */
export const NEARBY_RADIUS_KM = 30;

/** Haversine-Distanz zweier Punkte in Kilometern. */
function distanceKm(a: Coords, b: Coords): number {
  const R = 6371; // Erdradius in km
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type NearbyState = {
  /** IDs der Activities, die im Umkreis liegen. */
  nearbyIds: Set<number>;
  /** true, solange Standort/Geocoding noch laufen. */
  resolving: boolean;
  /** false, wenn die Standort-Berechtigung fehlt (Nähe nicht berechenbar). */
  hasLocation: boolean;
};

/**
 * Bestimmt, welche Activities „in deiner Nähe" liegen: holt den eigenen Standort
 * (expo-location) und wandelt die Orts-Texte der Activities in Koordinaten um
 * (geocode, mit geteiltem Cache). Ergebnisse tröpfeln ein, sobald ein Ort
 * aufgelöst ist – die Nähe-Liste füllt sich also nach und nach.
 */
export function useNearbyActivities(activities: Activity[]): NearbyState {
  const [userCoords, setUserCoords] = useState<Coords | null>(null);
  const [hasLocation, setHasLocation] = useState(true);
  const [nearbyIds, setNearbyIds] = useState<Set<number>>(new Set());
  const [resolving, setResolving] = useState(false);

  // Standort einmalig anfragen.
  useEffect(() => {
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
  }, []);

  // Signatur der Liste (IDs+Orte), damit sich der Geocode-Lauf nur bei echten
  // Änderungen wiederholt – nicht bei jedem neuen Array mit gleichen Daten.
  const signature = activities.map((a) => `${a.id}:${a.location ?? ''}`).join('|');
  const signatureRef = useRef('');

  useEffect(() => {
    if (!userCoords) return;
    signatureRef.current = signature;
    let cancelled = false;
    setResolving(true);

    (async () => {
      const found = new Set<number>();
      for (const activity of activities) {
        if (!activity.location) continue;
        const coords = await geocode(activity.location);
        if (cancelled) return;
        if (coords && distanceKm(userCoords, coords) <= NEARBY_RADIUS_KM) {
          found.add(activity.id);
          // Zwischenstand: Nähe-Liste füllt sich nach und nach.
          setNearbyIds(new Set(found));
        }
      }
      if (!cancelled) {
        setNearbyIds(found);
        setResolving(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // signature deckt Änderungen an der Activity-Liste ab.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userCoords, signature]);

  return { nearbyIds, resolving, hasLocation };
}
