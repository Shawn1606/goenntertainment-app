import { API_URL } from '@/constants/config';
import type { AccountType } from '@/domain/account';
import type { BillingPeriod } from '@/domain/billing-period';
import type { ReportTarget } from '@/domain/report-reason';
import { createSessionWatch } from '@/domain/session';

/**
 * Die Kontostufe wohnt in der Domain-Schicht (dort stehen auch die Rechte und
 * die Texte dazu) und wird hier nur weitergereicht – so bleiben die vielen
 * `from '@/lib/api'`-Importe in der App gültig. Dasselbe gilt für den
 * Zahlungsrhythmus (Monat/Jahr) aus `@/domain/billing-period`.
 */
export type { AccountType, BillingPeriod };

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
  /**
   * Bild des Hosts als fertige Adresse – oder `null`.
   *
   * Die Karten bauen daraus ihr Banner, wenn das Event selbst keines hat: klein
   * und scharf als Zeichen des Anbieters, gross und weichgezeichnet als
   * Hintergrund (siehe `activity-card.tsx`).
   */
  avatar_url: string | null;
  /**
   * Stufe des Hosts – nur dafür da, zu wissen, ob sich der Name zum Profil
   * verlinken lässt (ein Standard-Konto hat keine öffentliche Seite).
   */
  account_type: AccountType | null;
};

export type ActivityParticipant = {
  id: number;
  name: string;
  username: string | null;
  /** Profilbild als fertige Adresse. Ältere Server liefern das Feld nicht. */
  avatar_url?: string | null;
};

/**
 * Ein Kommentar unter einer Aktivität.
 *
 * Gleiche Form wie {@link PostComment}: `can_delete` entscheidet der Server
 * (eigener Kommentar, eigene Aktivität oder Admin) – die App rät nicht selbst.
 */
export type ActivityComment = {
  id: number;
  body: string;
  created_at: string | null;
  can_delete: boolean;
  user: {
    id: number;
    name: string;
    username: string | null;
    avatar: string | null;
    account_type?: AccountType | null;
  };
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
  /**
   * Dauerangebot ohne festen Termin – Bowling, Trampolinhalle, Freibad.
   *
   * Ist das true, ist `starts_at` BEDEUTUNGSLOS (es trägt nur den Anlege-
   * Zeitpunkt, weil die Spalte in der DB nicht leer sein darf). Nichts in der App
   * darf damit rechnen: keine Uhrzeit anzeigen, keine Dringlichkeit, kein
   * Zeitfenster-Filter. Warum ausführlich in `server/schema.sql`.
   */
  is_permanent: boolean;
  /** Von wie vielen verschiedenen Leuten das Event angesehen wurde (ohne Host). */
  views_count: number;
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
  /**
   * Bis wann das Event hervorgehoben ist (von einem Business-Konto gesetzt);
   * null = normal. Die Empfehlungen ziehen hervorgehobene Events nach vorne.
   */
  boosted_until: string | null;
  /**
   * Auf der eigenen Merkliste? Merken ist bewusst KEINE Zusage: Es belegt keinen
   * Platz und sagt niemandem zu (siehe server/schema.sql). Ältere Server liefern
   * das Feld nicht – dann gilt „nicht gemerkt".
   */
  is_saved?: boolean;
  /**
   * Gefällt-mir-Angaben und Kommentare. Optional, weil ältere Server sie nicht
   * liefern – dann gilt „0" bzw. „nicht geliked".
   */
  likes_count?: number;
  comments_count?: number;
  liked_by_me?: boolean;
};

/**
 * Ein Eintrag im persönlichen Verlauf („Meine Aktivitäten"). Ein Schnappschuss –
 * bleibt auch bestehen, nachdem das Event gelöscht wurde bzw. man ausgetreten ist
 * (dann `is_active = false`), und verschwindet erst 7 Tage danach.
 */
export type ActivityHistoryEntry = {
  /** ID des Verlaufs-Eintrags (nicht der Activity!). */
  id: number;
  /** Referenz auf die noch existierende Activity; null, wenn gelöscht. */
  activity_id: number | null;
  /** Warst du Ersteller:in ('host') oder beigetreten ('participant')? */
  role: 'host' | 'participant';
  title: string;
  location: string;
  starts_at: string | null;
  banner_url: string | null;
  /** true = Event existiert noch und du bist dabei. false = verlassen/gelöscht. */
  is_active: boolean;
  /** ISO-Zeitpunkt, ab dem die 7-Tage-Frist läuft; null solange aktiv. */
  removed_at: string | null;
  /** ISO-Zeitpunkt, an dem du erstellt/beigetreten bist. */
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
  /**
   * Selbst eingetippte Interessen. Werden nicht gespeichert, aber von der
   * KI-Verifizierung mitgeprüft (freier Text = eigentliches Risiko).
   */
  customInterests?: string[];
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
  /**
   * Bild hinter der Profil-Karte. Die App zeigt es weichgezeichnet – deshalb
   * „Banner" und nicht „Hintergrundbild": Man wählt ein Motiv, keine Tapete.
   * Ältere Server liefern das Feld nicht, dann bleibt es undefiniert.
   */
  banner?: string | null;
  /** true = Admin (darf jedes Event löschen, sieht den Admin-Tab). */
  is_admin?: boolean;
  interests?: Interest[];
  /**
   * Aktive Zwei-Faktor-Methode – `null`/fehlend = aus. Kommt nur für das eigene
   * Konto; Geheimnis und Wiederherstellungscodes liefert der Server nie aus.
   */
  two_factor_method?: TwoFactorMethod | null;
};

export type TwoFactorMethod = 'email' | 'totp';

/**
 * Zweiter Schritt der Anmeldung. Der Server gibt nach richtigem Passwort KEIN
 * Token heraus, sondern diesen Beleg; erst mit dem Code wird daraus eine
 * Anmeldung (`api.loginTwoFactor`).
 */
export type TwoFactorChallenge = {
  /** Undurchsichtiger Beleg für genau diesen Anmeldeversuch. */
  challenge: string;
  method: TwoFactorMethod;
  /** Maskierte Adresse, an die der Code ging („s***@gmail.com") – nur bei E-Mail. */
  destination: string | null;
  /** Sekunden, bis der Beleg verfällt. */
  expires_in: number;
};

/** Ein Tagespunkt im Admin-Verlaufsgraphen. */
export type AdminStatsPoint = { date: string; count: number };

/** Antwort von GET /api/admin/stats – Kennzahlen + Tages-Verlauf. */
export type AdminStats = {
  totals: {
    users: number;
    activities: number;
    joins: number;
    /**
     * Laufende Storys und offene Konto-Anfragen. Ältere Server liefern die
     * beiden Felder nicht – deshalb optional, die Screens zeigen dann keine Zahl.
     */
    stories?: number;
    pending_requests?: number;
    /** Offene Meldungen von Nutzer:innen (siehe /admin/reports). */
    open_reports?: number;
  };
  recent: { days: number; new_users: number; joins: number };
  series: { days: number; signups: AdminStatsPoint[]; joins: AdminStatsPoint[] };
};

/** Ein Nutzer in der Admin-Nutzerliste (GET /api/admin/users). */
export type AdminUser = {
  id: number;
  name: string;
  username: string | null;
  email: string;
  account_type: AccountType | null;
  is_admin: boolean;
  avatar: string | null;
  created_at: string | null;
  /** Selbst erstellte Events. */
  hosted_count: number;
  /** Events, denen die Person beigetreten ist. */
  joined_count: number;
  /** Aktuell gesperrt (Bann oder laufender Timeout)? */
  banned: boolean;
  /** true = dauerhafter Bann; false + banned = befristeter Timeout. */
  banned_permanent: boolean;
  /** Ende des Timeouts (ISO); null bei dauerhaftem Bann oder wenn nicht gesperrt. */
  banned_until: string | null;
  /** Grund der Sperre; null wenn nicht gesperrt. */
  ban_reason: string | null;
};

/**
 * Eine laufende Story in der Admin-Liste (GET /api/admin/stories).
 *
 * Anders als in der Story-Leiste stehen hier auch Storys gesperrter Konten –
 * genau die will man im Panel sehen. Abgelaufene fehlen: Sie sind für niemanden
 * mehr sichtbar.
 */
