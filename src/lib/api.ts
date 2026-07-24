import { API_URL } from '@/constants/config';

export type AccountType = 'personal' | 'business';

export type Interest = {
  id: number;
  name: string;
};

export type User = {
  id: number;
  name: string;
  username: string | null;
  email: string;
  account_type: AccountType | null;
  avatar: string | null;
  interests?: Interest[];
};

export type AuthResult = {
  user: User;
  token: string;
  profile_complete: boolean;
};

export type RegisterInput = {
  name: string;
  username: string;
  email: string;
  password: string;
  account_type: AccountType;
};

/**
 * Fehler von der API. `errors` enthält bei 422 die Feld-Fehler von Laravel,
 * z. B. { email: ["Diese E-Mail ist bereits registriert."] }.
 */
export class ApiError extends Error {
  status: number;
  errors: Record<string, string[]>;

  constructor(message: string, status: number, errors: Record<string, string[]> = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.errors = errors;
  }

  /** Erste Fehlermeldung – praktisch für eine einfache Anzeige. */
  firstError(): string {
    const first = Object.values(this.errors)[0]?.[0];
    return first ?? this.message;
  }
}

type RequestOptions = {
  method?: 'GET' | 'POST';
  body?: unknown;
  token?: string | null;
};

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, token } = options;

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Keine Verbindung zum Server. Läuft das Backend und stimmt die Adresse?', 0);
  }

  const isJson = response.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await response.json() : null;

  if (!response.ok) {
    throw new ApiError(
      data?.message ?? 'Etwas ist schiefgelaufen.',
      response.status,
      data?.errors ?? {},
    );
  }

  return data as T;
}

export const api = {
  register: (input: RegisterInput) =>
    request<AuthResult>('/register', { method: 'POST', body: { ...input, device_name: 'app' } }),

  login: (email: string, password: string) =>
    request<AuthResult>('/login', { method: 'POST', body: { email, password, device_name: 'app' } }),

  logout: (token: string) => request<{ message: string }>('/logout', { method: 'POST', token }),

  me: (token: string) => request<{ user: User; profile_complete: boolean }>('/user', { token }),
};
