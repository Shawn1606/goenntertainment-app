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

/**
 * Basis fuer oeffentliche Datei-Adressen.
 *
 * Seit Laravel vorn steht (Port 8000) und unbekannte Pfade hierher weiterreicht,
 * kommt jede Anfrage der App mit dem Host "127.0.0.1:8001" an – der Adresse
 * zwischen den beiden Servern. Daraus gebaute Bild-URLs erreicht das Handy nie.
 * Laravel schickt deshalb in `X-Forwarded-Host` mit, unter welcher Adresse die
 * App gefragt hat; die zaehlt. (`req.hostname` taugt dafuer nicht: Express 4
 * wirft dort den Port weg, und ohne ":8000" zeigte die URL auf Port 80.)
 *
 * Nur der ERSTE Eintrag zaehlt – bei mehreren Proxys haengt jeder seinen an.
 *
 * And only from the trusted hop (app.js 'trust proxy', i.e. Laravel; F-31), the same rule
 * Express applies to X-Forwarded-Proto behind `req.protocol`: from any other peer the header is
 * ignored, so nobody else can choose the host in the image addresses Node hands out.
 */
export function publicBase(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL;
  const trusted = req.app.get('trust proxy fn')(req.socket.remoteAddress, 0);
  const forwarded = trusted ? String(req.get('x-forwarded-host') ?? '').split(',')[0].trim() : '';
  return `${req.protocol}://${forwarded || req.get('host')}`;
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