export type AdminStory = {
  id: number;
  caption: string | null;
  image_url: string | null;
  created_at: string | null;
  expires_at: string | null;
  /** Restzeit in Minuten – vom Server gerechnet (siehe `Story`). */
  expires_in_minutes: number;
  /** Wie viele die Story schon gesehen haben. */
  views: number;
  user: {
    id: number;
    name: string;
    username: string | null;
    account_type: AccountType | null;
    /** true = das Konto ist gerade gesperrt. */
    banned: boolean;
  };
};

/** Stand einer Anfrage auf eine höhere Kontostufe. */
export type UpgradeRequestStatus = 'pending' | 'approved' | 'rejected';

/** Eine Anfrage auf eine höhere Kontostufe (GET /api/me/upgrade-request). */
export type UpgradeRequest = {
  id: number;
  requested_type: AccountType;
  /**
   * Monats- oder Jahresabo – was die Person im Upgrade-Bildschirm gewählt hat.
   *
   * Steht an der Anfrage und nicht am Konto: Es ist der Wunsch zu diesem
   * Zeitpunkt und wird mit der nächsten Anfrage überschrieben. Was tatsächlich
   * läuft, weiß erst der Store (Tabelle `subscriptions`).
   */
  billing_period: BillingPeriod;
  status: UpgradeRequestStatus;
  /** Begründung der Person; null wenn keine angegeben wurde. */
  message: string | null;
  /** Grund der Ablehnung; null bei offenen und bestätigten Anfragen. */
  decision_note: string | null;
  created_at: string | null;
  decided_at: string | null;
};

/** Antwort von GET /api/me/upgrade-request. */
export type UpgradeRequestResponse = {
  /** Die eigene Anfrage; null, wenn noch keine gestellt wurde. */
  data: UpgradeRequest | null;
  /** Welche Stufen dieses Konto anfragen kann – leer auf der höchsten. */
  requestable: AccountType[];
};

/** Eine Anfrage in der Admin-Liste (GET /api/admin/upgrade-requests). */
export type AdminUpgradeRequest = UpgradeRequest & {
  user: {
    id: number;
    name: string;
    username: string | null;
    email: string;
    account_type: AccountType | null;
    avatar: string | null;
    /** Seit wann das Konto besteht (ISO) – Einordnung für die Entscheidung. */
    member_since: string | null;
  };
  /** Name des Admins, der entschieden hat; null bei offenen Anfragen. */
  admin_name: string | null;
};

/** Antwort von GET /api/admin/upgrade-requests. */
export type AdminUpgradeRequests = {
  /** Anzahl der offenen Anfragen – die Zahl, die im Panel auf Arbeit hinweist. */
  pending: number;
  data: AdminUpgradeRequest[];
};

/** Ein Bild-Upload (aus expo-image-picker) für multipart-Requests. */
export type ImageUpload = { uri: string; name: string; type: string };

/** Ein Beweismittel-Eintrag (GET /api/admin/evidence). */
export type AdminEvidence = {
  id: number;
  action: 'ban' | 'timeout';
  reason: string;
  /** Ende des Timeouts (ISO); null bei dauerhaftem Bann. */
  banned_until: string | null;
  /** URL des Beweis-Bildes; null wenn ohne Bild. */
  image_url: string | null;
  created_at: string | null;
  user: { id: number; name: string; username: string | null };
  /** Name des Admins, der die Sperre gesetzt hat; null wenn gelöscht. */
  admin_name: string | null;
  /** 'ai' = automatisch von der KI-Verifizierung gesetzt, 'admin' = von Hand. */
  source: 'admin' | 'ai';
};

/**
 * Ein Bericht der KI-Verifizierung (GET /api/admin/moderation).
 * Schwere: 0 unbedenklich · 1 grenzwertig · 2 nicht jugendfrei · 3 schwer.
 */
export type AdminModerationReport = {
  id: number;
  /** Was geprüft wurde – derzeit immer 'activity'. */
  context: string;
  verdict: 'ok' | 'auffaellig' | 'abgelehnt' | 'refusal' | 'error';
  severity: number;
  /** z. B. ['sexuell', 'nacktheit']. */
  categories: string[];
  /** Beanstandete Felder, z. B. ['titel', 'bild']. */
  fields: string[];
  reason: string | null;
  /** 'none' = durchgelassen, 'blocked' = abgelehnt, 'timeout' = abgelehnt + Sperre. */
  action: 'none' | 'blocked' | 'timeout';
  title: string | null;
  body: string | null;
  interests: string | null;
  /** Beanstandetes Bild; nur bei automatischer Sperre aufbewahrt. */
  image_url: string | null;
  model: string | null;
  latency_ms: number | null;
  created_at: string | null;
  /** null, wenn das Konto inzwischen gelöscht wurde. */
  user: { id: number; name: string; username: string | null } | null;
};

export type AdminModeration = {
  totals: { checked: number; blocked: number; timeouts: number; errors: number };
  data: AdminModerationReport[];
};

/** Kennzahlen eines Kontos (GET /api/me/progress) – Basis für Level & Abzeichen. */
export type ProgressStats = {
  hosted: number;
  joined: number;
  distinctInterests: number;
};

export type ProgressResponse = {
  stats: ProgressStats;
  xp: number;
  /**
   * Tage mit Aktivität als `YYYY-MM-DD`, neueste zuerst (letzte ~120 Tage).
   *
   * Die App wertet das NICHT mehr aus: Die Serie ist der Prämien-Funktion
   * gewichen (siehe `src/domain/rewards.ts`). Der Server zählt die Tage weiter –
   * das kostet nichts und die Daten wären nach einer Löschung nicht
   * wiederherstellbar. Das Feld steht hier, damit klar ist, dass die Antwort es
   * enthält und niemand es für einen Fehler hält.
   */
  activeDates?: string[];
};

/** Punktestand der Prämien (GET /api/me/rewards). */
export type RewardTotals = {
  /** Alles, was je gutgeschrieben wurde. */
  earned: number;
  /** Summe der eingelösten Coupons. */
  spent: number;
  /** Was übrig ist – nie negativ. */
  balance: number;
};

/** Ein eingelöster Coupon mit seinem Code. */
export type Redemption = {
  id: number;
  coupon_slug: string;
  /** Titel aus dem Katalog des Servers – auch für abgekündigte Coupons gefüllt. */
  title: string;
  /** Wird beim Partner vorgezeigt. */
  code: string;
  points: number;
  created_at: string | null;
};

/**
 * Antwort von GET /api/me/rewards.
 *
 * `coupons` kommt bewusst mit, obwohl die App den Katalog auch selbst kennt
 * (`src/domain/rewards.ts`): Der Server entscheidet über den Preis, also soll die
 * App den Preis zeigen, gegen den geprüft wird.
 */
export type RewardsResponse = {
  points: RewardTotals;
  pointsPerActivity: number;
  coupons: { slug: string; title: string; description: string; cost: number; icon: string }[];
  redemptions: Redemption[];
};

/** Eine Story (GET /api/stories). Läuft 24 Stunden nach dem Anlegen ab. */
export type Story = {
  id: number;
  caption: string | null;
  image_url: string | null;
  created_at: string | null;
  expires_at: string | null;
  /**
   * Restzeit in Minuten, gerechnet vom Server.
   *
   * Bewusst eine Dauer und kein Vergleich gegen `expires_at`: Die Zeitstempel der
   * Datenbank tragen ein „Z", sind aber nicht durchgängig UTC – die App käme damit
   * um den Zonen-Versatz daneben (siehe server/src/routes/stories.js). Ältere
   * Server liefern das Feld nicht; dann steht keine Restzeit da.
   */
  expires_in_minutes?: number | null;
  /** Schon angesehen? Steuert Ring-Farbe und Reihenfolge. */
  seen: boolean;
  is_mine: boolean;
  user: {
    id: number;
    name: string;
    username: string | null;
    avatar: string | null;
    account_type: AccountType | null;
  };
};

export type StoriesResponse = {
  data: Story[];
  /** true = dieses Konto darf selbst Storys anlegen (ab Creator). */
  can_publish: boolean;
};

/**
 * Beziehung zu einer anderen Person – aus SICHT der:des Aufrufenden.
 *
 * `incoming` heißt „die andere Person hat angefragt", `outgoing` „ich habe
 * angefragt". Die Unterscheidung entscheidet, ob der Knopf „Annehmen" oder
 * „Angefragt" heißt, deshalb ist sie kein `boolean`.
 */
export type FriendshipState = 'none' | 'friends' | 'incoming' | 'outgoing';

