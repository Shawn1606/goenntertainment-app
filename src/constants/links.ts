/**
 * Externe Adressen aus den Einstellungen (Hilfe, Recht, Support).
 *
 * ACHTUNG, PLATZHALTER – hier die echten Adressen eintragen, bevor die App
 * veröffentlicht wird. Datenschutzerklärung, Nutzungsbedingungen und ein
 * Impressum sind in Deutschland Pflicht, sobald die App öffentlich ist; die
 * App-Stores prüfen zusätzlich, ob ein Weg zum Löschen des Kontos existiert.
 *
 * Alles an einer Stelle, damit nichts vergessen wird: Steht hier die richtige
 * Adresse, stimmt sie überall in der App.
 */

/** Postfach für Support, Feedback und Löschanfragen. */
export const SUPPORT_EMAIL = 'support@goenn4fun.de';

export const Links = {
  help: 'https://goenn4fun.de/hilfe',
  privacy: 'https://goenn4fun.de/datenschutz',
  terms: 'https://goenn4fun.de/nutzungsbedingungen',
  imprint: 'https://goenn4fun.de/impressum',
} as const;

/** `mailto:`-Adresse mit vorbereitetem Betreff (und optional Text). */
export function supportMailto(subject: string, body?: string): string {
  const params = [`subject=${encodeURIComponent(subject)}`];
  if (body) params.push(`body=${encodeURIComponent(body)}`);
  return `mailto:${SUPPORT_EMAIL}?${params.join('&')}`;
}
