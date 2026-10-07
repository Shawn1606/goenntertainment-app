import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import {
  api,
  ApiError,
  needsTwoFactor,
  type RegisterInput,
  type TwoFactorChallenge,
  type UpdateProfileInput,
  type User,
} from '@/lib/api';
import { clearOfflineCache } from '@/lib/offline-cache';
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);

  // Beim Start: gespeicherten Token laden und gegen /api/user prüfen.
  useEffect(() => {
    let active = true;

    (async () => {
      const stored = await loadToken();
      if (stored) {
        try {
          const { user: me } = await api.me(stored);
          if (active) {
            setToken(stored);
            setUser(me);
          }
        } catch (error) {
          // Token ungültig (401) oder Konto gesperrt (403) → verwerfen. Bei
          // reinem Netzfehler behalten, damit man offline nicht abgemeldet wird.
          if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
            await clearToken();
          } else if (active) {
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
        await applyAuth(await api.loginTwoFactor(challenge, code));
      },
      register: async (input) => {
        await applyAuth(await api.register(input));
      },
      updateProfile: async (input) => {
        if (!token) throw new Error('Nicht angemeldet.');
        const { user: updated } = await api.updateProfile(token, input);
        setUser(updated);
      },
      applyUser: (updated) => setUser(updated),
      patchUser: (patch) => setUser((prev) => (prev ? { ...prev, ...patch } : prev)),
      refreshUser: async () => {
        if (!token) return;
        try {
          const { user: me } = await api.me(token);
          setUser(me);
        } catch {
          // Kein Netz oder Server weg: Der bekannte Stand bleibt stehen.
        }
      },
      logout: async () => {
        if (token) {
          try {
            await api.logout(token);
          } catch {
            // egal – lokal trotzdem abmelden
          }
        }
        await clearToken();
        await clearOfflineCache().catch(() => undefined);
        setToken(null);
        setUser(null);
      },
    }),
    [isBootstrapping, token, user],
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

/** Das angemeldete Konto samt Token – für Screens hinter dem Login-Wächter. */
export function useSession(): { token: string; user: User } | null {
  const { token, user } = useAuth();
  return token && user ? { token, user } : null;
}