/**
 * Was hinter einem Profilbild an Storys liegt – der Ring darum.
 *
 * Bewusst nur Anzahl und „ungesehen" und nicht die Storys selbst: Eine
 * Freundesliste mit 40 Namen würde sonst 40 Bilder mitschleppen, von denen man
 * höchstens eins ansieht. Die Storys holt `api.userStories` beim Antippen nach.
 */
export type StoryMeta = {
  /** Wie viele laufen – so viele Bögen bekommt der Ring. */
  count: number;
  /** true = mindestens eine ist neu. Färbt den Ring (Verlauf statt Kontur). */
  unseen: boolean;
};

/** Eine Person, wie sie in Suche, Freundesliste und Gruppen erscheint. */
export type PersonCard = {
  id: number;
  name: string;
  username: string | null;
  avatar: string | null;
  account_type: AccountType | null;
  /** Nur in der Suche gefüllt. */
  friendship?: FriendshipState;
  /** Nur in den Freundeslisten gefüllt: seit wann bzw. seit wann angefragt. */
  since?: string | null;
  /**
   * Laufende Storys dieser Person; `null`/fehlend = keine.
   *
   * Fehlend UND `null` heißen dasselbe („kein Ring"), weil ältere Server das Feld
   * gar nicht schicken – die Liste zeichnet dann schlicht keinen Ring, statt
   * einen zu zeigen, hinter dem nichts ist.
   */
  story?: StoryMeta | null;
};

export type FriendsResponse = {
  friends: PersonCard[];
  /** Anfragen an mich – die kann ich annehmen. */
  incoming: PersonCard[];
  /** Meine Anfragen, auf die noch niemand geantwortet hat. */
  outgoing: PersonCard[];
};

/** Eine Gruppe im Freunde-Bereich. */
export type FriendGroup = {
  id: number;
  name: string;
  description: string | null;
  created_at: string | null;
  /** true = ich habe sie angelegt und darf Leute aufnehmen/entfernen. */
  is_owner: boolean;
  /** Die:der Besitzer:in steht zuerst. */
  members: PersonCard[];
  /**
   * Ungelesene Nachrichten im Gruppen-Chat.
   *
   * Kommt mit der Gruppenliste, damit der Freunde-Screen den Punkt am Eintrag
   * zeigen kann, ohne zusätzlich die Chat-Übersicht zu laden. Ältere Server
   * liefern das Feld nicht.
   */
  unread?: number;
};

/**
 * Die zwei Orte, an denen in dieser App geredet wird: in einer Gruppe und bei
 * einem Event. Beide benutzen denselben Chat (siehe server/src/messaging.js).
 */
export type ChatKind = 'group' | 'activity';

/** Ein in den Chat geteiltes Event. */
export type ChatShare = {
  /**
   * null, wenn das Event inzwischen gelöscht wurde. Der Titel bleibt trotzdem
   * stehen (Schnappschuss) – sonst hinge im Verlauf eine leere Karte.
   */
  activity_id: number | null;
  title: string;
  location: string | null;
  starts_at: string | null;
  banner_url: string | null;
};

export type ChatMessage = {
  id: number;
  /** Leer, wenn die Nachricht nur ein geteiltes Event ist. */
  body: string;
  created_at: string | null;
  is_mine: boolean;
  user: {
    id: number;
    name: string;
    username: string | null;
    avatar: string | null;
    account_type: AccountType | null;
  };
  shared: ChatShare | null;
};

/** Kopfdaten des Raums – kommen mit dem Verlauf, damit der Screen nicht rät. */
export type ChatRoomMeta = {
  kind: ChatKind;
  ref_id: number;
  title: string;
  /** true = ich darf hier auch fremde Nachrichten entfernen (Gruppe/Event verantwortet). */
  can_moderate: boolean;
};

export type ChatMessagesResponse = {
  data: ChatMessage[];
  room: ChatRoomMeta;
};

/** Ein Eintrag in der Chat-Übersicht (GET /api/chats). */
export type ChatOverviewEntry = {
  kind: ChatKind;
  /** ID der Gruppe bzw. des Events – nicht die des Raums. */
  ref_id: number;
  title: string;
  members: number;
  /** Nur bei Event-Chats gefüllt. */
  starts_at: string | null;
  /** null, wenn noch nie etwas geschrieben wurde. */
  last_message: { preview: string; author: string; created_at: string | null } | null;
  unread: number;
};

/** Ein blockiertes Konto (GET /api/blocks). */
export type BlockedPerson = PersonCard & { since?: string | null };

/** Was gemeldet werden kann – Schlüssel wie in server/src/reports.js (the one list: src/domain/report-reason.ts). */
export type { ReportTarget };

/** Eine Meldung in der Admin-Liste (GET /api/admin/reports). */
export type AdminReport = {
  id: number;
  target_type: ReportTarget;
  target_id: number;
  reason: string;
  note: string | null;
  status: 'open' | 'reviewed' | 'dismissed';
  created_at: string | null;
  handled_at: string | null;
  /** Name des Admins, der entschieden hat; null bei offenen Meldungen. */
  admin_name: string | null;
  /** null, wenn das meldende Konto inzwischen gelöscht wurde. */
  reporter: { name: string; username: string | null } | null;
  /** null, wenn der gemeldete Inhalt nicht mehr existiert. */
  target: {
    label: string;
    author: string | null;
    detail: string | null;
    image_url: string | null;
    /** For a comment: the event or post it stands under; null for everything else. */
    context_id: number | null;
  } | null;
};

export type AdminReportsResponse = {
  /** Anzahl der offenen Meldungen – die Zahl, die im Panel auf Arbeit hinweist. */
  open: number;
  data: AdminReport[];
};

/** Ein Platz im Leaderboard (GET /api/leaderboard). */
export type LeaderboardEntry = {
  rank: number;
  xp: number;
  stats: ProgressStats;
  user: { id: number; name: string; username: string | null; avatar: string | null };
};

export type LeaderboardResponse = {
  data: LeaderboardEntry[];
  /** Eigene Position – auch dann, wenn man nicht in der Top-Liste steht. */
  me: LeaderboardEntry;
};

/** Ein Beitrag auf der Profilseite („Community Post"). */
export type ProfilePost = {
  id: number;
  body: string;
  image_url: string | null;
  created_at: string | null;
  /** Wann zuletzt bearbeitet. Ältere Server liefern das Feld nicht. */
  updated_at?: string | null;
  /** true = die Beschreibung wurde nach dem Veröffentlichen geändert. */
  edited?: boolean;
  likes_count?: number;
  comments_count?: number;
  /** Habe ich das schon geliked? Trägt den Zustand des Herzens. */
  liked_by_me?: boolean;
};

/** Ein Kommentar unter einem Beitrag. */
export type PostComment = {
  id: number;
  body: string;
  created_at: string | null;
  /**
   * Darf ich den löschen? Entscheidet der Server – eigener Kommentar, eigener
   * Beitrag oder Admin. Die App zeigt den Papierkorb nur danach und rät nicht
   * selbst, sonst laufen zwei Regeln auseinander.
   */
  can_delete: boolean;
  user: PersonCard;
};

/**
 * Ein Social-Link. `platform` ist ein Schlüssel aus `src/domain/social-links.ts`
 * – bewusst als String getypt, damit eine neuere Server-Version mit einer
 * zusätzlichen Plattform die App nicht zum Absturz bringt.
 */
export type ProfileLink = { platform: string; url: string };

/**
 * Öffentliches Profil (GET /api/users/:username).
 *
 * Gibt es nur ab der Stufe Creator – für alle anderen antwortet der Server mit
 * 404, so wie für einen unbekannten Namen.
 */
