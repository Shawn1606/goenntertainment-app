/**
 * Welche Funktionen die App gerade ZEIGT.
 *
 * ## Warum es diese Datei gibt
 *
 * Die App war in kurzer Zeit auf Instagram + Meetup + Payback in einem
 * angewachsen: Beiträge, Storys, Folgen, Glocke, Punkte, Coupons, Level,
 * Rangliste, vier Kontostufen, Business-Bereich. Für eine Stadt und wenige
 * Nutzer war das mehr Oberfläche als Inhalt – leere Story-Leisten, leere
 * Ranglisten, und der eigentliche Kern (etwas finden, hingehen, Leute treffen)
 * stand weit unten.
 *
 * Der Kern bleibt und wird ausgebaut: Aktivitäten finden, erstellen, beitreten,
 * Karte, Freunde & Gruppen, Chats, Profil, Einstellungen.
 *
 * Alles andere ist hier AUSGEBLENDET – nicht gelöscht. Code, Datenbank und
 * Server-Endpunkte bleiben, wie sie sind; nur die Einstiege in der App fehlen.
 * Einschalten heißt: den Wert auf `true` setzen. Die Server-Seite hat ihr
 * eigenes Gegenstück in `server/src/features.js` (importierte Veranstaltungen,
 * Kontostufen) – beide gehören zusammen umgelegt.
 */
export const Features = {
  /** Beiträge auf Profilen samt Likes und Kommentaren. */
  posts: false,
  /** 24-Stunden-Storys (Leiste auf Home, Betrachter, Erstellen). */
  stories: false,
  /** Folgen/Follower – ohne Beiträge und Storys gibt es nichts zu abonnieren. */
  follow: false,
  /** Die Glocke. Ihre Meldungen stammen alle aus Folgen, Beiträgen und Storys. */
  notifications: false,
  /** Punkte und Coupons („Prämien"). Ohne Partner-Verträge ein leeres Versprechen. */
  rewards: false,
  /** XP, Level, Abzeichen, Rangliste. */
  progress: false,
  /**
   * Kontostufen (Creator/Business/Business Plus), Upgrade-Bildschirm, Preise,
   * Business-Bereich. Aus = JEDES Konto darf Aktivitäten erstellen – sonst wäre
   * der Kern der App hinter einer Stufe versteckt, die man nicht mehr erreicht.
   */
  accountTiers: false,
  /** Social-Links (Instagram, TikTok …) auf dem Profil. */
  socialLinks: false,
} as const;

export type FeatureName = keyof typeof Features;
