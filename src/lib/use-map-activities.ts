import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { type Activity, api } from '@/lib/api';
import { type Coords, geocode } from '@/lib/geocode';

export type MapActivity = Activity & { coords: Coords };

type State = {
  /** Activities mit gefundenen Koordinaten (für Pins). */
  items: MapActivity[];
  /** Activities, deren Ort nicht gefunden wurde (ohne Pin). */
  unlocated: Activity[];
  loading: boolean;
  error: string | null;
};

const initial: State = { items: [], unlocated: [], loading: true, error: null };

/**
 * Lädt Activities und wandelt ihre Orts-Texte in Koordinaten um.
 * Pins erscheinen nach und nach, sobald ein Ort aufgelöst wurde.
 */
export function useMapActivities(token: string | null): State {
  const [state, setState] = useState<State>(initial);

  const load = useCallback(async () => {
    if (!token) return;
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));

    try {
      const res = await api.activities(token);
      if (cancelled) return;

      const items: MapActivity[] = [];
      const unlocated: Activity[] = [];
      setState({ items: [], unlocated: [], loading: true, error: null });

      for (const activity of res.data) {
        if (!activity.location) {
          unlocated.push(activity);
          continue;
        }
        const coords = await geocode(activity.location);
        if (cancelled) return;
        if (coords) {
          items.push({ ...activity, coords });
        } else {
          unlocated.push(activity);
        }
        // Zwischenstand anzeigen, damit Pins nacheinander auftauchen.
        setState({ items: [...items], unlocated: [...unlocated], loading: true, error: null });
      }

      setState({ items, unlocated, loading: false, error: null });
    } catch {
      if (!cancelled) {
        setState((s) => ({ ...s, loading: false, error: 'Aktivitäten konnten nicht geladen werden.' }));
      }
    }

    return () => {
      cancelled = true;
    };
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      let cleanup: (() => void) | undefined;
      load().then((c) => {
        cleanup = c;
      });
      return () => cleanup?.();
    }, [load]),
  );

  return state;
}