export type PublicProfile = {
  user: {
    id: number;
    name: string;
    username: string | null;
    avatar: string | null;
    /** Bild hinter der Profil-Karte (weichgezeichnet); ältere Server: undefiniert. */
    banner?: string | null;
    account_type: AccountType | null;
    /**
     * Only on the own profile (`is_me`); on anyone else's the server leaves it out (F-05).
     * Admin rights of the signed-in account come from its own record (`User.is_admin`).
     */
    is_admin?: boolean;
    created_at: string | null;
  };
  links: ProfileLink[];
  posts: ProfilePost[];
  /**
   * Laufende Storys dieser Person – der Ring um ihr Profilbild, und was ein Tipp
   * darauf öffnet.
   *
   * Kommt mit dem Profil und nicht aus einem zweiten Aufruf: Der Ring muss beim
   * ersten Bild der Seite richtig aussehen, sonst erscheint er nachträglich und
   * die Karte zuckt. Ältere Server schicken das Feld nicht – dann gibt es keinen
   * Ring, was schlechter als die Wahrheit, aber besser als ein leerer Betrachter ist.
   */
  stories?: Story[];
  /**
   * `followers`/`following` liefern ältere Server nicht – deshalb optional.
   * Die Anzeige rechnet dann mit 0 statt eine Lücke zu zeigen.
   */
  stats: {
    hosted: number;
    joined: number;
    posts: number;
    followers?: number;
    following?: number;
  };
  /** Folge ich dieser Person? Trägt den Folgen-Knopf. */
  is_following?: boolean;
  /** Folgt sie mir? Nur eine Beschriftung – daran hängt kein Recht. */
  follows_me?: boolean;
  /**
   * false = Visitenkarte ohne Beiträge und Social-Links (Stufe Standard).
   *
   * Seit die Nutzersuche im Freunde-Bereich zu Profilen führt, hat JEDES Konto
   * mit Benutzernamen eine Seite – ein 404 wäre dort eine Sackgasse. Was die
   * Stufe entscheidet, ist der Inhalt. Ältere Server liefern das Feld nicht;
   * deshalb optional.
   */
  shows_posts?: boolean;
  /** Beziehung zur:zum Aufrufer:in – für „Freund:in hinzufügen" auf dem Profil. */
  friendship?: FriendshipState;
  /** true, wenn das das eigene Profil ist (dann darf man schreiben). */
  is_me: boolean;
};

/**
 * Sorten von Benachrichtigungen.
 *
 * Bewusst als String-Union UND mit Rückfall im Symbol-Mapping: Ein neuerer
 * Server darf eine Sorte mehr schicken, ohne dass die Liste hier leer bleibt.
 */
export type NotificationType = 'story' | 'activity' | 'post' | 'like' | 'comment' | 'follow' | 'activity_comment';

/** Eine Benachrichtigung (GET /api/notifications). */
export type AppNotification = {
  id: number;
  type: NotificationType;
  /**
   * Wohin der Tipp führt – je nach `type` eine Story-, Event-, Beitrags- oder
   * Konto-ID. Ohne Fremdschlüssel am Server: Das Ziel kann weg sein, während die
   * Meldung bleibt.
   */
  ref_id: number | null;
  title: string;
  body: string | null;
  read: boolean;
  created_at: string | null;
  /** Wer es ausgelöst hat. `null`, wenn das Konto inzwischen weg ist. */
  actor: PersonCard | null;
};

export type NotificationsResponse = {
  data: AppNotification[];
  /** Ungelesene INSGESAMT – nicht nur die auf dieser Seite. */
  unread: number;
};

/** Ein Monatspunkt in den Business-Reihen ('2026-07' + Anzahl). */
export type BusinessMonthPoint = { month: string; count: number };

/** Ein eigenes Event mit seinen Zahlen (GET /api/business/insights). */
export type BusinessEvent = {
  id: number;
  title: string;
  starts_at: string | null;
  /** Bis wann hervorgehoben; null = normal. */
  boosted_until: string | null;
  max_participants: number | null;
  /** Von wie vielen Leuten angesehen. */
  views: number;
  /** Teilnahmen ohne den eigenen Auto-Beitritt. */
  bookings: number;
};

/**
 * Zahlen des Business-Bereichs (GET /api/business/insights).
 *
 * `revenue.available` ist derzeit immer false: Die App hat keine Bezahl-Events,
 * also gibt es keinen Umsatz zu zeigen. Der Server sagt im `reason`, woran es
 * liegt – die App gibt das weiter, statt eine Zahl zu erfinden.
 */
export type BusinessInsights = {
  account_type: AccountType | null;
  /** Über wie viele Monate die Reihen zurückblicken (je Stufe). */
  months: number;
  revenue: { available: boolean; currency: string; gross_cents: number; reason: string };
  bookings: { total: number; series: BusinessMonthPoint[] };
  reach: { events: number; views: number; visitors: number; series: BusinessMonthPoint[] };
  /** Hervorheben: wie viele Plätze die Stufe hat, wie viele belegt sind, wie lange es läuft. */
  boost: { slots: number; used: number; days: number };
  events: BusinessEvent[];
};

/** Antwort der Hervorheben-Endpunkte. */
export type BoostResult = { id: number; boosted_until: string | null };

export type AuthResult = {
  user: User;
  token: string;
  profile_complete: boolean;
};

/** Antwort auf /login: entweder angemeldet, oder es fehlt noch der zweite Faktor. */
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
  account_type: AccountType;
  /** IDs der ausgewählten Interessen. */
  interests?: number[];
  /**
   * Stand der Nutzungsbedingungen, dem zugestimmt wurde (`LEGAL_VERSION` aus
   * `src/domain/legal.ts`).
   *
   * Die Version und nicht bloß ein `true`: Nur damit lässt sich nach einer
   * Änderung erkennen, wer noch dem alten Text zugestimmt hat. Der Server
   * schreibt sie mit dem Zeitpunkt ins Konto.
   *
   * Required (F-14): the server refuses a sign-up without the current version.
   */
  terms_version: string;
  /** The minimum age the person confirmed (`MIN_AGE`); required, see `registrationConsent()`. */
  confirmed_min_age: number;
};

/**
 * Fehler von der API. `errors` enthält bei 422 die Feld-Fehler von Laravel,
 * z. B. { email: ["Diese E-Mail ist bereits registriert."] }.
 */
/** Details einer Konto-Sperre (kommt bei 403 vom Login). */
export type BanInfo = {
  reason: string | null;
  permanent: boolean;
  /** Ende des Timeouts (ISO); null bei dauerhaftem Bann. */
  banned_until: string | null;
};

export class ApiError extends Error {
  status: number;
  errors: Record<string, string[]>;
  /** Kompletter JSON-Body der Fehlerantwort (z. B. für Sperr-Details `body.ban`). */
  body: { ban?: BanInfo; [key: string]: unknown } | null;

  constructor(
    message: string,
    status: number,
    errors: Record<string, string[]> = {},
    body: Record<string, unknown> | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.errors = errors;
    this.body = body;
  }

  /** Erste Fehlermeldung – praktisch für eine einfache Anzeige. */
  firstError(): string {
    const first = Object.values(this.errors)[0]?.[0];
    return first ?? this.message;
  }
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  token?: string | null;
};

/**
 * Lokales Datum des Geräts als `YYYY-MM-DD`.
 *
 * Geht als Query-Parameter an `/me/progress`, damit die Serie („Streak") in der
 * Zeitzone der Nutzer:in gezählt wird. Ohne diesen Hinweis müsste der Server
 * sein eigenes UTC-Datum nehmen – wer um 00:30 Uhr etwas macht, bekäme den Tag
 * dann noch auf gestern gebucht und verlöre seine Serie „grundlos".
 *
 * Bewusst als Parameter und NICHT als eigener Header: Ein Custom-Header macht
 * aus jeder einfachen GET-Anfrage eine mit CORS-Vorabfrage – im Browser wäre
 * damit auf einen Schlag jeder Aufruf auf die Antwort auf ein OPTIONS
 * angewiesen, das dieses Backend nicht beantwortet.
 */
