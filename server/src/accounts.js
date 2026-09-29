/**
 * Kontostufen der Server-Seite: Standard, Creator, Business, Business Plus.
 *
 * Hier steht, was eine Stufe DARF. Die App kennt dieselben Regeln (samt Texten)
 * in src/domain/account.ts – die App versteckt damit nur, was der Server hier
 * tatsaechlich verbietet. Wer eine Stufe aendert, muss beide Dateien anfassen;
 * server/test/accounts.test.js und src/domain/account.test.ts halten die
 * Rechte je Stufe fest.
 */

/** Aufsteigend geordnet – die Reihenfolge ist die Rangfolge. */
export const ACCOUNT_TYPES = ['standard', 'creator', 'business', 'business_plus'];

/**
 * Was man sich bei der Registrierung selbst geben darf: nur die kleinste Stufe.
 *
 * Alles darueber schaltet Rechte frei (Events anlegen, oeffentliches Profil,
 * Business-Bereich) und braucht deshalb ein Ja vom Admin – ueber die Anfrage in
 * der App (siehe src/routes/upgrades.js). 'creator' stand hier fruehr mit drin:
 * Damit war die Bestaetigung wertlos, denn wer nicht warten wollte, hat sich ein
 * neues Konto gleich als Creator angelegt.
 *
 * Diese Liste und REQUESTABLE_ACCOUNT_TYPES teilen die Leiter auf, ohne sich zu
 * ueberschneiden – jede Stufe ist genau eins von beidem (accounts.test.js).
 */
export const SELF_SERVICE_ACCOUNT_TYPES = ['standard'];

/**
 * Was man ANFRAGEN kann. Standard fehlt: Das ist die Stufe, mit der jedes Konto
 * anfaengt – niemand fragt sie an. Alles darueber schaltet Rechte frei und
 * braucht deshalb ein Ja vom Admin (siehe src/routes/upgrades.js).
 */
export const REQUESTABLE_ACCOUNT_TYPES = ['creator', 'business', 'business_plus'];

/** Rechte je Stufe – gleiche Werte wie src/domain/account.ts. */
const CAPABILITIES = {
  standard: { canCreateActivities: false, hasBusinessArea: false, hasPublicProfile: false, boostSlots: 0, insightMonths: 0 },
  creator: { canCreateActivities: true, hasBusinessArea: false, hasPublicProfile: true, boostSlots: 0, insightMonths: 0 },
  business: { canCreateActivities: true, hasBusinessArea: true, hasPublicProfile: true, boostSlots: 1, insightMonths: 3 },
  business_plus: { canCreateActivities: true, hasBusinessArea: true, hasPublicProfile: true, boostSlots: 5, insightMonths: 12 },
};

/** Wie lange ein Hervorheben laeuft, wenn es gesetzt wird. */
export const BOOST_DAYS = 7;

/**
 * Alte Werte mitlesen: Bestandskonten stehen noch auf 'personal' (die App kannte
 * fruehr nur 'personal'/'business') – das ist heute 'standard'. NULL kommt von
 * Google-Konten und faellt ebenfalls auf die kleinste Stufe: im Zweifel weniger
 * Rechte, nicht mehr.
 */
export function normalizeAccountType(raw) {
  if (raw === 'personal') {
    return 'standard';
  }
  return ACCOUNT_TYPES.includes(raw) ? raw : 'standard';
}

/** Rang in der Leiter (0 = Standard). */
export function rankOf(raw) {
  return ACCOUNT_TYPES.indexOf(normalizeAccountType(raw));
}

/** Rechte einer Stufe. */
export function capabilitiesFor(raw) {
  return CAPABILITIES[normalizeAccountType(raw)];
}

/**
 * Welche Stufen dieses Konto anfragen darf: alles UEBER der eigenen.
 *
 * Nur nach oben – ein Zurueckstufen ist keine Anfrage, sondern eine
 * Admin-Entscheidung (PATCH /api/user). Auf der hoechsten Stufe kommt eine
 * leere Liste zurueck, und die App zeigt dann gar keinen Knopf.
 */
export function requestableTypesFor(raw) {
  const rank = rankOf(raw);
  return REQUESTABLE_ACCOUNT_TYPES.filter((type) => rankOf(type) > rank);
}

/**
 * Rechte eines Nutzers inkl. Admin-Ausnahme.
 *
 * Admins duerfen Events anlegen, ganz gleich auf welcher Stufe sie stehen: Sie
 * verteilen die Stufen und muessen jede pruefen koennen, ohne sich selbst
 * auszusperren. Der Business-Bereich folgt dagegen weiter der eingestellten
 * Stufe – sonst koennte ein Admin nie nachsehen, was ein Standard-Konto sieht.
 * Genau dieselbe Regel steht in src/domain/account.ts (accountAbilities).
 */
export function abilitiesFor(user) {
  const base = capabilitiesFor(user?.account_type);
  if (!user?.is_admin) {
    return base;
  }
  return {
    ...base,
    // Die EINZIGE Ausnahme fuer Admins. Alles andere folgt der eingestellten
    // Stufe: Sonst sieht ein Admin andere Zahlen als das Konto, das er prueft.
    canCreateActivities: true,
  };
}
