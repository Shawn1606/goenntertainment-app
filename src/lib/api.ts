import { Platform } from 'react-native';

import { API_URL } from '@/constants/config';
import type { ClubPlan, GroupTier, PlanKey } from '@/domain/club';
import type { AdminFeatureState, BingoState, FeatureKey, FeatureState, PreviewMode } from '@/domain/features';
import type { NewChallengeInput, TestphaseState } from '@/domain/testphase';
import { createSessionWatch } from '@/domain/session';

/**
 * Die Schnittstelle zum Laravel-Backend (api/). Typen hier, Regeln in
 * src/domain, Bildschirme in src/app.
 *
 * Zeiten der neuen Endpunkte kommen als ISO 8601 MIT Zone (App\Support\Format),
 * Beträge in Cent, Credits als ganze Zahl.
 */

export type { PlanKey };

/* ================================================================ Konto */

export type Interest = {
  id: number;
  name: string;
  slug?: string | null;
  icon?: string | null;
};

export type TwoFactorMethod = 'email' | 'totp';

export type User = {
  id: number;
  name: string;
  username: string | null;
  email: string;
  avatar: string | null;
  is_admin?: boolean;
  interests?: Interest[];
  two_factor_method?: TwoFactorMethod | null;
  /** Club-Stufe und Credit-Stand – für die Kopfzeile auf jedem Tab. */
  club_plan: PlanKey;
  credits_balance: number;
  club_since: string | null;
  club_renews_at: string | null;
  club_cancel_at_period_end: boolean;
  /** Monats- oder Jahresabo. */
  club_interval?: ClubInterval;
  /** Darf im Partner-Modus Kunden-Pässe scannen. */
  is_partner_staff: boolean;
};

export type TwoFactorChallenge = {
  challenge: string;
  method: TwoFactorMethod;
  destination: string | null;
  expires_in: number;
};

export type AuthResult = { user: User; token: string; profile_complete: boolean };

export type LoginResult = AuthResult | { two_factor: TwoFactorChallenge };

export function needsTwoFactor(result: LoginResult): result is { two_factor: TwoFactorChallenge } {
  return 'two_factor' in result && !!result.two_factor;
}

/**
 * Bestätigung zum Abschalten der 2FA / neuen Codes: Passwort UND aktueller Code (F-19). Eines
 * allein reicht nicht mehr – sonst genügte ein gemailter Code oder das Passwort allein.
 */
export type SecondFactorProof = { password: string; code: string };

export type RegisterInput = {
  name: string;
  username: string;
  email: string;
  password: string;
  interests?: number[];
  /**
   * Stand der Nutzungsbedingungen, dem zugestimmt wurde (src/domain/legal.ts). Required (F-14):
   * the server refuses a sign-up without the current version.
   */
  terms_version: string;
  /** The minimum age the person confirmed (`MIN_AGE`); required, see `registrationConsent()`. */
  confirmed_min_age: number;
};

/**
 * Edit the profile. The e-mail address is not part of it: it changes only with the password (and
 * the code with two-factor sign-in) through `api.changeEmail`.
 */
export type UpdateProfileInput = {
  name?: string;
  username?: string;
  /** Vollständige neue Interessen-Liste (IDs); ersetzt die bisherigen. */
  interests?: number[];
};

export type BanInfo = {
  reason: string | null;
  permanent: boolean;
  banned_until: string | null;
};

/* ========================================================== Marktplatz */

export type OfferKind = 'activity' | 'perk';

/** Angaben zur Barrierefreiheit eines Partners: true/false, null = unbekannt. */
export type PartnerAccess = {
  wheelchair_accessible?: boolean | null;
  kid_friendly?: boolean | null;
  /** z. B. „Di–Do vormittags" */
  quiet_times?: string | null;
};

export type OfferPartner = PartnerAccess & {
  id: number;
  slug: string;
  name: string;
  logo_url: string | null;
  cover_url: string | null;
  address: string | null;
  city: string | null;
  lat: number | null;
  lng: number | null;
  interest_id: number | null;
};

export type Offer = {
  id: number;
  partner_id: number;
  kind: OfferKind;
  title: string;
  subtitle: string | null;
  description: string | null;
  interest_id: number | null;
  image_url: string | null;
  price_cents: number | null;
  price_credits: number | null;
  /** Der Deckel, der wirklich gilt – damit rechnet die Vorschau. */
  max_discount_percent: number;
  min_people: number;
  max_people: number | null;
  min_age: number | null;
  max_age: number | null;
  duration_minutes: number | null;
  indoor: boolean | null;
  valid_days: number;
  is_featured: boolean;
  /** Testphase: Plätze pro Tag (null = unbegrenzt), davon für Platinum reserviert. */
  daily_capacity?: number | null;
  platinum_reserved?: number;
  partner: OfferPartner | null;
};

/** Freie Plätze an einem Tag (nur bei Angeboten mit Tageskontingent). */
export type Availability = {
  capacity: number | null;
  booked: number;
  reserved: number;
  available: number | null;
  available_for_you: number | null;
};

export type Partner = PartnerAccess & {
  id: number;
  slug: string;
  name: string;
  tagline: string | null;
  description: string | null;
  interest_id: number | null;
  address: string | null;
  city: string | null;
  lat: number | null;
  lng: number | null;
  logo_url: string | null;
  cover_url: string | null;
  phone: string | null;
  website: string | null;
  instagram: string | null;
  opening_hours: string | null;
  is_featured: boolean;
  offers?: Offer[];
};

export type PayMethod = 'money' | 'credits';