function localDate(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * Edit the profile. The e-mail address is not part of it: it changes only with the password (and
 * the code with two-factor sign-in) through `api.changeEmail`.
 */
export type UpdateProfileInput = {
  name?: string;
  username?: string;
  /** Kontotyp umstellen – serverseitig nur für Admins erlaubt (sonst 403). */
  account_type?: AccountType;
  /** Vollständige neue Interessen-Liste (IDs); ersetzt die bisherigen. */
  interests?: number[];
};

/**
 * Every answer to an authenticated request is reported here (F-20): a 401 means the server no
 * longer accepts the session (expired, or signed out by a password, e-mail or two-factor change
 * elsewhere), and the auth state signs out on this device (src/lib/auth-context.tsx). Logic and
 * tests: src/domain/session.ts.
 */
export const sessionWatch = createSessionWatch();

/**
 * Reads an answer: reports its status with the token the request carried, parses JSON, and
 * throws an ApiError with the full body (bans and moderation put their details there) when the
 * request failed. Every fetch site of this file goes through here.
 */
async function parseResponse<T>(response: Response, token: string | null | undefined): Promise<T> {
  sessionWatch.report(response.status, token);

  const isJson = response.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await response.json() : null;

  if (!response.ok) {
    throw new ApiError(
      data?.message ?? 'Etwas ist schiefgelaufen.',
      response.status,
      data?.errors ?? {},
      data ?? null,
    );
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
    throw new ApiError('Keine Verbindung zum Server. Läuft das Backend und stimmt die Adresse?', 0);
  }

  return parseResponse<T>(response, token);
}

/**
 * POST als multipart/form-data mit fertigem `FormData`.
 *
 * Wie `request`, nur ohne JSON-Body: Den Content-Type samt Boundary setzt
 * `fetch` selbst – wer ihn von Hand setzt, zerlegt den Upload. Der komplette
 * Fehler-Body geht mit in den `ApiError`, weil bei einer automatischen Sperre
 * die Details in `body.ban` stecken.
 */
async function upload<T>(token: string, path: string, form: FormData): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      body: form,
    });
  } catch {
    throw new ApiError('Keine Verbindung zum Server. Läuft das Backend und stimmt die Adresse?', 0);
  }

  return parseResponse<T>(response, token);
}

/**
 * POST als multipart/form-data mit optionalem Bild – für Moderations-Aktionen
 * mit Beweis (fetch setzt den Content-Type inkl. Boundary selbst).
 */
async function moderationUpload(
  token: string,
  path: string,
  fields: Record<string, string>,
  image?: ImageUpload | null,
): Promise<{ message: string }> {
  const form = new FormData();
  Object.entries(fields).forEach(([key, value]) => form.append(key, value));
  if (image) form.append('evidence', image as unknown as Blob);

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      body: form,
    });
  } catch {
    throw new ApiError('Keine Verbindung zum Server. Läuft das Backend und stimmt die Adresse?', 0);
  }

  return parseResponse<{ message: string }>(response, token);
}

