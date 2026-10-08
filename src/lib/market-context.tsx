import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';

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
  // Abgemeldet braucht niemand Entfernungen – und der Willkommensbildschirm fragt nicht nach dem Standort.
  const { coords } = useLocation({ enabled: token !== null });

  const [offers, setOffers] = useState<Offer[]>([]);
  const [interests, setInterests] = useState<Interest[]>([]);
  const [club, setClub] = useState<ClubState | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Ein anderes Konto (oder abgemeldet): Nichts vom vorigen bleibt stehen. Sonst
  // sähe, wer sich danach auf demselben Gerät anmeldet, dessen Tickets samt
  // Einlöse-Code, Stempelkarte und Gruppen, bis die eigenen Daten da sind.
  const [dataToken, setDataToken] = useState(token);
  if (dataToken !== token) {
    setDataToken(token);
    setOffers([]);
    setInterests([]);
    setClub(null);
    setGroups([]);
    setBookings([]);
    setLoading(true);
    setError(null);
  }

  // Antworten, die beim Wechsel noch für das vorige Konto unterwegs waren, werden
  // verworfen – sonst landeten dessen Tickets oder Credit-Stand beim neuen Konto.
  const liveToken = useRef(token);
  useLayoutEffect(() => {
    liveToken.current = token;
  }, [token]);
  const stillFor = useCallback((sent: string) => liveToken.current === sent, []);

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
      const { data } = await api.club(token);
      if (stillFor(token)) applyClub(data);
    } catch {
      // Bleibt beim alten Stand – die Startseite zeigt dann den letzten bekannten.
    }
  }, [token, applyClub, stillFor]);

  const refreshGroups = useCallback(async () => {
    if (!token) return;
    try {
      const { data } = await api.groups(token);
      if (stillFor(token)) setGroups((prev) => keepIfSame(prev, data));
    } catch {
      // wie oben
    }
  }, [token, stillFor]);

  const refreshBookings = useCallback(async () => {
    if (!token) return;
    try {
      const { data } = await api.bookings(token);
      if (!stillFor(token)) return;
      setBookings((prev) => keepIfSame(prev, data));
      // Offline-Pass: offene Buchungen mit Code fürs Vorzeigen ohne Netz.
      void saveOfflineBookings(data).catch(() => undefined);
    } catch {
      // Kein Netz? Dann wenigstens die zuletzt gespeicherten offenen Buchungen.
      const cached = await loadOfflineBookings();
      if (!stillFor(token)) return;
      if (cached) setBookings((current) => (current.length > 0 ? current : cached.bookings));
    }
  }, [token, stillFor]);

  const refreshOffers = useCallback(async () => {
    if (!token) return;
    try {
      const [offerList, cats] = await Promise.all([api.offers(token), api.interests().catch(() => null)]);
      if (!stillFor(token)) return;
      setError(null);
      setOffers((prev) => keepIfSame(prev, offerList.data));
      if (cats) setInterests((prev) => keepIfSame(prev, cats.data));
    } catch (e) {
      if (stillFor(token)) setError(errorMessage(e, 'Die Angebote konnten nicht geladen werden.'));
    }
  }, [token, stillFor]);

  // Alles nebeneinander und unabhängig: Scheitern die Angebote, kommen Club,
  // Gruppen und Tickets trotzdem (vorher hingen sie am Erfolg der Angebote).
  const refresh = useCallback(async () => {
    if (!token) return;
    await Promise.all([refreshOffers(), refreshClub(), refreshGroups(), refreshBookings()]);
    if (stillFor(token)) setLoading(false);
  }, [token, refreshOffers, refreshClub, refreshGroups, refreshBookings, stillFor]);

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