/** Verbindlicher Preis vom Server (POST /offers/{id}/quote). */
export type Quote = {
  pay_method: PayMethod;
  people: number;
  plan: PlanKey;
  club_percent: number;
  group_percent: number;
  discount_percent: number;
  capped: boolean;
  unit_price_cents?: number;
  subtotal_cents?: number;
  discount_cents?: number;
  total_cents?: number;
  unit_credits?: number;
  subtotal_credits?: number;
  total_credits?: number;
  balance?: number;
};

export type BookingStatus = 'confirmed' | 'redeemed' | 'cancelled' | 'expired';

export type Booking = {
  id: number;
  /** Zum Vorzeigen, z. B. „ABCD-EFGH". `null`, wenn jemand anderes in der Gruppe gebucht hat. */
  code: string | null;
  status: BookingStatus;
  offer_id: number | null;
  offer_title: string;
  partner_id: number | null;
  partner_name: string;
  image_url: string | null;
  partner: {
    id: number;
    name: string;
    logo_url: string | null;
    address: string | null;
    city: string | null;
    lat: number | null;
    lng: number | null;
    phone: string | null;
  } | null;
  group: { id: number; name: string } | null;
  people: number;
  plan_key: PlanKey;
  pay_method: PayMethod;
  unit_price_cents: number | null;
  unit_credits: number | null;
  discount_percent: number;
  subtotal_cents: number;
  discount_cents: number;
  total_cents: number;
  subtotal_credits: number;
  total_credits: number;
  preferred_date: string | null;
  valid_until: string;
  redeemed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  /** Kalender-Export: Pfad unter der API mit Signatur (öffnet der Kalender selbst). */
  calendar_path?: string;
  /** Testphase: Rückmeldung an den Partner schon abgegeben? */
  feedback_given?: boolean;
  /** Nur in der Gruppenansicht: wer gebucht hat. */
  booked_by?: string | null;
  /** Nur im Partner-Modus. */
  customer?: { first_name: string };
};

export type StampEntry = {
  id: number;
  day: string | null;
  created_at: string | null;
  partner: { id: number; name: string; logo_url: string | null } | null;
};

export type StampCard = {
  total: number;
  filled: number;
  fields: number;
  completed_cards: number;
  remaining: number;
  /** Was die LAUFENDE Karte bringt, wenn sie voll ist – je Club-Stufe, golden ×1,5. */
  reward_credits: number;
  /** Ist die laufende Karte eine goldene (jede `golden_every`-te)? */
  golden?: boolean;
  golden_every?: number;
  /** Karten nach der laufenden bis zur nächsten goldenen (0 = die laufende ist golden). */
  cards_until_golden?: number;
  /** Die Stempel der laufenden Karte, ältester zuerst. */
  stamps: StampEntry[];
};

export type CreditPack = { credits: number; bonus: number; price_cents: number };

export type PaymentsMode = 'test' | 'off';

export type ClubInterval = 'month' | 'year';

export type ClubState = {
  plan: PlanKey;
  plan_name: string;
  since: string | null;
  renews_at: string | null;
  cancel_at_period_end: boolean;
  interval?: ClubInterval;
  credits: number;
  /** Der Posten, der als Nächstes verfällt – oder null, wenn nichts verfällt. */
  next_expiry: CreditLot | null;
  /** Wie lange neue Gutschriften in der aktuellen Stufe gelten, z. B. „18 Monate". */
  credit_validity_label?: string;
  /** Erstkauf-Bonus in Prozent, solange das Konto noch nie ein Paket gekauft hat (sonst 0). */
  first_purchase_bonus_percent?: number;
  stamps: StampCard;
  plans: ClubPlan[];
  group_discount: GroupTier[];
  packs: CreditPack[];
  payments_mode: PaymentsMode;
};

export type CreditTransactionKind =
  | 'purchase'
  | 'voucher'
  | 'stamp_reward'
  | 'monthly'
  | 'booking'
  | 'refund'
  | 'admin'
  | 'expired'
  /** Testphase: Challenge, Bingo-Reihe oder Serien-Bonus abgeholt. */
  | 'challenge'
  /** Testphase: Credits für eine Rückmeldung an den Partner. */
  | 'feedback'
  /** Testphase: Anteil an einer Gruppenbuchung gezahlt bzw. bekommen. */
  | 'share';

export type CreditTransaction = {
  id: number;
  amount: number;
  balance_after: number;
  kind: CreditTransactionKind;
  description: string;
  created_at: string | null;
  /** Nur bei Gutschriften: bis wann sie gilt. */
  expires_at?: string | null;
};

/** Ein Credit-Posten: Was von einer Gutschrift übrig ist und wann es verfällt. */
export type CreditLot = {
  /** Davon noch übrig. */
  credits: number;
  /** Ursprünglich gutgeschrieben. */
  amount?: number;
  /** Woher die Gutschrift kam (Kauf, Monats-Credits, Stempelkarte …). */
  kind?: CreditTransactionKind | null;
  expires_at: string | null;
  created_at: string | null;
};

export type WalletState = {
  balance: number;
  /** Was noch gilt, der früheste Verfall zuerst. */
  lots: CreditLot[];
  /** Wie lange neue Gutschriften in der aktuellen Stufe gelten, z. B. „18 Monate". */
  validity_label: string;
  /** Erstkauf-Bonus in Prozent, solange das Konto noch nie ein Paket gekauft hat (sonst 0). */
  first_purchase_bonus_percent: number;
  transactions: CreditTransaction[];
  packs: CreditPack[];
  payments_mode: PaymentsMode;
};

export type CheckinMethod = 'nfc' | 'qr';

