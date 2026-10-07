/**
 * Kontostufen und was sie freischalten – reine Datenlogik, kein React.
 *
 * Vier Stufen, aufeinander aufbauend: Standard schaut zu, Creator veranstaltet,
 * Business rechnet nach, Business Plus tut das mit mehr Luft. Jede Stufe
 * beschreibt hier BEIDES an einer Stelle: die Rechte (`capabilities`) und die
 * Sätze, mit denen die App sie erklärt (`tagline`, `perks`). Das ist Absicht –
 * sonst verspricht die Upgrade-Liste irgendwann etwas, das der Code nicht kann.
 *
 * Die Rechte stehen als Daten und nicht als if-Ketten in den Screens: Eine
 * Stufe umzustellen ist damit eine Zeile hier, kein Suchlauf durch die App.
 * Denselben Satz Regeln gibt es nochmal für den Server (server/src/accounts.js) –
 * die App versteckt nur, der Server verbietet.
 */

export type AccountType = 'standard' | 'creator' | 'business' | 'business_plus';

export type AccountCapabilities = {
  /** Eigene Events anlegen. Standard darf das bewusst nicht. */
  canCreateActivities: boolean;
  /** Business-Bereich in der unteren Leiste (Umsatz & Reichweite). */
  hasBusinessArea: boolean;
  /**
   * Öffentliche Profilseite: Stufe, Beiträge und Social-Links, sichtbar auch für
   * andere. Standard hat keine – wer nur mitmacht, hat auch keinen Auftritt.
   */
  hasPublicProfile: boolean;
  /**
   * Wie viele eigene Events gleichzeitig hervorgehoben („geboostet") sein
   * dürfen. 0 = die Funktion gibt es auf dieser Stufe nicht.
   */
  boostSlots: number;
  /** Über wie viele Monate der Business-Bereich zurückblickt. */
  insightMonths: number;
};

export type AccountTier = {
  type: AccountType;
  label: string;
  /** Ein Satz, der die Stufe einordnet. */
  tagline: string;
  /** Was diese Stufe kann – Grundlage der Upgrade-Liste. */
  perks: readonly string[];
  /**
   * Monatsbeitrag in **Cent**, `0` bei Standard.
   *
   * Cent als ganze Zahl, nicht `7.99` als Kommazahl: In Gleitkomma ist 7,99
   * nicht genau darstellbar, und drei Monatsbeiträge ergäben
   * `23.970000000000002`. Geld zählt man in der kleinsten Einheit – dieselbe
   * Entscheidung wie bei `points INT` in der Datenbank.
   *
   * Das ist der **verbindliche Preis in Euro**, an dem sich Abrechnung und
   * Buchhaltung ausrichten. Nicht zwangsläufig der Preis, der in der App
   * steht: Läuft das Abo über die Stores (In-App-Kauf), legt Apple bzw. Google
   * den Preis je Land und Währung fest, und angezeigt werden MUSS dann der
   * Wert, den der Store meldet – sonst steht in der App etwas anderes als auf
   * der Rechnung.
   */
  monthlyPriceCents: number;
  /**
   * Jahresbeitrag in **Cent**, `0` bei Standard – und `0` auch bei einer Stufe,
   * die es nur im Monatsabo geben soll.
   *
   * **Ausgeschrieben und nicht aus dem Monatsbeitrag gerechnet**, obwohl hier
   * momentan überall genau zehn Monatsbeiträge stehen. Der Nachlass ist eine
   * Preisentscheidung je Stufe, keine Formel: Sobald eine Stufe im Jahr 20 %
   * nachlässt und eine andere 15 %, stimmt keine Formel mehr für beide. Dass der
   * Jahrespreis niedriger ist als zwölf Monatsbeiträge, hält
   * `account.test.ts` fest – sonst könnte hier eine Zahl stehen, die das Etikett
   * „2 Monate gratis" zur Lüge macht.
   *
   * Gerechnet und beschriftet wird damit in {@link ./billing-period.ts}.
   */
  yearlyPriceCents: number;
  capabilities: AccountCapabilities;
};

/**
 * Aufsteigend geordnet. Die Reihenfolge IST die Rangfolge: `rankOf` und
 * `nextTier` lesen sie aus dem Index, damit es keine zweite Wahrheit gibt.
 */
export const ACCOUNT_TIERS: readonly AccountTier[] = [
  {
    type: 'standard',
    label: 'Standard',
    tagline: 'Mitmachen, entdecken, dabei sein.',
    perks: ['Events in deiner Nähe finden', 'Beitreten, Fortschritt und Abzeichen'],
    monthlyPriceCents: 0,
    yearlyPriceCents: 0,
    capabilities: {
      canCreateActivities: false,
      hasBusinessArea: false,
      hasPublicProfile: false,
      boostSlots: 0,
      insightMonths: 0,
    },
  },
  {
    type: 'creator',
    label: 'Creator',
    tagline: 'Du bringst die Leute zusammen.',
    perks: [
      'Eigene Events erstellen',
      'Eigene Events bearbeiten und löschen',
      'Öffentliches Profil mit Beiträgen und Social-Links',
    ],
    monthlyPriceCents: 799,
    // Zehn Monatsbeiträge fürs Jahr – zwei sind geschenkt.
    yearlyPriceCents: 7990,
    capabilities: {
      canCreateActivities: true,
      hasBusinessArea: false,
      hasPublicProfile: true,
      boostSlots: 0,
      insightMonths: 0,
    },
  },
  {
    type: 'business',
    label: 'Business',
    tagline: 'Zahlen zu deinen Events – Umsatz und Reichweite.',
    perks: [
      'Business-Bereich mit Umsatz & Buchungen',
      'Reichweite deiner Events auswerten',
      '1 Event gleichzeitig hervorheben',
      'Rückblick über 3 Monate',
    ],
    monthlyPriceCents: 1499,
    yearlyPriceCents: 14990,
    capabilities: {
      canCreateActivities: true,
      hasBusinessArea: true,
      hasPublicProfile: true,
      boostSlots: 1,
      insightMonths: 3,
    },
  },
  {
    type: 'business_plus',
    label: 'Business Plus',
    tagline: 'Mehr Reichweite und der längere Rückblick.',
    perks: [
      'Alles aus Business',
      '5 Events gleichzeitig hervorheben',
      'Rückblick über 12 Monate',
    ],
    monthlyPriceCents: 2999,
    yearlyPriceCents: 29990,
    capabilities: {
      canCreateActivities: true,
      hasBusinessArea: true,
      hasPublicProfile: true,
      boostSlots: 5,
      insightMonths: 12,
    },
  },
] as const;

