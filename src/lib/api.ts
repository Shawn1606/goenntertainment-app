import { API_URL } from '@/constants/config';

export type AccountType = 'personal' | 'business';

export type Interest = {
  id: number;
  name: string;
  slug?: string | null;
  icon?: string | null;
};

export type ActivityHost = {
  id: number;
  name: string;
  username: string | null;
};

export type ActivityParticipant = {
  id: number;
  name: string;
  username: string | null;
};

export type Activity = {
  id: number;
  title: string;
  description: string;
  location: string;
  starts_at: string | null;
  banner_url: string | null;
  /** Maximale Teilnehmerzahl; null = unbegrenzt. */
  max_participants: number | null;
  host: ActivityHost | null;
  interests: Interest[];
  /** Teilnehmer:innen (Namen für die Anzeige im Popup). */
  participants: ActivityParticipant[];
  /** Anzahl der Teilnehmer:innen – praktisch für die Liste. */
  participants_count: number;
  /** true, wenn der:die aktuelle Nutzer:in bereits beigetreten ist. */
  is_joined: boolean;
  /** ISO-Zeitpunkt des Beitritts der:des aktuellen Nutzer:in; null = nicht beigetreten. */
  joined_at: string | null;
};

export type CreateActivityInput = {
  title: string;
  description: string;
  location: string;
  /** ISO-8601 String. */
  starts_at: string;
  /** Maximale Teilnehmerzahl; null/leer = unbegrenzt. */
  max_participants?: number | null;
  interests: number[];
  /** Ausgewähltes Bild (aus Galerie/Kamera); optional. */
  banner?: { uri: string; name: string; type: string } | null;
};

export type User = {
  id: number;
  name: string;
  username: string | null;
  email: string;
  account_type: AccountType | null;
  avatar: string | null;
  /** true = Admin (darf jedes Event löschen, sieht den Admin-Tab). */
  is_admin?: boolean;
  interests?: Interest[];
};

/** Ein Tagespunkt im Admin-Verlaufsgraphen. */
export type AdminStatsPoint = { date: string; count: number };

/** Antwort von GET /api/admin/stats – Kennzahlen + Tages-Verlauf. */
export type AdminStats = {
  totals: { users: number; activities: number; joins: number };
  recent: { days: number; new_users: number; joins: number };
  series: { days: number; signups: AdminStatsPoint[]; joins: AdminStatsPoint[] };
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
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  token?: string | null;
};

export type UpdateProfileInput = {
  name?: string;
  username?: string;
  email?: string;
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

  /** Profil bearbeiten (Name/Benutzername/E-Mail). Nur gesetzte Felder werden geändert. */
  updateProfile: (token: string, input: UpdateProfileInput) =>
    request<{ user: User; profile_complete: boolean }>('/user', {
      method: 'PATCH',
      body: input,
      token,
    }),

  /**
   * Fordert eine „Passwort vergessen"-Mail an. Antwortet immer neutral (die API
   * verrät nicht, ob die Adresse registriert ist) – ein 422 kommt nur bei einer
   * ungültigen E-Mail-Eingabe.
   */
  forgotPassword: (email: string) =>
    request<{ status: string; message: string }>('/forgot-password', {
      method: 'POST',
      body: { email },
    }),

  interests: () => request<{ data: Interest[] }>('/interests'),

  activities: (token: string) => request<{ data: Activity[] }>('/activities', { token }),

  /** Löscht ein beliebiges Event. Nur Admins dürfen das (Backend prüft, sonst 403). */
  deleteActivity: (token: string, id: number) =>
    request<{ message: string }>(`/activities/${id}`, { method: 'DELETE', token }),

  /** Tritt einem Event bei (idempotent). Liefert die aktualisierte Activity. */
  joinActivity: (token: string, id: number) =>
    request<{ data: Activity }>(`/activities/${id}/join`, { method: 'POST', token }),

  /** Verlässt ein Event wieder. Liefert die aktualisierte Activity. */
  leaveActivity: (token: string, id: number) =>
    request<{ data: Activity }>(`/activities/${id}/join`, { method: 'DELETE', token }),

  /** Admin-Kennzahlen + Tages-Verlauf (Anmeldungen/Beitritte) für das Admin-Panel. */
  adminStats: (token: string) => request<AdminStats>('/admin/stats', { token }),

  /**
   * Legt eine Activity an. Wegen des optionalen Banner-Bildes als multipart/form-data
   * (nicht JSON) – Content-Type wird von fetch automatisch mit Boundary gesetzt.
   */
  createActivity: async (token: string, input: CreateActivityInput): Promise<{ data: Activity }> => {
    const form = new FormData();
    form.append('title', input.title);
    form.append('description', input.description);
    form.append('location', input.location);
    form.append('starts_at', input.starts_at);
    if (input.max_participants != null) {
      form.append('max_participants', String(input.max_participants));
    }
    input.interests.forEach((id) => form.append('interests[]', String(id)));
    if (input.banner) {
      form.append('banner', input.banner as unknown as Blob);
    }

    let response: Response;
    try {
      response = await fetch(`${API_URL}/activities`, {
        method: 'POST',
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
        body: form,
      });
    } catch {
      throw new ApiError('Keine Verbindung zum Server. Läuft das Backend und stimmt die Adresse?', 0);
    }

    const isJson = response.headers.get('content-type')?.includes('application/json');
    const data = isJson ? await response.json() : null;

    if (!response.ok) {
      throw new ApiError(data?.message ?? 'Etwas ist schiefgelaufen.', response.status, data?.errors ?? {});
    }

    return data as { data: Activity };
  },
};
