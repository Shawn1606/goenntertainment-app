import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { distanceKm } from '@/domain/distance';
import { keepIfSame } from '@/domain/same-data';
import {
  api,
  errorMessage,
  type Booking,
  type ClubState,
  type Group,
  type Interest,
  type Offer,
} from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { loadOfflineBookings, saveOfflineBookings } from '@/lib/offline-cache';
import { useLocation, type Coords } from '@/lib/use-location';

/**
 * Die Daten, die alle drei Tabs brauchen – einmal geladen, überall dieselben.
 *
 * Startseite, Gruppen-Finder und Karte zeigen dieselben Angebote in drei
 * Anordnungen. Jeder Tab für sich würde sie dreimal laden und nach einer
 * Buchung drei verschiedene Stände zeigen. Hier liegt ein Stand, und wer etwas
 * ändert (buchen, Credits kaufen, stempeln), frischt ihn an einer Stelle auf.
 */
type MarketValue = {
  offers: Offer[];
  interests: Interest[];
  club: ClubState | null;
  groups: Group[];
  bookings: Booking[];
  coords: Coords | null;
  /** Entfernung je Angebots-ID in km (über den Standort des Partners). */
  distanceById: Map<number, number>;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  refreshClub: () => Promise<void>;
  refreshGroups: () => Promise<void>;
  refreshBookings: () => Promise<void>;
  /** Neuer Club-Stand aus einer Antwort übernehmen (Abo, Kauf) – ohne Netzaufruf. */
  applyClub: (club: ClubState) => void;
  /** Credit-Stand setzen (nach Kauf/Buchung) – hält Kopfzeile und Club gleich. */
  setCredits: (credits: number) => void;
};

const MarketContext = createContext<MarketValue | null>(null);

export function MarketProvider({ children }: { children: ReactNode }) {
  const { token, patchUser } = useAuth();
  const { coords } = useLocation();

  const [offers, setOffers] = useState<Offer[]>([]);
  const [interests, setInterests] = useState<Interest[]>([]);
  const [club, setClub] = useState<ClubState | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Neue Antworten mit denselben Daten behalten das alte Objekt (`keepIfSame`):
  // Sonst zeichnete jedes Aktualisieren alle Tab-Seiten neu, auch ohne Änderung.
  const applyClub = useCallback(
    (next: ClubState) => {
      setClub((prev) => keepIfSame(prev, next));
      patchUser({
        credits_balance: next.credits,
        club_plan: next.plan,
        club_since: next.since,
        club_renews_at: next.renews_at,
        club_cancel_at_period_end: next.cancel_at_period_end,
      });
    },
    [patchUser],
  );

  const setCredits = useCallback(
    (credits: number) => {
      setClub((prev) => (prev ? { ...prev, credits } : prev));
      patchUser({ credits_balance: credits });
    },
    [patchUser],
  );

  const refreshClub = useCallback(async () => {
    if (!token) return;
    try {
      applyClub((await api.club(token)).data);
    } catch {
      // Bleibt beim alten Stand – die Startseite zeigt dann den letzten bekannten.
    }
  }, [token, applyClub]);

  const refreshGroups = useCallback(async () => {
    if (!token) return;
    try {
      const { data } = await api.groups(token);
      setGroups((prev) => keepIfSame(prev, data));
    } catch {
      // wie oben
    }
  }, [token]);

  const refreshBookings = useCallback(async () => {
    if (!token) return;
    try {
      const { data } = await api.bookings(token);
      setBookings((prev) => keepIfSame(prev, data));
      // Offline-Pass: offene Buchungen mit Code fürs Vorzeigen ohne Netz.
      void saveOfflineBookings(data).catch(() => undefined);
    } catch {
      // Kein Netz? Dann wenigstens die zuletzt gespeicherten offenen Buchungen.
      const cached = await loadOfflineBookings();
      if (cached) setBookings((current) => (current.length > 0 ? current : cached.bookings));
    }
  }, [token]);

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const [offerList, cats] = await Promise.all([api.offers(token), api.interests().catch(() => null)]);
      setError(null);
      setOffers((prev) => keepIfSame(prev, offerList.data));
      if (cats) setInterests((prev) => keepIfSame(prev, cats.data));
      await Promise.all([refreshClub(), refreshGroups(), refreshBookings()]);
    } catch (e) {
      setError(errorMessage(e, 'Die Angebote konnten nicht geladen werden.'));
    }
    setLoading(false);
  }, [token, refreshClub, refreshGroups, refreshBookings]);

  // Laden, sobald jemand angemeldet ist. Gesetzt wird erst nach der Antwort
  // des Servers – der Compiler sieht das durch das `await` hindurch nicht.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (token) void refresh();
  }, [token, refresh]);

  const distanceById = useMemo(() => {
    const map = new Map<number, number>();
    if (!coords) return map;
    for (const offer of offers) {
      const p = offer.partner;
      if (p?.lat != null && p?.lng != null) {
        map.set(offer.id, distanceKm({ latitude: coords.lat, longitude: coords.lng }, { latitude: p.lat, longitude: p.lng }));
      }
    }
    return map;
  }, [coords, offers]);

  const value = useMemo<MarketValue>(
    () => ({
      offers,
      interests,
      club,
      groups,
      bookings,
      coords,
      distanceById,
      loading,
      error,
      refresh,
      refreshClub,
      refreshGroups,
      refreshBookings,
      applyClub,
      setCredits,
    }),
    [offers, interests, club, groups, bookings, coords, distanceById, loading, error, refresh, refreshClub, refreshGroups, refreshBookings, applyClub, setCredits],
  );

  return <MarketContext.Provider value={value}>{children}</MarketContext.Provider>;
}

export function useMarket(): MarketValue {
  const ctx = useContext(MarketContext);
  if (!ctx) throw new Error('useMarket muss innerhalb von <MarketProvider> benutzt werden.');
  return ctx;
}