export type CheckinResult = {
  partner: { id: number; name: string };
  stamped: boolean;
  /** Testphase (nur Admins): erster Besuch bei diesem Partner = doppelter Stempel. */
  bonus_stamp?: boolean;
  reward_credits: number;
  stamps: StampCard;
  /** Fehlt im Partner-Modus (der Partner sieht fremde Stände nicht). */
  credits?: number;
  open_bookings: Booking[];
  /** Nur im Partner-Modus. */
  customer?: { first_name: string };
};

export type PassToken = {
  token: string;
  expires_at: string;
  /** Länger gültiger Pass – nur zeigen, wenn gerade kein Netz da ist. */
  offline_token?: string;
  offline_expires_at?: string;
};

/** Ein Abzeichen mit Datum (GET /badges). */
export type Badge = {
  key: string;
  title: string;
  description: string;
  icon: string;
  earned: boolean;
  earned_at: string | null;
  progress: { current: number; target: number } | null;
};

/* ======================================================= Gruppen & Chat */

export type GroupMember = {
  id: number;
  name: string;
  username: string | null;
  avatar: string | null;
  is_owner: boolean;
};

export type Group = {
  id: number;
  name: string;
  description: string | null;
  created_at: string | null;
  is_owner: boolean;
  /** Zum Teilen: „ABCD-2345". */
  invite_code: string;
  members: GroupMember[];
  members_count: number;
  unread: number;
  /** Nur in der Einzelansicht. */
  bookings?: Booking[];
};

export type GroupPreview = {
  id: number | null;
  name: string;
  description: string | null;
  members_count: number;
  owner_name: string | null;
  is_member: boolean;
};

export type ChatShare = {
  offer_id: number | null;
  title: string;
  partner_name: string | null;
  image_url: string | null;
  price_cents: number | null;
  price_credits: number | null;
};

export type ChatMessage = {
  id: number;
  body: string;
  created_at: string | null;
  is_mine: boolean;
  user: { id: number; name: string | null; username: string | null; avatar: string | null };
  shared: ChatShare | null;
};

export type ChatRoom = { group_id: number; title: string; can_moderate: boolean };

export type BlockedPerson = { id: number; name: string; username: string | null; avatar: string | null };

export type ReportTarget = 'message' | 'user' | 'group' | 'partner' | 'offer';

/* ================================================================ Admin */

export type AdminStatsPoint = { date: string; count: number };

export type AdminStats = {
  totals: {
    users: number;
    partners: number;
    offers: number;
    bookings: number;
    open_bookings: number;
    revenue_cents: number;
    credits_outstanding: number;
    members_gold: number;
    members_platinum: number;
    checkins_week: number;
    open_reports: number;
  };
  series: { days: number; signups: AdminStatsPoint[]; bookings: AdminStatsPoint[]; checkins: AdminStatsPoint[] };
};

export type AdminUser = {
  id: number;
  name: string;
  username: string | null;
  email: string;
  is_admin: boolean;
  avatar: string | null;
  created_at: string | null;
  club_plan: PlanKey;
  credits_balance: number;
  groups_count: number;
  bookings_count: number;
  /** Alle Stempel des Kontos (auch die schon eingelösten Karten). */
  stamps_total: number;
  banned: boolean;
  banned_permanent: boolean;
  banned_until: string | null;
  ban_reason: string | null;
};

/** Ein Konto im Admin-Bereich – mit Stempelkarte und letzten Credit-Bewegungen. */
export type AdminUserDetail = AdminUser & {
  /** Das eigene Konto: Sperren und Löschen gibt es dann nicht. */
  is_self: boolean;
  stamps: StampCard;
  transactions: CreditTransaction[];
};

export type AdminEvidence = {
  id: number;
  action: 'ban' | 'timeout';
  reason: string;
  banned_until: string | null;
  image_url: string | null;
  created_at: string | null;
  user: { id: number; name: string; username: string | null };
  admin_name: string | null;
  source: 'admin' | 'ai';
};

export type AdminReport = {
  id: number;
  target_type: string;
  target_id: number;
  /** Was gemeldet wurde, in einem Satz – `null`, wenn es inzwischen weg ist. */
  target: string | null;
  reason: string;
  note: string | null;
  status: 'open' | 'reviewed' | 'dismissed';
  reporter_name: string | null;
  handled_by_name: string | null;
  handled_at: string | null;
  created_at: string | null;
};

export type AdminPartner = Omit<Partner, 'offers'> & {
  is_active: boolean;
  max_discount_percent: number | null;
  offers_count: number;
  staff_count: number;
  /** Gehört auf den NFC-Aufkleber und als QR-Code daneben. */
  checkin_token: string;
  checkin_url: string;
  staff?: { id: number; name: string; email: string; role: string }[];
};

export type PartnerInput = Partial<{
  name: string;
  slug: string | null;
  tagline: string | null;
  description: string | null;
  interest_id: number | null;
  address: string | null;
  city: string | null;
  lat: number | null;
  lng: number | null;
  phone: string | null;
  website: string | null;
  instagram: string | null;
  opening_hours: string | null;
  max_discount_percent: number | null;
  is_active: boolean;
  is_featured: boolean;
  wheelchair_accessible: boolean | null;
  kid_friendly: boolean | null;
  quiet_times: string | null;
}>;

export type AdminOffer = Offer & {
  is_active: boolean;
  sort: number;
  own_max_discount_percent: number | null;
  bookings_count: number;
};

export type OfferInput = Partial<{
  partner_id: number;
  kind: OfferKind;
  title: string;
  subtitle: string | null;
  description: string | null;
  interest_id: number | null;
  price_cents: number | null;
  price_credits: number | null;
  max_discount_percent: number | null;
  min_people: number;
  max_people: number | null;
  min_age: number | null;
  max_age: number | null;
  duration_minutes: number | null;
  indoor: boolean | null;
  valid_days: number;
  is_active: boolean;
  is_featured: boolean;
  sort: number;
  daily_capacity: number | null;
  platinum_reserved: number;
}>;

