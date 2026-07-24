import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { api, ApiError, type RegisterInput, type User } from '@/lib/api';
import { clearToken, loadToken, saveToken } from '@/lib/token-store';

type AuthContextValue = {
  /** true, solange beim App-Start der gespeicherte Token geprüft wird. */
  isBootstrapping: boolean;
  token: string | null;
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
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
          // Token ungültig (401) → verwerfen. Bei reinem Netzfehler behalten.
          if (error instanceof ApiError && error.status === 401) {
            await clearToken();
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
        await applyAuth(result);
      },
      register: async (input) => {
        const result = await api.register(input);
        await applyAuth(result);
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
