import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { endsSession, signOutLocally } from '@/domain/session';
import {
  api,
  ApiError,
  needsTwoFactor,
  sessionWatch,
  type RegisterInput,
  type TwoFactorChallenge,
  type UpdateProfileInput,
  type User,
} from '@/lib/api';
import { notifyUser } from '@/lib/confirm';
import { migrateSavedLogin } from '@/lib/credential-store';
import { clearOfflineCache } from '@/lib/offline-cache';
import { clearToken, loadToken, saveSessionUserId, saveToken } from '@/lib/token-store';

type AuthContextValue = {
  /** true, solange beim App-Start der gespeicherte Token geprüft wird. */
  isBootstrapping: boolean;
  token: string | null;
  user: User | null;
  /**
   * Anmelden. Ist die Zwei-Faktor-Anmeldung an, kommt statt einer Anmeldung der
   * Beleg für den zweiten Schritt zurück – dann `completeTwoFactor` mit dem Code.
   * `null` heißt: angemeldet.
   */
  login: (email: string, password: string) => Promise<TwoFactorChallenge | null>;
  /** Zweiter Schritt der Anmeldung: Code (oder Wiederherstellungscode) eingeben. */
  completeTwoFactor: (challenge: string, code: string) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  updateProfile: (input: UpdateProfileInput) => Promise<void>;
  /** Übernimmt einen Nutzer, den ein anderer Aufruf schon zurückgegeben hat. */
  applyUser: (user: User) => void;
  /**
   * Einzelne Felder sofort ändern – vor allem der Credit-Stand nach Kauf,
   * Buchung oder Stempel. Die Kopfzeile zählt dann mit, ohne `/user` neu zu laden.
   */
  patchUser: (patch: Partial<User>) => void;
  /** Die eigenen Daten neu vom Server holen. Scheitert still. */
  refreshUser: () => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Beim Start: gespeicherten Token laden und gegen /api/user prüfen. Wirft nie:
 * Ein Speicherfehler (Android-Schlüsselbund zurückgesetzt, im Browser gesperrter
 * Speicher) zählt als „kein Token“ – sonst bliebe die App für immer auf dem
 * Startbild stehen.
 */
async function restoreSession(): Promise<{ token: string | null; user: User | null }> {
  try {
    // First of all: an earlier version may have stored the password on this device; it goes
    // now, even if the sign-in screen is never shown (src/lib/credential-store.ts).
    await migrateSavedLogin();
    const stored = await loadToken();
    if (!stored) return { token: null, user: null };
    try {
      const { user: me } = await api.me(stored);
      // Kept beside the token, also for a session from before this version (F-44).
      await saveSessionUserId(me.id);
      return { token: stored, user: me };
    } catch (error) {
      // Token ungültig (401) oder Konto gesperrt (403) → verwerfen. Bei
      // reinem Netzfehler behalten, damit man offline nicht abgemeldet wird.
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        await clearToken();
        // The session ended while the app was closed (the account deleted, the token
        // revoked): its offline copy goes too (F-44).
        await clearOfflineCache().catch(() => undefined);
        return { token: null, user: null };
      }
      return { token: stored, user: null };
    }
  } catch {
    return { token: null, user: null };
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);

  /**
   * The token of the current session, for the 401 listener below (it must not re-subscribe on
   * every sign-in). Updated in an effect, never during render (React Compiler rules); logout and
   * endLocalSession clear it first, so their own requests cannot report the session as ended.
   */
  const tokenRef = useRef<string | null>(null);
  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  /**
   * The one way this device signs out (F-20): deliberate logout and a 401 during a session both
   * end here, so whatever else must leave the device at sign-out is added in this one place.
   * `notify` marks the 401 case and tells the person why. The order and the handling of a
   * storage error are in signOutLocally (src/domain/session.ts): memory first, then storage; a
   * storage error rejects only a deliberate logout. The offline copy of the bookings and the pass
   * (src/lib/offline-cache.ts) goes too (F-44), on every path - logout, the 401, and the logout
   * after deleting the account - and never fails it.
   */
  const endLocalSession = useCallback((notify: boolean) => {
    return signOutLocally(
      {
        forget: () => {
          tokenRef.current = null;
          setToken(null);
          setUser(null);
        },
        clearStorage: clearToken,
        clearDeviceData: () => clearOfflineCache(),
        notice: () =>
          notifyUser(
            'Abgemeldet',
            'Deine Anmeldung ist abgelaufen oder wurde auf einem anderen Gerät beendet. Bitte melde dich neu an.',
          ),
      },
      notify,
    );
  }, []);

  // A 401 to a request with the current token: the server no longer accepts this session.
  // Nothing to report if the notice fails: the session is already gone on this device.
  useEffect(
    () =>
      sessionWatch.subscribe((rejected) => {
        if (endsSession(401, rejected, tokenRef.current)) void endLocalSession(true).catch(() => {});
      }),
    [endLocalSession],
  );

  // Beim Start: gespeicherten Token laden und gegen /api/user prüfen (restoreSession).
  useEffect(() => {
    let active = true;
    void restoreSession().then((restored) => {
      if (!active) return;
      if (restored.token) setToken(restored.token);
      if (restored.user) setUser(restored.user);
      setIsBootstrapping(false);
    });
    return () => {
      active = false;
    };
  }, []);

  async function applyAuth(result: { token: string; user: User }) {
    await saveToken(result.token);
    await saveSessionUserId(result.user.id);
    setToken(result.token);
    setUser(result.user);
  }

  const value = useMemo<AuthContextValue>(
    () => ({
      isBootstrapping,
      token,
      user,
      login: async (email, password) => {
        const result = await api.login(email, password);
        if (needsTwoFactor(result)) return result.two_factor;
        await applyAuth(result);
        return null;
      },
      completeTwoFactor: async (challenge, code) => {
        const result = await api.loginTwoFactor(challenge, code);
        await applyAuth(result);
      },
      register: async (input) => {
        const result = await api.register(input);
        await applyAuth(result);
      },
      updateProfile: async (input) => {
        if (!token) throw new Error('Nicht angemeldet.');
        const { user: updated } = await api.updateProfile(token, input);
        setUser(updated);
      },
      applyUser: (updated) => setUser(updated),
      // Nur ein neues Objekt, wenn sich wirklich etwas ändert: Fast alles hängt an
      // `user`, und jede Club-Antwort ruft das hier – meist mit denselben Werten.
      patchUser: (patch) =>
        setUser((prev) => {
          if (!prev) return prev;
          const changed = (Object.keys(patch) as (keyof User)[]).some((key) => !Object.is(prev[key], patch[key]));
          return changed ? { ...prev, ...patch } : prev;
        }),
      refreshUser: async () => {
        if (!token) return;
        try {
          const { user: me } = await api.me(token);
          setUser(me);
        } catch {
          // Kein Netz oder Server weg: Der bekannte Stand bleibt stehen. A rejected token (401)
          // has already ended the session through sessionWatch (endLocalSession).
        }
      },
      logout: async () => {
        // Clear the ref first: the server's answer to this logout must not count as a 401
        // during the session (after an account deletion the token is already gone).
        tokenRef.current = null;
        if (token) {
          try {
            await api.logout(token);
          } catch {
            // egal – lokal trotzdem abmelden
          }
        }
        await endLocalSession(false);
      },
    }),
    [isBootstrapping, token, user, endLocalSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth muss innerhalb von <AuthProvider> benutzt werden.');
  }
  return ctx;
}
