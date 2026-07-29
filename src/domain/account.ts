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