/** Die niedrigste Stufe – Rückfall für alles Unbekannte. */
const FALLBACK: AccountType = 'standard';

/**
 * Alte Werte mitlesen: Vor den vier Stufen kannte die App nur
 * 'personal'/'business'. Bestandskonten stehen in der Datenbank also noch auf
 * 'personal' – das ist heute 'standard'. Ein leerer Wert (Google-Konten legen
 * `account_type` nicht an) fällt bewusst auf die kleinste Stufe zurück: im
 * Zweifel weniger Rechte, nicht mehr.
 */
export function normalizeAccountType(raw: string | null | undefined): AccountType {
  if (raw === 'personal') return 'standard';
  return ACCOUNT_TIERS.some((tier) => tier.type === raw) ? (raw as AccountType) : FALLBACK;
}

/** Stufe zu einem (auch alten) Wert. */
export function tierFor(raw: string | null | undefined): AccountTier {
  const type = normalizeAccountType(raw);
  // Non-null: normalizeAccountType liefert nur Werte, die in ACCOUNT_TIERS stehen.
  return ACCOUNT_TIERS.find((tier) => tier.type === type)!;
}

/** Rang in der Leiter (0 = Standard). Praktisch für Vergleiche. */
export function rankOf(raw: string | null | undefined): number {
  return ACCOUNT_TIERS.findIndex((tier) => tier.type === normalizeAccountType(raw));
}

/** Die nächsthöhere Stufe; null auf der höchsten. */
export function nextTier(raw: string | null | undefined): AccountTier | null {
  return ACCOUNT_TIERS[rankOf(raw) + 1] ?? null;
}

/** Anzeigename – auch für Altwerte aus der Datenbank. */
export function accountLabel(raw: string | null | undefined): string {
  return tierFor(raw).label;
}

/** Rechte der Stufe. */
export function capabilitiesFor(raw: string | null | undefined): AccountCapabilities {
  return tierFor(raw).capabilities;
}

/**
 * Was ein Konto darf – inklusive der Admin-Ausnahme.
 *
 * Admins dürfen alles: Sie stellen die Stufen ein und müssen jede davon prüfen
 * können, ohne sich selbst auszusperren. Genau dieselbe Regel steht im Server
 * (server/src/accounts.js), damit die App nichts anbietet, was dort scheitert.
 */
export function accountAbilities(
  user: { account_type?: string | null; is_admin?: boolean | null } | null | undefined,
): AccountCapabilities {
  const base = capabilitiesFor(user?.account_type);
  if (!user?.is_admin) return base;
  return {
    ...base,
    // Die EINZIGE Ausnahme für Admins. Alles andere folgt weiter der
    // eingestellten Stufe – sonst könnte ein Admin nie nachsehen, was ein
    // Standard- oder Business-Konto tatsächlich sieht, und die Zahlen im
    // Business-Bereich würden den Vorzügen der Stufe widersprechen.
    canCreateActivities: true,
  };
}

/**
 * Whether a profile page shows the ADMIN badge: only on the viewer's own profile (F-05).
 *
 * The server sends `is_admin` only on the viewer's own record. The `is_me` check keeps the same
 * rule in the app, so a response that still carried the flag for someone else (an older server)
 * shows no badge either.
 */
export function showsAdminBadge(profile: {
  is_me: boolean;
  user: { is_admin?: boolean | null };
}): boolean {
  return profile.is_me && Boolean(profile.user.is_admin);
}

/**
 * Cent → deutscher Preistext: `799` ergibt `"7,99 €"`.
 *
 * Von Hand formatiert, kein `Intl.NumberFormat` – aus demselben Grund wie in
 * {@link ./date-format.ts}: Auf Hermes fehlen je nach Build die Sprachdaten,
 * und dann steht `€7.99` in einer deutschen App.
 *
 * Die Cent-Stelle wird immer zweistellig geschrieben. `1500` ist `"15,00 €"`
 * und nicht `"15,0 €"` – bei einem Preis fehlt sonst sichtbar eine Ziffer.
 */
export function formatPriceCents(cents: number): string {
  const rounded = Math.round(cents);
  const sign = rounded < 0 ? '-' : '';
  const total = Math.abs(rounded);
  return `${sign}${Math.floor(total / 100)},${String(total % 100).padStart(2, '0')} €`;
}

/*
 * Den Preistext („7,99 € / Monat") gibt es hier nicht mehr: Seit es Monats- UND
 * Jahresabos gibt, hängt er am Zeitraum und steht deshalb als `priceLabel` in
 * ./billing-period.ts. Eine Monatsvariante daneben wäre eine zweite Wahrheit
 * für dieselbe Zeile – und die eine, die man vergisst, wenn sich die Schreibweise
 * ändert.
 */
