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
import { clearSearchHistory } from '@/lib/search-history-store';
import { clearToken, loadToken, saveToken } from '@/lib/token-store';

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
  /**
   * Übernimmt einen Nutzer, den ein anderer Aufruf schon zurückgegeben hat.
   *
   * Für Endpunkte, die das Konto ändern, ohne `updateProfile` zu sein – etwa
   * Profilbild und Banner (siehe `api.setProfileImage`). Ohne das zeigten
   * Kopfzeile und Konto-Blatt weiter das alte Bild. Bewusst kein zweiter
   * Netzaufruf wie bei `refreshUser`: Die Antwort IST schon der neue Stand.
   */
  applyUser: (user: User) => void;
  /**
   * Die eigenen Daten neu vom Server holen.
   *
   * Nötig, weil sich das Konto auch OHNE Zutun der Person ändern kann: Ein Admin
   * bestätigt eine Anfrage auf Creator (siehe admin-requests.tsx), und die App
   * wüsste bis zum nächsten Anmelden nichts davon – Events erstellen wäre
   * freigeschaltet, der Knopf dafür aber weiter versteckt. Scheitert still: Ein
   * fehlgeschlagener Abgleich darf den Bildschirm nicht mit einem Fehler
   * überziehen, der mit dem zu tun hat, was man dort gerade macht.
   */
  refreshUser: () => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

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

  /** The signed-in account's id, for the search history a sign-out removes (F-44). */
  const userIdRef = useRef<number | null>(null);
  useEffect(() => {
    userIdRef.current = user?.id ?? null;
  }, [user]);

  /**
   * The one way this device signs out (F-20): deliberate logout and a 401 during a session both
   * end here, so whatever else must leave the device at sign-out is added in this one place.
   * `notify` marks the 401 case and tells the person why. The order and the handling of a
   * storage error are in signOutLocally (src/domain/session.ts): memory first, then storage; a
   * storage error rejects only a deliberate logout. The search history goes too (F-44), on every
   * path - logout, the 401, and the logout after deleting the account - and never fails it.
   */
  const endLocalSession = useCallback((notify: boolean) => {
    // Taken before forget() ends the session: whose search history to remove.
    const signedOutId = userIdRef.current;
    return signOutLocally(
      {
        forget: () => {
          tokenRef.current = null;
          setToken(null);
          setUser(null);
        },
        clearStorage: clearToken,
        clearHistory: () => clearSearchHistory(signedOutId),
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

  // Beim Start: gespeicherten Token laden und gegen /api/user prüfen.
  useEffect(() => {
    let active = true;

    (async () => {
      // First of all: an earlier version may have stored the password on this device; it goes
      // now, even if the sign-in screen is never shown (src/lib/credential-store.ts).
      await migrateSavedLogin();

      const stored = await loadToken();
      if (stored) {
        try {
          const { user: me } = await api.me(stored);
          if (active) {
            setToken(stored);
            setUser(me);
          }
        } catch (error) {
          // Token ungültig (401) → verwerfen. Bei reinem Netzfehler behalten.
          if (error instanceof ApiError && error.status === 401) {
            await clearToken();
            // The session ended while the app was closed: whose it was is unknown here, so
            // only the histories a listable storage (web) still holds can go (F-44).
            await clearSearchHistory(null);
          } else if (active && stored) {
            setToken(stored);
          }
        }
      }
      if (active) setIsBootstrapping(false);
    })();

    return () => {
      active = false;
    };
  }, []);

  async function applyAuth(result: { token: string; user: User }) {
    await saveToken(result.token);
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