export type VoucherBatch = {
  id: number;
  label: string;
  retailer: string | null;
  credits: number;
  quantity: number;
  created_count: number;
  redeemed_count: number;
  expires_at: string | null;
  created_at: string | null;
};

export type AdminBooking = Booking & { user: { id: number; name: string; email: string } | null };

/** Ein Bild aus expo-image-picker für multipart-Anfragen. */
export type ImageUpload = { uri: string; name: string; type: string };

/* ============================================================== Technik */

export class ApiError extends Error {
  status: number;
  errors: Record<string, string[]>;
  body: { ban?: BanInfo; [key: string]: unknown } | null;

  constructor(message: string, status: number, errors: Record<string, string[]> = {}, body: Record<string, unknown> | null = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.errors = errors;
    this.body = body;
  }

  /** Erste Fehlermeldung – praktisch für eine einfache Anzeige. */
  firstError(): string {
    return Object.values(this.errors)[0]?.[0] ?? this.message;
  }

  /** Die Meldung zu einem Feld (Validierung), sonst `null` – für Fehler direkt am Eingabefeld. */
  fieldError(field: string): string | null {
    return this.errors[field]?.[0] ?? null;
  }
}

/** Die Meldung, die man zeigen kann – egal, was geworfen wurde. */
export function errorMessage(error: unknown, fallback = 'Bitte versuch es gleich noch mal.'): string {
  return error instanceof ApiError ? error.firstError() : fallback;
}

/**
 * Fehler je Eingabefeld, wie ein Formular sie zeigt. Ohne Feldangaben landet die
 * Meldung bei `field` – so steht nie ein Fehler ohne Platz da.
 */
export function fieldErrors(error: unknown, field: string): Record<string, string[]> {
  if (!(error instanceof ApiError)) return { [field]: ['Unbekannter Fehler.'] };
  return Object.keys(error.errors).length > 0 ? error.errors : { [field]: [error.firstError()] };
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  token?: string | null;
};

const OFFLINE = 'Keine Verbindung zum Server. Bist du online?';

/**
 * Every answer to an authenticated request is reported here (F-20): a 401 means the server no
 * longer accepts the session (expired, or signed out by a password, e-mail or two-factor change
 * elsewhere), and the auth state signs out on this device (src/lib/auth-context.tsx). Logic and
 * tests: src/domain/session.ts.
 */
export const sessionWatch = createSessionWatch();

/**
 * Reads an answer: reports its status with the token the request carried, parses JSON, and
 * throws an ApiError with the full body (bans put their details there) when the request failed.
 * Every fetch site of this file goes through here.
 */
async function parseResponse<T>(response: Response, token: string | null | undefined): Promise<T> {
  sessionWatch.report(response.status, token);

  const isJson = response.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await response.json() : null;
  if (!response.ok) {
    throw new ApiError(data?.message ?? 'Etwas ist schiefgelaufen.', response.status, data?.errors ?? {}, data ?? null);
  }
  return data as T;
}

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
    throw new ApiError(OFFLINE, 0);
  }
  return parseResponse<T>(response, token);
}

/** multipart/form-data – den Content-Type samt Boundary setzt `fetch` selbst. */
async function upload<T>(token: string, path: string, form: FormData): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      body: form,
    });
  } catch {
    throw new ApiError(OFFLINE, 0);
  }
  return parseResponse<T>(response, token);
}

/**
 * Formular mit optionalem Bild. Am Gerät nimmt `FormData` das Objekt aus dem
 * Bildwähler direkt; im Browser (Admin-Bereich am Rechner) muss es erst eine
 * echte Datei werden – sonst kommt beim Server nur „[object Object]" an.
 */
async function imageForm(fields: Record<string, string>, key: string, image?: ImageUpload | null): Promise<FormData> {
  const form = new FormData();
  Object.entries(fields).forEach(([k, v]) => form.append(k, v));
  if (image) {
    if (Platform.OS === 'web') {
      const blob = await (await fetch(image.uri)).blob();
      form.append(key, blob, image.name);
    } else {
      form.append(key, image as unknown as Blob);
    }
  }
  return form;
}

