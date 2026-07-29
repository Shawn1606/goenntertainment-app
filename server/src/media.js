/**
 * Adressen fuer Bilder, die unter storage/ liegen.
 *
 * Warum das eine eigene Stelle ist: In `users.avatar` stehen ZWEI Sorten Werte.
 * Google-Konten bringen eine fremde, absolute URL mit
 * (lh3.googleusercontent.com/...), selbst hochgeladene Bilder liegen als
 * relativer Pfad in der DB ('avatars/ab12cd.jpg'). Beide muessen in der Antwort
 * als fertige Adresse ankommen – die App setzt sie unveraendert in ein
 * <Image>.
 *
 * Und warum ueberhaupt der relative Pfad? Weil die absolute Adresse dieses
 * Servers sich AENDERT: In der Entwicklung ist es die WLAN-IP des Rechners
 * (siehe src/constants/config.ts in der App), in Produktion PUBLIC_URL. Stuende
 * die Volladresse in der DB, zeigten alle Profilbilder nach dem naechsten
 * IP-Wechsel ins Nichts. Der Pfad bleibt richtig, die Adresse entsteht bei jeder
 * Antwort neu.
 */

/** Basis fuer oeffentliche Datei-Adressen. */
export function publicBase(req) {
  return process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
}

/**
 * Volle Adresse fuer einen gespeicherten Pfad.
 *
 * Fremde URLs (Google-Avatare) bleiben unangetastet, `null` bleibt `null` –
 * so kann der Aufrufer den Wert bedenkenlos durchschleifen.
 */
export function mediaUrl(req, value) {
  if (!value) {
    return null;
  }
  if (/^https?:\/\//i.test(String(value))) {
    return value;
  }
  return `${publicBase(req)}/storage/${value}`;
}
