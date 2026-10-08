/**
 * Einladungslink einer Gruppe – und der Text, mit dem man ihn verschickt.
 *
 * Der Link zeigt auf die Web-Seite des Servers (`/g/<code>`), die die App öffnet
 * oder sagt, wo es sie gibt. So funktioniert er auch bei Leuten, die GÖ4Fun noch
 * nicht haben – genau die will man ja einladen.
 */

/** `https://api.example.de/api` → `https://api.example.de/g/ABCD2345`. */
export function inviteLink(apiUrl: string, code: string): string {
  const base = apiUrl.replace(/\/+$/, '').replace(/\/api$/, '');
  return `${base}/g/${code.replace(/[^A-Za-z0-9]/g, '')}`;
}

export function inviteText(groupName: string, code: string, link: string): string {
  return `Komm in meine Gruppe „${groupName}“ bei GÖ4Fun – zusammen bekommen wir Gruppenrabatt!\n\n${link}\n\nOder in der App unter Gruppen den Code ${code} eingeben.`;
}