export const api = {
  /* ------------------------------------------------------------ Anmeldung */

  register: (input: RegisterInput) =>
    request<AuthResult>('/register', { method: 'POST', body: { ...input, device_name: 'app' } }),

  login: (email: string, password: string) =>
    request<LoginResult>('/login', { method: 'POST', body: { email, password, device_name: 'app' } }),

  loginTwoFactor: (challenge: string, code: string) =>
    request<AuthResult>('/login/two-factor', { method: 'POST', body: { challenge, code, device_name: 'app' } }),

  resendTwoFactor: (challenge: string) =>
    request<{ message: string; expires_in: number }>('/login/two-factor/resend', { method: 'POST', body: { challenge } }),

  /**
   * Fordert eine „Passwort vergessen"-Mail an. It carries a 6-digit code, no link (F-09).
   * Antwortet immer neutral (die API verrät nicht, ob die Adresse registriert ist) – ein 422
   * kommt nur bei einer ungültigen E-Mail-Eingabe. Also the way to get a new code; the server
   * sends at most one mail a minute per account.
   */
  forgotPassword: (email: string) =>
    request<{ status: string; message: string }>('/forgot-password', { method: 'POST', body: { email } }),

  /**
   * Sets a new password with the code from the "Passwort vergessen" mail (signed out). Signs out
   * every device. A wrong, expired or used code and an unknown address get the same 422 on `code`.
   */
  resetPassword: (input: { email: string; code: string; password: string; password_confirmation: string }) =>
    request<{ status: string; message: string }>('/reset-password', {
      method: 'POST',
      body: input,
    }),

  logout: (token: string) => request<{ message: string }>('/logout', { method: 'POST', token }),

  me: (token: string) => request<{ user: User; profile_complete: boolean }>('/user', { token }),

  updateProfile: (token: string, input: UpdateProfileInput) =>
    request<{ user: User; profile_complete: boolean }>('/user', { method: 'PATCH', body: input, token }),

  uploadAvatar: (token: string, image: ImageUpload) =>
    imageForm({}, 'image', image).then((form) => upload<{ user: User }>(token, '/user/avatar', form)),

  removeAvatar: (token: string) => request<{ user: User }>('/user/avatar', { method: 'DELETE', token }),

  interests: () => request<{ data: Interest[] }>('/interests'),

  /* ----------------------------------------------------------- Sicherheit */

  /** 2FA per E-Mail einrichten, Schritt 1: mit dem Passwort bestätigen, Code an die Konto-Adresse. */
  twoFactorEmailStart: (token: string, password: string) =>
    request<{ message: string; destination: string; expires_in: number; challenge: string }>('/user/two-factor/email', {
      method: 'POST',
      body: { password },
      token,
    }),

  twoFactorEmailConfirm: (token: string, challenge: string, code: string) =>
    request<{ user: User; recovery_codes: string[] }>('/user/two-factor/email/confirm', {
      method: 'POST',
      body: { challenge, code },
      token,
    }),

  /** Authenticator-App einrichten, Schritt 1: mit dem Passwort bestätigen, Geheimnis + otpauth-Link holen. */
  twoFactorTotpStart: (token: string, password: string) =>
    request<{ secret: string; otpauth_url: string }>('/user/two-factor/totp', { method: 'POST', body: { password }, token }),

  twoFactorTotpConfirm: (token: string, code: string) =>
    request<{ user: User; recovery_codes: string[] }>('/user/two-factor/totp/confirm', { method: 'POST', body: { code }, token }),

  twoFactorSendCode: (token: string) =>
    request<{ message: string; destination: string; expires_in: number }>('/user/two-factor/code', { method: 'POST', token }),

  /** 2FA abschalten – mit Passwort und aktuellem Code bestätigt. Meldet andere Geräte ab. */
  twoFactorDisable: (token: string, proof: SecondFactorProof) =>
    request<{ user: User }>('/user/two-factor', { method: 'DELETE', body: proof, token }),

  twoFactorRecoveryCodes: (token: string, proof: SecondFactorProof) =>
    request<{ recovery_codes: string[] }>('/user/two-factor/recovery-codes', { method: 'POST', body: proof, token }),

  /**
   * Change the e-mail address (signed in), step 1: with the current password, and with two-factor
   * sign-in also a current code. Changes nothing yet: the server mails a one-time code to the NEW
   * address (at most one mail a minute).
   */
  changeEmail: (token: string, input: { email: string; current_password: string; code?: string }) =>
    request<{ message: string; destination: string; expires_in: number }>('/user/email', { method: 'PUT', body: input, token }),

  /**
   * Change the e-mail address, step 2: the code from the mail to the new address, with that same
   * address. Only now does it take effect; every other device is signed out and a notice goes to
   * the previous address.
   */
  confirmEmailChange: (token: string, input: { email: string; code: string }) =>
    request<{ user: User; profile_complete: boolean }>('/user/email/confirm', { method: 'POST', body: input, token }),

  /** Passwort ändern (angemeldet). Meldet alle anderen Geräte ab. */
  changePassword: (token: string, currentPassword: string, password: string) =>
    request<{ message: string }>('/user/password', { method: 'PUT', body: { current_password: currentPassword, password }, token }),

  /**
   * An account without a password (former Google sign-in), step 1: a one-time code to the
   * account's own address (at most one mail a minute).
   */
  requestFirstPasswordCode: (token: string) =>
    request<{ message: string; destination: string; expires_in: number }>('/user/password/code', { method: 'POST', token }),

  /** An account without a password, step 2: the first password, with the mailed code. */
  setFirstPassword: (token: string, code: string, password: string) =>
    request<{ message: string }>('/user/password', { method: 'PUT', body: { code, password }, token }),

  deleteAccount: (token: string, input: { password?: string; confirm?: string; code?: string }) =>
    request<{ message: string }>('/me', { method: 'DELETE', body: input, token }),

  /* ----------------------------------------------------------- Marktplatz */

  offers: (token: string) => request<{ data: Offer[] }>('/offers', { token }),

  offer: (token: string, id: number) => request<{ data: Offer }>(`/offers/${id}`, { token }),

  quote: (token: string, offerId: number, people: number, payMethod: PayMethod) =>
    request<{ data: Quote }>(`/offers/${offerId}/quote`, { method: 'POST', body: { people, pay_method: payMethod }, token }),

  partners: (token: string) => request<{ data: Partner[] }>('/partners', { token }),

  partner: (token: string, id: number) => request<{ data: Partner }>(`/partners/${id}`, { token }),

  /* -------------------------------------------------------------- Buchen */

  bookings: (token: string) => request<{ data: Booking[] }>('/bookings', { token }),

  booking: (token: string, id: number) => request<{ data: Booking }>(`/bookings/${id}`, { token }),

  /** Freie Plätze eines Angebots mit Tageskontingent an einem Tag (Y-m-d). */
  availability: (token: string, offerId: number, date: string) =>
    request<{ data: Availability }>(`/offers/${offerId}/availability?date=${encodeURIComponent(date)}`, { token }),

  /** Testphase: private Rückmeldung an den Partner nach dem Einlösen. */
  bookingFeedback: (token: string, id: number, rating: number, comment: string | null) =>
    request<{ data: Booking; credits: number; credits_balance: number }>(`/bookings/${id}/feedback`, {
      method: 'POST',
      body: { rating, comment },
      token,
    }),

  book: (
    token: string,
    input: { offerId: number; people: number; payMethod: PayMethod; groupId?: number | null; preferredDate?: string | null },
  ) =>
    request<{ data: Booking; credits_balance: number }>('/bookings', {
      method: 'POST',
      body: {
        offer_id: input.offerId,
        people: input.people,
        pay_method: input.payMethod,
        group_id: input.groupId ?? null,
        preferred_date: input.preferredDate ?? null,
      },
      token,
    }),

  cancelBooking: (token: string, id: number) =>
    request<{ data: Booking; credits_balance: number }>(`/bookings/${id}/cancel`, { method: 'POST', token }),

  /** Selbst einlösen – mit dem gescannten Aufkleber als Nachweis. */
  redeemBooking: (token: string, id: number, stickerToken: string) =>
    request<{ data: Booking }>(`/bookings/${id}/redeem`, { method: 'POST', body: { token: stickerToken }, token }),

  /* ---------------------------------------------------- Club und Credits */

  club: (token: string) => request<{ data: ClubState }>('/club', { token }),

  subscribe: (token: string, plan: PlanKey, interval: ClubInterval = 'month') =>
    request<{ data: ClubState }>('/club/subscribe', { method: 'POST', body: { plan, interval }, token }),

  /** Abzeichen mit Datum – verdiente zuerst. */
  badges: (token: string) => request<{ data: Badge[] }>('/badges', { token }),

  cancelPlan: (token: string) => request<{ data: ClubState }>('/club/cancel', { method: 'POST', token }),

  wallet: (token: string) => request<{ data: WalletState }>('/wallet', { token }),

  /** Was dieses Konto sehen darf (Admin-Schalter, src/domain/features.ts). */
  features: (token: string) => request<{ data: FeatureState }>('/features', { token }),

  /** Stadt-Bingo – nur, wenn es für dieses Konto freigeschaltet ist (sonst 403). */
  bingo: (token: string) => request<{ data: BingoState }>('/bingo', { token }),

  claimBingo: (token: string, key: string) =>
    request<{ data: BingoState; credits: number; balance: number }>('/bingo/claim', { method: 'POST', body: { key }, token }),

  buyCredits: (token: string, credits: number) =>
    request<{ data: { balance: number; added: number; bonus: number; first_purchase_bonus: number } }>('/wallet/purchase', {
      method: 'POST',
      body: { credits },
      token,
    }),

  redeemVoucher: (token: string, code: string) =>
    request<{ data: { balance: number; added: number } }>('/wallet/redeem', { method: 'POST', body: { code }, token }),

  /* ------------------------------------------------ Stempel und Check-in */

  stamps: (token: string) => request<{ data: StampCard }>('/stamps', { token }),

  pass: (token: string) => request<{ data: PassToken }>('/pass', { token }),

  checkin: (token: string, input: { token: string; method: CheckinMethod; lat?: number | null; lng?: number | null }) =>
    request<{ data: CheckinResult }>('/checkins', { method: 'POST', body: input, token }),

  /* --------------------------------------------------------- Partner-Modus */

  staffPartners: (token: string) =>
    request<{ data: { id: number; name: string; role: string }[] }>('/partner/me', { token }),

  staffCheckin: (token: string, partnerId: number, pass: string) =>
    request<{ data: CheckinResult }>('/partner/checkins', { method: 'POST', body: { partner_id: partnerId, pass }, token }),

  staffBookings: (token: string, partnerId: number) =>
    request<{ data: Booking[]; checked_in_today: number; generated_at: string }>(`/partner/bookings?partner_id=${partnerId}`, { token }),

  staffRedeem: (token: string, bookingId: number) =>
    request<{ data: Booking }>(`/partner/bookings/${bookingId}/redeem`, { method: 'POST', token }),

  /* ---------------------------------------------------------------- Gruppen */

  groups: (token: string) => request<{ data: Group[] }>('/groups', { token }),

  group: (token: string, id: number) => request<{ data: Group }>(`/groups/${id}`, { token }),

  createGroup: (token: string, name: string, description?: string) =>
    request<{ data: Group }>('/groups', { method: 'POST', body: { name, description: description || null }, token }),

  updateGroup: (token: string, id: number, input: { name?: string; description?: string | null }) =>
    request<{ data: Group }>(`/groups/${id}`, { method: 'PATCH', body: input, token }),

  deleteGroup: (token: string, id: number) => request<{ message: string }>(`/groups/${id}`, { method: 'DELETE', token }),

  rotateInviteCode: (token: string, id: number) =>
    request<{ data: Group }>(`/groups/${id}/invite-code`, { method: 'POST', token }),

  previewInvite: (token: string, code: string) =>
    request<{ data: GroupPreview }>(`/groups/invite/${encodeURIComponent(code)}`, { token }),

  joinGroup: (token: string, code: string) =>
    request<{ data: Group }>('/groups/join', { method: 'POST', body: { code }, token }),

  /** Jemanden entfernen – oder selbst gehen (die eigene ID). */
  removeGroupMember: (token: string, groupId: number, userId: number) =>
    request<{ data?: Group; message?: string }>(`/groups/${groupId}/members/${userId}`, { method: 'DELETE', token }),

  /* ------------------------------------------------------------------ Chat */

  messages: (token: string, groupId: number, options: { after?: number; before?: number; limit?: number } = {}) => {
    const query = new URLSearchParams();
    if (options.after) query.set('after', String(options.after));
    if (options.before) query.set('before', String(options.before));
    if (options.limit) query.set('limit', String(options.limit));
    const suffix = query.toString() ? `?${query}` : '';
    return request<{ data: ChatMessage[]; room: ChatRoom }>(`/groups/${groupId}/messages${suffix}`, { token });
  },

  sendMessage: (token: string, groupId: number, input: { body?: string; offerId?: number }) =>
    request<{ data: ChatMessage }>(`/groups/${groupId}/messages`, {
      method: 'POST',
      body: { body: input.body ?? '', offer_id: input.offerId ?? null },
      token,
    }),

  markRead: (token: string, groupId: number, messageId?: number) =>
    request<{ unread: number }>(`/groups/${groupId}/read`, { method: 'POST', body: { message_id: messageId ?? 0 }, token }),

  deleteMessage: (token: string, messageId: number) =>
    request<{ message: string }>(`/messages/${messageId}`, { method: 'DELETE', token }),

  /* ----------------------------------------------------- Melden & Blockieren */

  report: (token: string, input: { targetType: ReportTarget; targetId: number; reason: string; note?: string }) =>
    request<{ message: string }>('/reports', {
      method: 'POST',
      body: { target_type: input.targetType, target_id: input.targetId, reason: input.reason, note: input.note ?? '' },
      token,
    }),

  blocks: (token: string) => request<{ data: BlockedPerson[] }>('/blocks', { token }),

  blockUser: (token: string, userId: number) =>
    request<{ message: string }>('/blocks', { method: 'POST', body: { user_id: userId }, token }),

  unblockUser: (token: string, userId: number) => request<{ message: string }>(`/blocks/${userId}`, { method: 'DELETE', token }),

  /* ------------------------------------------------------------------ Admin */

  admin: {
    /** Funktions-Schalter: für alle (`setGlobal`) bzw. nur fürs eigene Konto (`setPreview`). */
    features: {
      state: (token: string) => request<{ data: AdminFeatureState }>('/admin/features', { token }),
      setGlobal: (token: string, key: FeatureKey, body: { enabled?: boolean; value?: string }) =>
        request<{ data: AdminFeatureState }>(`/admin/features/${key}`, { method: 'PUT', body, token }),
      setPreview: (token: string, key: FeatureKey, body: { mode?: PreviewMode; value?: string | null }) =>
        request<{ data: AdminFeatureState }>(`/admin/features/${key}/preview`, { method: 'PUT', body, token }),
    },

    stats: (token: string) => request<AdminStats>('/admin/stats', { token }),

    bookings: (token: string) => request<{ data: AdminBooking[] }>('/admin/bookings', { token }),

    reports: (token: string, status: 'open' | 'all' = 'open') =>
      request<{ data: AdminReport[] }>(`/admin/reports?status=${status}`, { token }),

    updateReport: (token: string, id: number, status: AdminReport['status']) =>
      request<{ message: string }>(`/admin/reports/${id}`, { method: 'PATCH', body: { status }, token }),

    users: (token: string, q = '') => request<{ data: AdminUser[] }>(`/admin/users?q=${encodeURIComponent(q)}`, { token }),

    user: (token: string, id: number) => request<{ data: AdminUserDetail }>(`/admin/users/${id}`, { token }),

    renameUser: (token: string, id: number, username: string) =>
      request<{ message: string; username: string }>(`/admin/users/${id}`, { method: 'PATCH', body: { username }, token }),

    banUser: (token: string, id: number, reason: string, image?: ImageUpload | null) =>
      imageForm({ reason }, 'evidence', image).then((form) => upload<{ message: string }>(token, `/admin/users/${id}/ban`, form)),

    timeoutUser: (token: string, id: number, minutes: number, reason: string, image?: ImageUpload | null) =>
      imageForm({ minutes: String(minutes), reason }, 'evidence', image).then((form) =>
        upload<{ message: string }>(token, `/admin/users/${id}/timeout`, form),
      ),

    unbanUser: (token: string, id: number) => request<{ message: string }>(`/admin/users/${id}/unban`, { method: 'POST', token }),

    deleteUser: (token: string, id: number) => request<{ message: string }>(`/admin/users/${id}`, { method: 'DELETE', token }),

    /** Plus = gutschreiben, Minus = abziehen (höchstens bis 0). Geht auch beim eigenen Konto. */
    adjustCredits: (token: string, id: number, amount: number, note: string) =>
      request<{ data: AdminUserDetail }>(`/admin/users/${id}/credits`, { method: 'POST', body: { amount, note }, token }),

    /** Plus = Stempel gutschreiben (volle Karte bringt Credits), Minus = jüngste Stempel abziehen. */
    adjustStamps: (token: string, id: number, amount: number) =>
      request<{ data: AdminUserDetail; reward_credits: number }>(`/admin/users/${id}/stamps`, { method: 'POST', body: { amount }, token }),

    evidence: (token: string) => request<{ data: AdminEvidence[] }>('/admin/evidence', { token }),

    /** Testphase (nur Admins): Bingo, Challenges, Serie – gerechnet mit dem eigenen Konto. */
    testphase: {
      state: (token: string) => request<{ data: TestphaseState }>('/admin/testphase', { token }),

      /** Challenge mit Wahl an- oder abwählen. */
      choose: (token: string, challengeId: number) =>
        request<{ data: TestphaseState }>('/admin/testphase/choose', { method: 'POST', body: { challenge_id: challengeId }, token }),

      addWish: (token: string, name: string, note: string | null) =>
        request<{ data: TestphaseState }>('/admin/testphase/wishes', { method: 'POST', body: { name, note }, token }),

      voteWish: (token: string, id: number) =>
        request<{ data: TestphaseState }>(`/admin/testphase/wishes/${id}/vote`, { method: 'POST', token }),

      deleteWish: (token: string, id: number) =>
        request<{ data: TestphaseState }>(`/admin/testphase/wishes/${id}`, { method: 'DELETE', token }),

      requestShares: (token: string, bookingId: number, userIds: number[]) =>
        request<{ data: TestphaseState }>('/admin/testphase/shares', { method: 'POST', body: { booking_id: bookingId, user_ids: userIds }, token }),

      payShare: (token: string, id: number) =>
        request<{ data: TestphaseState; credits: number; balance: number }>(`/admin/testphase/shares/${id}/pay`, { method: 'POST', token }),

      declineShare: (token: string, id: number) =>
        request<{ data: TestphaseState }>(`/admin/testphase/shares/${id}/decline`, { method: 'POST', token }),

      createPoll: (token: string, input: { group_id: number; title: string; options: { offer_id: number; day?: string | null }[] }) =>
        request<{ data: TestphaseState }>('/admin/testphase/polls', { method: 'POST', body: input, token }),

      votePoll: (token: string, id: number, optionId: number) =>
        request<{ data: TestphaseState }>(`/admin/testphase/polls/${id}/vote`, { method: 'POST', body: { option_id: optionId }, token }),

      closePoll: (token: string, id: number) =>
        request<{ data: TestphaseState }>(`/admin/testphase/polls/${id}/close`, { method: 'POST', token }),

      claim: (token: string, key: string) =>
        request<{ data: TestphaseState; credits: number; balance: number }>('/admin/testphase/claim', { method: 'POST', body: { key }, token }),

      createChallenge: (token: string, input: NewChallengeInput) =>
        request<{ data: TestphaseState; id: number }>('/admin/testphase/challenges', { method: 'POST', body: input, token }),

      deleteChallenge: (token: string, id: number) =>
        request<{ data: TestphaseState }>(`/admin/testphase/challenges/${id}`, { method: 'DELETE', token }),

      examples: (token: string) => request<{ data: TestphaseState; created: number }>('/admin/testphase/examples', { method: 'POST', token }),
    },

    partners: (token: string) => request<{ data: AdminPartner[] }>('/admin/partners', { token }),

    partner: (token: string, id: number) => request<{ data: AdminPartner }>(`/admin/partners/${id}`, { token }),

    createPartner: (token: string, input: PartnerInput) =>
      request<{ data: AdminPartner }>('/admin/partners', { method: 'POST', body: input, token }),

    updatePartner: (token: string, id: number, input: PartnerInput) =>
      request<{ data: AdminPartner }>(`/admin/partners/${id}`, { method: 'PATCH', body: input, token }),

    deletePartner: (token: string, id: number) => request<{ message: string }>(`/admin/partners/${id}`, { method: 'DELETE', token }),

    partnerImage: (token: string, id: number, kind: 'logo' | 'cover', image: ImageUpload) =>
      imageForm({ kind }, 'image', image).then((form) => upload<{ data: AdminPartner }>(token, `/admin/partners/${id}/image`, form)),

    rotatePartnerToken: (token: string, id: number) =>
      request<{ data: AdminPartner }>(`/admin/partners/${id}/rotate-token`, { method: 'POST', token }),

    addStaff: (token: string, id: number, email: string) =>
      request<{ data: AdminPartner }>(`/admin/partners/${id}/staff`, { method: 'POST', body: { email }, token }),

    removeStaff: (token: string, id: number, userId: number) =>
      request<{ data: AdminPartner }>(`/admin/partners/${id}/staff/${userId}`, { method: 'DELETE', token }),

    offers: (token: string, partnerId?: number) =>
      request<{ data: AdminOffer[] }>(`/admin/offers${partnerId ? `?partner_id=${partnerId}` : ''}`, { token }),

    createOffer: (token: string, input: OfferInput) =>
      request<{ data: AdminOffer }>('/admin/offers', { method: 'POST', body: input, token }),

    updateOffer: (token: string, id: number, input: OfferInput) =>
      request<{ data: AdminOffer }>(`/admin/offers/${id}`, { method: 'PATCH', body: input, token }),

    deleteOffer: (token: string, id: number) => request<{ message: string }>(`/admin/offers/${id}`, { method: 'DELETE', token }),

    offerImage: (token: string, id: number, image: ImageUpload) =>
      imageForm({}, 'image', image).then((form) => upload<{ data: AdminOffer }>(token, `/admin/offers/${id}/image`, form)),

    voucherBatches: (token: string) => request<{ data: VoucherBatch[] }>('/admin/voucher-batches', { token }),

    createVoucherBatch: (
      token: string,
      input: { label: string; retailer?: string | null; credits: number; quantity: number; expires_at?: string | null },
    ) => request<{ data: VoucherBatch }>('/admin/voucher-batches', { method: 'POST', body: input, token }),

    /** Adresse der CSV-Datei – die Datei selbst lädt der Browser mit Token (siehe admin-vouchers). */
    voucherCsvPath: (batchId: number) => `/admin/voucher-batches/${batchId}/codes.csv`,

    disableVoucher: (token: string, code: string) =>
      request<{ message: string }>('/admin/vouchers/disable', { method: 'POST', body: { code }, token }),
  },
};

/** Für Downloads mit Token (CSV im Admin-Bereich). */
export async function fetchText(token: string, path: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  } catch {
    throw new ApiError(OFFLINE, 0);
  }
  sessionWatch.report(response.status, token);
  if (!response.ok) throw new ApiError('Download fehlgeschlagen.', response.status);
  return response.text();
}