export const api = {
  register: (input: RegisterInput) =>
    request<AuthResult>('/register', { method: 'POST', body: { ...input, device_name: 'app' } }),

  login: (email: string, password: string) =>
    request<LoginResult>('/login', { method: 'POST', body: { email, password, device_name: 'app' } }),

  /* ------------------------------------------------------------ Sicherheit */

  /** Zweiter Anmeldeschritt: Code (oder Wiederherstellungscode) zum Beleg. */
  loginTwoFactor: (challenge: string, code: string) =>
    request<AuthResult>('/login/two-factor', {
      method: 'POST',
      body: { challenge, code, device_name: 'app' },
    }),

  /** Neuen E-Mail-Code für denselben Anmeldeversuch (höchstens einmal pro Minute). */
  resendTwoFactor: (challenge: string) =>
    request<{ message: string; expires_in: number }>('/login/two-factor/resend', {
      method: 'POST',
      body: { challenge },
    }),

  /** 2FA per E-Mail einrichten, Schritt 1: mit dem Passwort bestätigen, Code an die Konto-Adresse. */
  twoFactorEmailStart: (token: string, password: string) =>
    request<{ message: string; destination: string; expires_in: number; challenge: string }>(
      '/user/two-factor/email',
      { method: 'POST', body: { password }, token },
    ),

  /** 2FA per E-Mail einrichten, Schritt 2: Code bestätigen – danach ist sie an. */
  twoFactorEmailConfirm: (token: string, challenge: string, code: string) =>
    request<{ user: User; recovery_codes: string[] }>('/user/two-factor/email/confirm', {
      method: 'POST',
      body: { challenge, code },
      token,
    }),

  /** Authenticator-App einrichten, Schritt 1: mit dem Passwort bestätigen, Geheimnis + otpauth-Link holen. */
  twoFactorTotpStart: (token: string, password: string) =>
    request<{ secret: string; otpauth_url: string }>('/user/two-factor/totp', {
      method: 'POST',
      body: { password },
      token,
    }),

  /** Authenticator-App einrichten, Schritt 2: ersten Code bestätigen. */
  twoFactorTotpConfirm: (token: string, code: string) =>
    request<{ user: User; recovery_codes: string[] }>('/user/two-factor/totp/confirm', {
      method: 'POST',
      body: { code },
      token,
    }),

  /**
   * Bei E-Mail-2FA: einen frischen Code schicken lassen – für Ausschalten, neue
   * Wiederherstellungscodes und Konto löschen. (Bei der Authenticator-App steht
   * der Code ohnehin in der App.) Höchstens einmal pro Minute.
   */
  twoFactorSendCode: (token: string) =>
    request<{ message: string; destination: string; expires_in: number }>('/user/two-factor/code', {
      method: 'POST',
      token,
    }),

  /** 2FA abschalten – mit Passwort und aktuellem Code bestätigt. Meldet andere Geräte ab. */
  twoFactorDisable: (token: string, proof: SecondFactorProof) =>
    request<{ user: User }>('/user/two-factor', { method: 'DELETE', body: proof, token }),

  /** Neue Wiederherstellungscodes – die alten werden damit ungültig. */
  twoFactorRecoveryCodes: (token: string, proof: SecondFactorProof) =>
    request<{ recovery_codes: string[] }>('/user/two-factor/recovery-codes', {
      method: 'POST',
      body: proof,
      token,
    }),

  /**
   * Change the e-mail address (signed in): with the current password, and with two-factor sign-in
   * also a current code. Signs out every other device; a notice goes to the previous address.
   */
  changeEmail: (token: string, input: { email: string; current_password: string; code?: string }) =>
    request<{ user: User; profile_complete: boolean }>('/user/email', { method: 'PUT', body: input, token }),

  /** Passwort ändern (angemeldet). Meldet alle anderen Geräte ab. */
  changePassword: (token: string, currentPassword: string, password: string) =>
    request<{ message: string }>('/user/password', {
      method: 'PUT',
      body: { current_password: currentPassword, password },
      token,
    }),

  /**
   * Eigenes Konto endgültig löschen. `password` (bzw. bei Konten ohne Passwort
   * `confirm: 'LÖSCHEN'`), bei aktiver 2FA zusätzlich `code`.
   */
  deleteAccount: (token: string, input: { password?: string; confirm?: string; code?: string }) =>
    request<{ message: string }>('/me', { method: 'DELETE', body: input, token }),

  logout: (token: string) => request<{ message: string }>('/logout', { method: 'POST', token }),

  me: (token: string) => request<{ user: User; profile_complete: boolean }>('/user', { token }),

  /** Profil bearbeiten (Name/Benutzername/Kontotyp). Nur gesetzte Felder werden geändert. */
  updateProfile: (token: string, input: UpdateProfileInput) =>
    request<{ user: User; profile_complete: boolean }>('/user', {
      method: 'PATCH',
      body: input,
      token,
    }),

  /**
   * Fordert eine „Passwort vergessen"-Mail an. It carries a 6-digit code, no link (F-09).
   * Antwortet immer neutral (die API verrät nicht, ob die Adresse registriert ist) – ein 422
   * kommt nur bei einer ungültigen E-Mail-Eingabe. Also the way to get a new code; the server
   * sends at most one mail a minute per account.
   */
  forgotPassword: (email: string) =>
    request<{ status: string; message: string }>('/forgot-password', {
      method: 'POST',
      body: { email },
    }),

  /**
   * Sets a new password with the code from the "Passwort vergessen" mail (signed out). Signs out
   * every device. A wrong, expired or used code and an unknown address get the same 422 on `code`.
   */
  resetPassword: (input: { email: string; code: string; password: string; password_confirmation: string }) =>
    request<{ status: string; message: string }>('/reset-password', {
      method: 'POST',
      body: input,
    }),

  interests: () => request<{ data: Interest[] }>('/interests'),

  activities: (token: string) => request<{ data: Activity[] }>('/activities', { token }),

  /**
   * Ein einzelnes Event.
   *
   * Gebraucht, seit Events in Chats geteilt werden: Die Nachricht trägt nur einen
   * Schnappschuss (Titel, Ort, Zeit). Wer die Karte antippt, will das vollständige
   * Event mit Teilnehmerzahl und Beitreten-Knopf – und das steht nur hier.
   */
  activity: (token: string, id: number) =>
    request<{ data: Activity }>(`/activities/${id}`, { token }),

  /** Persönlicher Verlauf: erstellte + beigetretene Events (inkl. gelöschter, bis 7 Tage). */
  history: (token: string) =>
    request<{ data: ActivityHistoryEntry[] }>('/activities/history', { token }),

  /** Löscht ein Event. Admins jedes, sonst nur die eigenen (Backend prüft, sonst 403). */
  deleteActivity: (token: string, id: number) =>
    request<{ message: string }>(`/activities/${id}`, { method: 'DELETE', token }),

  /** Tritt einem Event bei (idempotent). Liefert die aktualisierte Activity. */
  joinActivity: (token: string, id: number) =>
    request<{ data: Activity }>(`/activities/${id}/join`, { method: 'POST', token }),

  /** Verlässt ein Event wieder. Liefert die aktualisierte Activity. */
  leaveActivity: (token: string, id: number) =>
    request<{ data: Activity }>(`/activities/${id}/join`, { method: 'DELETE', token }),

  /**
   * Gefällt mir – setzen bzw. zurücknehmen. Beide Richtungen antworten mit der
   * vollständigen Aktivität samt neuer Zahl, damit die App nicht selbst zählt.
   */
  likeActivity: (token: string, id: number) =>
    request<{ data: Activity }>(`/activities/${id}/like`, { method: 'POST', token }),

  unlikeActivity: (token: string, id: number) =>
    request<{ data: Activity }>(`/activities/${id}/like`, { method: 'DELETE', token }),

  /** Kommentare einer Aktivität – älteste zuerst. */
  activityComments: (token: string, id: number) =>
    request<{ data: ActivityComment[] }>(`/activities/${id}/comments`, { token }),

  /** Kommentieren. Läuft durch Wortfilter und KI-Prüfung wie Beitrags-Kommentare. */
  addActivityComment: (token: string, id: number, body: string) =>
    request<{ data: ActivityComment; activity: Activity }>(`/activities/${id}/comments`, {
      method: 'POST',
      body: { body },
      token,
    }),

  /** Kommentar löschen – eigener, jeder unter der eigenen Aktivität, oder als Admin. */
  deleteActivityComment: (token: string, activityId: number, commentId: number) =>
    request<{ message: string; activity: Activity }>(
      `/activities/${activityId}/comments/${commentId}`,
      { method: 'DELETE', token },
    ),

  /**
   * Zählt einen Aufruf des Detail-Popups (pro Person nur einmal, eigene Events
   * zählen nicht). Liefert den neuen Stand zurück.
   */
  viewActivity: (token: string, id: number) =>
    request<{ views_count: number }>(`/activities/${id}/view`, { method: 'POST', token }),

  /**
   * Eigene Kennzahlen + XP + aktive Tage (Level, Abzeichen und Serie rechnet
   * die App daraus selbst). Der Aufruf markiert den heutigen Tag zugleich als
   * aktiv – deshalb geht das lokale Datum mit.
   */
  progress: (token: string) =>
    request<ProgressResponse>(`/me/progress?day=${localDate()}`, { token }),

  /** Rangliste nach XP inklusive eigener Position. */
  leaderboard: (token: string) => request<LeaderboardResponse>('/leaderboard', { token }),

  /**
   * Prämien: Punktestand, Katalog und die eigenen Coupons.
   *
   * Der Aufruf trägt zugleich Punkte für Events nach, die vor dem Punktesystem
   * entstanden sind (server/src/rewards.js) – deshalb ist er idempotent, aber
   * nicht ganz ohne Nebenwirkung.
   */
  rewards: (token: string) => request<RewardsResponse>('/me/rewards', { token }),

  /**
   * Coupon einlösen. 422, wenn das Guthaben nicht reicht – die Meldung nennt die
   * fehlenden Punkte.
   */
  redeemCoupon: (token: string, coupon: string) =>
    request<{ data: Redemption; points: RewardTotals }>('/me/rewards/redeem', {
      method: 'POST',
      body: { coupon },
      token,
    }),

  /** Laufende Storys, ungesehene zuerst. */
  stories: (token: string) => request<StoriesResponse>('/stories', { token }),

  /**
   * Die laufenden Storys EINER Person, älteste zuerst.
   *
   * Für den Tipp auf ein Profilbild in einer Liste: Dort steht nur, DASS etwas
   * läuft (`PersonCard.story`) – die Bilder holt dieser Aufruf beim Antippen
   * nach, statt sie in jeder Liste mitzuschleppen.
   *
   * Eine leere Liste ist kein Fehler: Zwischen dem Laden der Liste und dem Tipp
   * kann eine Story ablaufen.
   */
  userStories: (token: string, userId: number) =>
    request<{ data: Story[] }>(`/users/${userId}/stories`, { token }),

  /** Story anlegen (ab Creator; multipart wegen Bild). */
  createStory: (token: string, image: ImageUpload, caption: string) => {
    const form = new FormData();
    form.append('image', image as unknown as Blob);
    if (caption) form.append('caption', caption);
    return upload<{ data: Story }>(token, '/stories', form);
  },

  /** Story als gesehen merken (idempotent). */
  viewStory: (token: string, id: number) =>
    request<{ message: string }>(`/stories/${id}/view`, { method: 'POST', token }),

  /** Eigene Story löschen (Admins jede). */
  deleteStory: (token: string, id: number) =>
    request<{ message: string }>(`/stories/${id}`, { method: 'DELETE', token }),

  /**
   * Leute suchen (Name oder Benutzername). Unter zwei Zeichen antwortet der
   * Server mit einer leeren Liste – eine Suche ohne Suchwort wäre ein
   * Verzeichnis aller Konten.
   */
  searchUsers: (token: string, query: string) =>
    request<{ data: PersonCard[] }>(`/users?q=${encodeURIComponent(query)}`, { token }),

  /** Freunde, eingehende und offene Anfragen. */
  friends: (token: string) => request<FriendsResponse>('/friends', { token }),

  /**
   * Anfragen – oder eine offene Anfrage annehmen. Beides derselbe Aufruf: Aus
   * Sicht der App ist es dieselbe Absicht (siehe server/src/routes/friends.js).
   */
  addFriend: (token: string, userId: number) =>
    request<{ status: FriendshipState; user: PersonCard }>('/friends', {
      method: 'POST',
      body: { user_id: userId },
      token,
    }),

  /** Freundschaft beenden, Anfrage zurücknehmen oder ablehnen. */
  removeFriend: (token: string, userId: number) =>
    request<{ message: string }>(`/friends/${userId}`, { method: 'DELETE', token }),

  /** Eigene Gruppen und die, in denen man Mitglied ist. */
  groups: (token: string) => request<{ data: FriendGroup[] }>('/groups', { token }),

  /** Gruppe anlegen. `members` nimmt nur bestätigte Freunde auf. */
  createGroup: (token: string, name: string, description: string, members: number[]) =>
    request<{ data: FriendGroup }>('/groups', {
      method: 'POST',
      body: { name, description, members },
      token,
    }),

  /** Freund:in in eine eigene Gruppe aufnehmen. */
  addGroupMember: (token: string, groupId: number, userId: number) =>
    request<{ data: FriendGroup }>(`/groups/${groupId}/members`, {
      method: 'POST',
      body: { user_id: userId },
      token,
    }),

  /** Jemanden entfernen – oder selbst gehen (dieselbe ID wie die eigene). */
  removeGroupMember: (token: string, groupId: number, userId: number) =>
    request<{ data?: FriendGroup; message?: string }>(`/groups/${groupId}/members/${userId}`, {
      method: 'DELETE',
      token,
    }),

  /** Eigene Gruppe löschen. */
  deleteGroup: (token: string, groupId: number) =>
    request<{ message: string }>(`/groups/${groupId}`, { method: 'DELETE', token }),

  /** Gruppe umbenennen (nur als Anlegende:r). Nur gesetzte Felder ändern sich. */
  updateGroup: (token: string, groupId: number, input: { name?: string; description?: string }) =>
    request<{ data: FriendGroup }>(`/groups/${groupId}`, {
      method: 'PATCH',
      body: input,
      token,
    }),

  /* -------------------------------------------------------------------- Chats */

  /**
   * Alle Chats: Gruppen und laufende Events, mit letzter Nachricht und
   * Ungelesenen. Enthält auch Chats, in denen noch nie etwas geschrieben wurde –
   * genau die sind die Einladung, anzufangen.
   */
  chats: (token: string) => request<{ data: ChatOverviewEntry[] }>('/chats', { token }),

  /**
   * Verlauf eines Chats.
   *
   * `after` holt nur, was nach dieser ID kam – so fragt der Screen im Takt nach
   * neuen Nachrichten, ohne jedes Mal den ganzen Verlauf zu laden. `before` holt
   * die ältere Seite. Ohne beides kommen die neuesten Nachrichten.
   */
  chatMessages: (
    token: string,
    kind: ChatKind,
    refId: number,
    options: { after?: number; before?: number; limit?: number } = {},
  ) => {
    const query = new URLSearchParams();
    if (options.after) query.set('after', String(options.after));
    if (options.before) query.set('before', String(options.before));
    if (options.limit) query.set('limit', String(options.limit));
    const suffix = query.toString() ? `?${query}` : '';
    return request<ChatMessagesResponse>(`/chats/${kind}/${refId}/messages${suffix}`, { token });
  },

  /**
   * Nachricht senden: Text, ein geteiltes Event oder beides.
   *
   * `activityId` allein ist der Fall aus dem Teilen-Blatt – dann ist die
   * Event-Karte die Nachricht und es braucht keinen Kommentar dazu.
   */
  sendChatMessage: (
    token: string,
    kind: ChatKind,
    refId: number,
    input: { body?: string; activityId?: number },
  ) =>
    request<{ data: ChatMessage }>(`/chats/${kind}/${refId}/messages`, {
      method: 'POST',
      body: { body: input.body ?? '', activity_id: input.activityId },
      token,
    }),

  /**
   * Lesestand setzen. Ohne `messageId` gilt alles als gelesen.
   *
   * Der Stand läuft serverseitig nie zurück – zwei Geräte, die verschieden weit
   * gelesen haben, setzen sich damit nicht gegenseitig zurück.
   */
  markChatRead: (token: string, kind: ChatKind, refId: number, messageId?: number) =>
    request<{ unread: number }>(`/chats/${kind}/${refId}/read`, {
      method: 'POST',
      body: { message_id: messageId ?? 0 },
      token,
    }),

  /** Eigene Nachricht löschen – oder jede, wenn man Gruppe/Event verantwortet. */
  deleteChatMessage: (token: string, messageId: number) =>
    request<{ message: string }>(`/chats/messages/${messageId}`, { method: 'DELETE', token }),

  /* --------------------------------------------------------- Melden & Sperren */

  /**
   * Etwas melden. Löscht nichts und sperrt niemanden – es ist ein Hinweis, der
   * im Admin-Bereich landet. Wer sofort Ruhe will, blockiert das Konto.
   */
  reportContent: (
    token: string,
    input: { targetType: ReportTarget; targetId: number; reason: string; note?: string },
  ) =>
    request<{ message: string }>('/reports', {
      method: 'POST',
      body: {
        target_type: input.targetType,
        target_id: input.targetId,
        reason: input.reason,
        note: input.note ?? '',
      },
      token,
    }),

  /** Wen ich blockiert habe. Ohne diese Liste wäre Blockieren nicht umkehrbar. */
  blocks: (token: string) => request<{ data: BlockedPerson[] }>('/blocks', { token }),

  /**
   * Konto blockieren. Beendet zugleich die Freundschaft und die gemeinsamen
   * Gruppen – sonst bliebe die Person im Gruppen-Chat sitzen.
   */
  blockUser: (token: string, userId: number) =>
    request<{ message: string; user: PersonCard }>('/blocks', {
      method: 'POST',
      body: { user_id: userId },
      token,
    }),

  /** Blockierung aufheben. Die Freundschaft kommt dadurch nicht zurück. */
  unblockUser: (token: string, userId: number) =>
    request<{ message: string }>(`/blocks/${userId}`, { method: 'DELETE', token }),

  /** Alle Meldungen, offene zuerst (nur Admin). */
  adminReports: (token: string) => request<AdminReportsResponse>('/admin/reports', { token }),

  /** Meldung als bearbeitet oder verworfen markieren (nur Admin). */
  adminUpdateReport: (token: string, id: number, status: 'open' | 'reviewed' | 'dismissed') =>
    request<{ message: string }>(`/admin/reports/${id}`, {
      method: 'PATCH',
      body: { status },
      token,
    }),

  /* ---------------------------------------------------------------- Merkliste */

  /** Die eigene Merkliste – zuletzt Gemerktes zuerst. */
  savedActivities: (token: string) =>
    request<{ data: Activity[] }>('/activities/saved', { token }),

  /** Event merken (idempotent). Liefert das aktualisierte Event. */
  saveActivity: (token: string, id: number) =>
    request<{ data: Activity }>(`/activities/${id}/save`, { method: 'POST', token }),

  /** Nicht mehr merken. */
  unsaveActivity: (token: string, id: number) =>
    request<{ data: Activity }>(`/activities/${id}/save`, { method: 'DELETE', token }),

  /**
   * Öffentliches Profil einer Person. 404, wenn es den Namen nicht gibt ODER
   * das Konto kein öffentliches Profil hat (Stufe Standard) – für den Aufruf
   * ist beides dasselbe.
   */
  profile: (token: string, username: string) =>
    request<PublicProfile>(`/users/${encodeURIComponent(username)}`, { token }),

  /**
   * Beitrag schreiben (ab Creator). Wie beim Event als multipart, weil ein Bild
   * mitkommen kann; bei einer automatischen Sperre steckt der Grund in
   * `ApiError.body.ban`.
   */
  createPost: (token: string, body: string, image?: ImageUpload | null) => {
    const form = new FormData();
    form.append('body', body);
    if (image) form.append('image', image as unknown as Blob);
    return upload<{ data: ProfilePost }>(token, '/posts', form);
  },

  /**
   * Beschreibung eines eigenen Beitrags nachträglich setzen oder ändern.
   *
   * Nur der Text – ein ausgetauschtes Bild unter einem Beitrag, den schon jemand
   * geliked hat, wäre ein anderer Beitrag. Der Text läuft durch dieselbe
   * KI-Verifizierung wie beim Anlegen.
   */
  updatePost: (token: string, id: number, body: string) =>
    request<{ data: ProfilePost }>(`/posts/${id}`, { method: 'PATCH', body: { body }, token }),

  /** Eigenen Beitrag löschen (Admins jeden). */
  deletePost: (token: string, id: number) =>
    request<{ message: string }>(`/posts/${id}`, { method: 'DELETE', token }),

  /**
   * Gefällt mir setzen bzw. zurücknehmen.
   *
   * Beide Richtungen antworten mit dem VOLLSTÄNDIGEN Beitrag samt neuen Zahlen –
   * so muss die App nicht selbst hoch- und runterzählen und kann nicht
   * auseinanderlaufen, wenn zwei Tipps schnell hintereinander kommen.
   */
  likePost: (token: string, id: number) =>
    request<{ data: ProfilePost }>(`/posts/${id}/like`, { method: 'POST', token }),

  unlikePost: (token: string, id: number) =>
    request<{ data: ProfilePost }>(`/posts/${id}/like`, { method: 'DELETE', token }),

  /** Kommentare eines Beitrags – älteste zuerst. */
  postComments: (token: string, id: number) =>
    request<{ data: PostComment[] }>(`/posts/${id}/comments`, { token }),

  /** Kommentieren. Darf jede Kontostufe – die Stufe entscheidet nur über eigene Auftritte. */
  addComment: (token: string, id: number, body: string) =>
    request<{ data: PostComment; post: ProfilePost }>(`/posts/${id}/comments`, {
      method: 'POST',
      body: { body },
      token,
    }),

  /** Kommentar löschen (eigener, oder jeder unter dem eigenen Beitrag). */
  deleteComment: (token: string, id: number) =>
    request<{ data: ProfilePost }>(`/comments/${id}`, { method: 'DELETE', token }),

  /* ------------------------------------------------------------------ Folgen */

  /**
   * Einer Person folgen – einseitig und ohne Anfrage.
   *
   * Das ist bewusst etwas anderes als eine Freundschaft: Freundschaft ist ein
   * Vertrag zu zweit und schaltet Gruppen und Chats frei, Folgen ist ein Abo auf
   * das, was jemand veröffentlicht. Beides steht deshalb nebeneinander auf dem
   * Profil und nicht anstelle des anderen.
   */
  followUser: (token: string, userId: number) =>
    request<{ is_following: boolean; followers: number; following: number }>(
      `/users/${userId}/follow`,
      { method: 'POST', token },
    ),

  unfollowUser: (token: string, userId: number) =>
    request<{ is_following: boolean; followers: number; following: number }>(
      `/users/${userId}/follow`,
      { method: 'DELETE', token },
    ),

  /** Wer dieser Person folgt. */
  followers: (token: string, username: string) =>
    request<{ data: (PersonCard & { is_following: boolean })[] }>(
      `/users/${encodeURIComponent(username)}/followers`,
      { token },
    ),

  /** Wem diese Person folgt. */
  following: (token: string, username: string) =>
    request<{ data: (PersonCard & { is_following: boolean })[] }>(
      `/users/${encodeURIComponent(username)}/following`,
      { token },
    ),

  /* --------------------------------------------------- Benachrichtigungen */

  /** Neueste zuerst, dazu der Ungelesen-Zähler für die Glocke. */
  notifications: (token: string) =>
    request<NotificationsResponse>('/notifications', { token }),

  /** Alles abhaken – der Hauptweg: Man liest sie als Stapel, nicht einzeln. */
  markNotificationsRead: (token: string) =>
    request<{ unread: number }>('/notifications/read', { method: 'POST', token }),

  /** Eine einzelne abhaken – wenn man genau sie antippt und wegspringt. */
  markNotificationRead: (token: string, id: number) =>
    request<{ unread: number }>(`/notifications/${id}/read`, { method: 'POST', token }),

  /**
   * Profilbild oder Karten-Hintergrund setzen bzw. entfernen.
   *
   * Ein Aufruf für beide Bilder, weil der Ablauf derselbe ist – `kind` sagt,
   * welches gemeint ist. Beides gibt es für JEDE Kontostufe (anders als
   * Beiträge und Social-Links).
   *
   * Die Antwort enthält den aktualisierten Nutzer; wer sie bekommt, sollte ihn
   * in den Auth-Kontext übernehmen, sonst zeigt die Kopfzeile noch das alte
   * Bild. Bei einer automatischen Sperre der KI-Verifizierung steckt der Grund
   * wie beim Beitrag in `ApiError.body.ban`.
   */
  setProfileImage: (token: string, kind: 'avatar' | 'banner', image: ImageUpload) => {
    const form = new FormData();
    form.append('image', image as unknown as Blob);
    return upload<{ user: User }>(token, `/me/${kind}`, form);
  },

  removeProfileImage: (token: string, kind: 'avatar' | 'banner') =>
    request<{ user: User }>(`/me/${kind}`, { method: 'DELETE', token }),

  /**
   * Social-Links setzen (ab Creator). Ersetzt die komplette Liste – was nicht
   * mitkommt, ist danach weg.
   */
  saveLinks: (token: string, links: ProfileLink[]) =>
    request<{ links: ProfileLink[] }>('/me/links', { method: 'PUT', body: { links }, token }),

  /** Zahlen des eigenen Business-Bereichs (ab Stufe Business, sonst 403). */
  businessInsights: (token: string) => request<BusinessInsights>('/business/insights', { token }),

  /**
   * Eigenes Event hervorheben (Business-Stufen). 422, wenn alle Plätze der
   * Stufe belegt sind; 403 bei fremden Events.
   */
  boostActivity: (token: string, id: number) =>
    request<BoostResult>(`/business/activities/${id}/boost`, { method: 'POST', token }),

  /** Hervorhebung wieder wegnehmen. */
  unboostActivity: (token: string, id: number) =>
    request<BoostResult>(`/business/activities/${id}/boost`, { method: 'DELETE', token }),

  /** Admin-Kennzahlen + Tages-Verlauf (Anmeldungen/Beitritte) für das Admin-Panel. */
  adminStats: (token: string) => request<AdminStats>('/admin/stats', { token }),

  /** Alle Nutzer der App (nur Admin). */
  adminUsers: (token: string) => request<{ data: AdminUser[] }>('/admin/users', { token }),

  /** Benutzernamen eines Nutzers ändern (nur Admin). */
  adminRenameUser: (token: string, id: number, username: string) =>
    request<{ message: string; username: string }>(`/admin/users/${id}`, {
      method: 'PATCH',
      body: { username },
      token,
    }),

  /** Nutzer dauerhaft sperren, mit Pflicht-Grund + optionalem Beweis-Bild (nur Admin). */
  adminBanUser: (token: string, id: number, reason: string, image?: ImageUpload | null) =>
    moderationUpload(token, `/admin/users/${id}/ban`, { reason }, image),

  /** Nutzer befristet sperren (Minuten), mit Pflicht-Grund + optionalem Beweis-Bild (nur Admin). */
  adminTimeoutUser: (token: string, id: number, minutes: number, reason: string, image?: ImageUpload | null) =>
    moderationUpload(token, `/admin/users/${id}/timeout`, { minutes: String(minutes), reason }, image),

  /** Alle Beweismittel (nur Admin). */
  adminEvidence: (token: string) => request<{ data: AdminEvidence[] }>('/admin/evidence', { token }),

  /**
   * Berichte der KI-Verifizierung (nur Admin). `onlyFlagged` blendet die
   * unauffälligen Prüfungen (Schwere 0) aus.
   */
  adminModeration: (token: string, onlyFlagged = false) =>
    request<AdminModeration>(`/admin/moderation${onlyFlagged ? '?only=flagged' : ''}`, { token }),

  /** Sperre/Timeout aufheben (nur Admin). */
  adminUnbanUser: (token: string, id: number) =>
    request<{ message: string }>(`/admin/users/${id}/unban`, { method: 'POST', token }),

  /** Nutzer endgültig löschen (nur Admin). */
  adminDeleteUser: (token: string, id: number) =>
    request<{ message: string }>(`/admin/users/${id}`, { method: 'DELETE', token }),

  /** Alle laufenden Storys (nur Admin). Gelöscht wird mit `deleteStory`. */
  adminStories: (token: string) => request<{ data: AdminStory[] }>('/admin/stories', { token }),

  /** Anfragen auf eine höhere Kontostufe – offene zuerst (nur Admin). */
  adminUpgradeRequests: (token: string) =>
    request<AdminUpgradeRequests>('/admin/upgrade-requests', { token }),

  /** Anfrage bestätigen: schaltet die angefragte Stufe frei (nur Admin). */
  adminApproveUpgrade: (token: string, id: number) =>
    request<{ message: string; account_type: AccountType }>(`/admin/upgrade-requests/${id}/approve`, {
      method: 'POST',
      token,
    }),

  /** Anfrage ablehnen; der Grund ist freiwillig und wird der Person gezeigt (nur Admin). */
  adminRejectUpgrade: (token: string, id: number, reason?: string) =>
    request<{ message: string }>(`/admin/upgrade-requests/${id}/reject`, {
      method: 'POST',
      body: { reason: reason ?? '' },
      token,
    }),

  /** Die eigene Anfrage auf eine höhere Stufe (oder null) + was möglich ist. */
  upgradeRequest: (token: string) =>
    request<UpgradeRequestResponse>('/me/upgrade-request', { token }),

  /**
   * Eine Stufe anfragen. Ersetzt eine vorhandene Anfrage desselben Kontos.
   *
   * `billingPeriod` ist Pflicht und hat bewusst keinen Standardwert: Der
   * Rhythmus ist die zweite Hälfte des Angebots, und ein stiller Vorgabewert an
   * dieser Stelle wäre eine Annahme darüber, was jemand zahlen will. Was im
   * Bildschirm vorausgewählt ist, entscheidet `DEFAULT_BILLING_PERIOD` in
   * `@/domain/billing-period` – an einer Stelle und sichtbar.
   */
  requestUpgrade: (
    token: string,
    accountType: AccountType,
    billingPeriod: BillingPeriod,
    message?: string,
  ) =>
    request<{ data: UpgradeRequest }>('/me/upgrade-request', {
      method: 'POST',
      body: {
        account_type: accountType,
        billing_period: billingPeriod,
        message: message ?? '',
      },
      token,
    }),

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
    // Eigene Interessen nur zur Prüfung mitschicken (werden nicht gespeichert).
    (input.customInterests ?? []).forEach((name) => form.append('custom_interests[]', name));
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

    // Kompletten Body mitgeben (parseResponse): bei einer automatischen Sperre stecken die
    // Details in `body.ban` bzw. `body.moderation`.
    return parseResponse<{ data: Activity }>(response, token);
  },
};
