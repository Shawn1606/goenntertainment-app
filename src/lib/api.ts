import { Platform } from 'react-native';

import { API_URL } from '@/constants/config';
import type { ClubPlan, PlanKey } from '@/domain/club';

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

export type SecondFactorProof = { password: string } | { code: string };

export type RegisterInput = {
  name: string;
  username: string;
  email: string;
  password: string;
  interests?: number[];
  /** Stand der Nutzungsbedingungen, dem zugestimmt wurde (src/domain/legal.ts). */
  terms_version?: string;
};

export type UpdateProfileInput = {
  name?: string;
  username?: string;
  email?: string;
  interests?: number[];
};

export type BanInfo = {
  reason: string | null;
  permanent: boolean;
  banned_until: string | null;
};

/* ========================================================== Marktplatz */

export type OfferKind = 'activity' | 'perk';

export type OfferPartner = {
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
  partner: OfferPartner | null;
};

export type Partner = {
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
  reward_credits: number;
  /** Die Stempel der laufenden Karte, ältester zuerst. */
  stamps: StampEntry[];
};

export type CreditPack = { credits: number; price_cents: number };

export type PaymentsMode = 'test' | 'off';

export type ClubState = {
  plan: PlanKey;
  plan_name: string;
  since: string | null;
  renews_at: string | null;
  cancel_at_period_end: boolean;
  credits: number;
  stamps: StampCard;
  plans: ClubPlan[];
  group_discount: { minPeople: number; percent: number }[];
  packs: CreditPack[];
  payments_mode: PaymentsMode;
};

export type CreditTransactionKind = 'purchase' | 'voucher' | 'stamp_reward' | 'monthly' | 'booking' | 'refund' | 'admin';

export type CreditTransaction = {
  id: number;
  amount: number;
  balance_after: number;
  kind: CreditTransactionKind;
  description: string;
  created_at: string | null;
};

export type WalletState = {
  balance: number;
  transactions: CreditTransaction[];
  packs: CreditPack[];
  payments_mode: PaymentsMode;
};

export type CheckinMethod = 'nfc' | 'qr';

export type CheckinResult = {
  partner: { id: number; name: string };
  stamped: boolean;
  reward_credits: number;
  stamps: StampCard;
  /** Fehlt im Partner-Modus (der Partner sieht fremde Stände nicht). */
  credits?: number;
  open_bookings: Booking[];
  /** Nur im Partner-Modus. */
  customer?: { first_name: string };
};

export type PassToken = { token: string; expires_at: string };

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
  banned: boolean;
  banned_permanent: boolean;
  banned_until: string | null;
  ban_reason: string | null;
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
}

/** Die Meldung, die man zeigen kann – egal, was geworfen wurde. */
export function errorMessage(error: unknown, fallback = 'Bitte versuch es gleich noch mal.'): string {
  return error instanceof ApiError ? error.firstError() : fallback;
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  token?: string | null;
};

const OFFLINE = 'Keine Verbindung zum Server. Bist du online?';

async function parse<T>(response: Response): Promise<T> {
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
  return parse<T>(response);
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
  return parse<T>(response);
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

  forgotPassword: (email: string) =>
    request<{ status: string; message: string }>('/forgot-password', { method: 'POST', body: { email } }),

  logout: (token: string) => request<{ message: string }>('/logout', { method: 'POST', token }),

  me: (token: string) => request<{ user: User; profile_complete: boolean }>('/user', { token }),

  updateProfile: (token: string, input: UpdateProfileInput) =>
    request<{ user: User; profile_complete: boolean }>('/user', { method: 'PATCH', body: input, token }),

  interests: () => request<{ data: Interest[] }>('/interests'),

  /* ----------------------------------------------------------- Sicherheit */

  twoFactorEmailStart: (token: string) =>
    request<{ message: string; destination: string; expires_in: number; challenge: string }>('/user/two-factor/email', {
      method: 'POST',
      token,
    }),

  twoFactorEmailConfirm: (token: string, challenge: string, code: string) =>
    request<{ user: User; recovery_codes: string[] }>('/user/two-factor/email/confirm', {
      method: 'POST',
      body: { challenge, code },
      token,
    }),

  twoFactorTotpStart: (token: string) =>
    request<{ secret: string; otpauth_url: string }>('/user/two-factor/totp', { method: 'POST', token }),

  twoFactorTotpConfirm: (token: string, code: string) =>
    request<{ user: User; recovery_codes: string[] }>('/user/two-factor/totp/confirm', { method: 'POST', body: { code }, token }),

  twoFactorSendCode: (token: string) =>
    request<{ message: string; destination: string; expires_in: number }>('/user/two-factor/code', { method: 'POST', token }),

  twoFactorDisable: (token: string, proof: SecondFactorProof) =>
    request<{ user: User }>('/user/two-factor', { method: 'DELETE', body: proof, token }),

  twoFactorRecoveryCodes: (token: string, proof: SecondFactorProof) =>
    request<{ recovery_codes: string[] }>('/user/two-factor/recovery-codes', { method: 'POST', body: proof, token }),

  changePassword: (token: string, currentPassword: string, password: string) =>
    request<{ message: string }>('/user/password', { method: 'PUT', body: { current_password: currentPassword, password }, token }),

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

  subscribe: (token: string, plan: PlanKey) =>
    request<{ data: ClubState }>('/club/subscribe', { method: 'POST', body: { plan }, token }),

  cancelPlan: (token: string) => request<{ data: ClubState }>('/club/cancel', { method: 'POST', token }),

  wallet: (token: string) => request<{ data: WalletState }>('/wallet', { token }),

  buyCredits: (token: string, credits: number) =>
    request<{ data: { balance: number; added: number } }>('/wallet/purchase', { method: 'POST', body: { credits }, token }),

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
    stats: (token: string) => request<AdminStats>('/admin/stats', { token }),

    bookings: (token: string) => request<{ data: AdminBooking[] }>('/admin/bookings', { token }),

    reports: (token: string, status: 'open' | 'all' = 'open') =>
      request<{ data: AdminReport[] }>(`/admin/reports?status=${status}`, { token }),

    updateReport: (token: string, id: number, status: AdminReport['status']) =>
      request<{ message: string }>(`/admin/reports/${id}`, { method: 'PATCH', body: { status }, token }),

    users: (token: string, q = '') => request<{ data: AdminUser[] }>(`/admin/users?q=${encodeURIComponent(q)}`, { token }),

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

    grantCredits: (token: string, id: number, amount: number, note: string) =>
      request<{ data: AdminUser }>(`/admin/users/${id}/credits`, { method: 'POST', body: { amount, note }, token }),

    evidence: (token: string) => request<{ data: AdminEvidence[] }>('/admin/evidence', { token }),

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
  if (!response.ok) throw new ApiError('Download fehlgeschlagen.', response.status);
  return response.text();
}
