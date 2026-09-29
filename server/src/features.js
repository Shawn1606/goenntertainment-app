/**
 * Server-Gegenstück zu src/constants/features.ts: Funktionen, die gerade
 * ausgeblendet sind. Beide Dateien gehören zusammen umgelegt.
 *
 * Gesteuert über `server/.env`:
 *
 *   FEATURE_IMPORTED_EVENTS=true   importierte Veranstaltungen (Lokhalle, CinemaxX …)
 *                                  wieder in Listen zeigen
 *   FEATURE_ACCOUNT_TIERS=true     Kontostufen wieder durchsetzen (nur ab Creator
 *                                  Aktivitäten erstellen)
 *
 * ## Warum als Funktionen und nicht als Konstanten
 *
 * Die Werte werden bei JEDEM Aufruf aus `process.env` gelesen. Als Konstante
 * stünden sie mit dem ersten `import` fest – und ESM zieht alle Importe vor den
 * übrigen Code. Ein Test, der die Stufen-Regeln prüft, könnte den Schalter dann
 * nicht mehr umlegen, bevor die Routen geladen sind.
 *
 * ## Warum aus
 *
 * - Importierte Veranstaltungen: 143 von 147 Einträgen kamen aus dem Import. Sie
 *   haben die Aktivitäten der Nutzer:innen – den eigentlichen Kern – verdrängt.
 * - Kontostufen: Solange die App keine Stufen anbietet, gäbe es für ein
 *   Standard-Konto keinen Weg, Aktivitäten zu erstellen.
 */

function flag(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).trim().toLowerCase());
}

/** Importierte Veranstaltungen in Listen zeigen? */
export function importedEventsVisible() {
  return flag('FEATURE_IMPORTED_EVENTS', false);
}

/** Kontostufen durchsetzen? Aus = jedes Konto darf Aktivitäten erstellen. */
export function accountTiersEnabled() {
  return flag('FEATURE_ACCOUNT_TIERS', false);
}

/**
 * SQL-Bedingung „ist keine importierte Veranstaltung" für `activities`-Abfragen.
 * Leer, wenn der Import sichtbar sein soll – dann hängt die Abfrage unverändert.
 *
 * `alias` ist der Tabellen-Alias der Aktivität in der Abfrage (z. B. `a`).
 */
export function hideImportedSql(alias = 'activities') {
  if (importedEventsVisible()) return '';
  return `${alias}.id NOT IN (SELECT activity_id FROM imported_events WHERE activity_id IS NOT NULL)`;
}
