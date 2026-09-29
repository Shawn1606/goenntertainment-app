# Backend dauerhaft ins Netz stellen

Ziel: eine feste `https://`-Adresse, die von überall erreichbar ist – ohne Tunnel,
ohne dass dein PC läuft. Diese Adresse wird in den App-Build eingebacken.

Das Ganze ist ein Server mit drei Containern: **MySQL** (Datenbank), **API**
(dein `server/`) und **Caddy** (HTTPS + Weiterleitung). Caddy holt das
Zertifikat allein, das ist der Grund für den Aufbau.

---

## Was du brauchst

| | Was | Kosten |
|---|---|---|
| 1 | Ein kleiner Linux-Server (VPS), z. B. **Hetzner CX22** – 2 Kerne, 4 GB RAM, Standort Nürnberg | ~4,50 €/Monat |
| 2 | Eine Domain, z. B. `goenntertainment.de` | ~10 €/Jahr |

Warum Hetzner: deutsches Unternehmen, Server in Deutschland. Für eine App mit
Chats, Meldungen und Jugendschutz-Prüfung ist das die unkomplizierte Antwort auf
die DSGVO-Frage – bei US-Anbietern brauchst du einen Auftragsverarbeitungsvertrag
und musst den Drittlandtransfer begründen.

4 GB RAM sind für MySQL + Node reichlich; der 2-GB-Tarif (CX11) geht auch, wird
bei vielen gleichzeitigen Bild-Uploads aber knapp.

---

## Schritt 1 – Domain auf den Server zeigen lassen

Beim Domain-Anbieter einen **A-Eintrag** anlegen:

```
api    A    <IPv4 deines Servers>
```

Ergebnis: `api.goenntertainment.de`. **Das muss vor Schritt 4 stehen** – Caddy
bekommt das Zertifikat nur, wenn Let's Encrypt die Domain schon auflösen kann.

Prüfen (kann bis zu einer Stunde dauern, meist wenige Minuten):

```bash
nslookup api.goenntertainment.de
```

## Schritt 2 – Docker auf dem Server installieren

Per SSH auf dem Server:

```bash
curl -fsSL https://get.docker.com | sh
```

## Schritt 3 – Projekt auf den Server holen

```bash
git clone <deine-repo-url> goenntertainment && cd goenntertainment/deploy
```

Kein Git-Remote? Dann vom PC aus hochladen (PowerShell, im Projektordner):

```bash
scp -r server shared deploy root@<server-ip>:/root/goenntertainment/
```

`shared/` muss mit: Dort liegen die Listen, die App, Node und Laravel gemeinsam
lesen (gesperrte Begriffe, häufige Passwörter). Compose reicht den Ordner beim
Bauen als zweiten Kontext herein (`additional_contexts` in
`docker-compose.yml`) – fehlt er, bricht `docker compose up --build` mit einem
Fehler zu `shared` ab. Das ist gewollt: Ohne die Liste gesperrter Begriffe
startet die API nicht, statt still ohne Filter zu laufen. Braucht Docker Compose
ab 2.17 (`docker compose version`).

## Schritt 4 – Zugangsdaten setzen und starten

```bash
cp .env.example .env
```

`.env` ausfüllen – `DOMAIN`, `DB_PASSWORD`, `DB_ROOT_PASSWORD` sind Pflicht.
Passwörter erzeugen:

```bash
openssl rand -base64 24
```

Dann starten:

```bash
docker compose up -d
```

Beim ersten Mal dauert es 1–2 Minuten: Abbild bauen, MySQL initialisieren,
`schema.sql` einspielen, Zertifikat holen. Das Schema wird **automatisch**
angelegt, du musst nichts einspielen.

## Schritt 5 – Nachsehen, ob es läuft

```bash
curl https://api.goenntertainment.de/api/health
```

Erwartet: `{"ok":true}`. Kommt stattdessen ein Zertifikatsfehler, zeigt die
Domain noch nicht auf den Server – Logs ansehen:

```bash
docker compose logs caddy --tail 30
```

## Schritt 6 – Admin-Konto anlegen (optional)

`ADMIN_EMAIL` und `ADMIN_PASSWORD` in `.env` setzen, dann:

```bash
docker compose exec api npm run seed
```

> Achtung: `seed` legt auch Beispieldaten an. Auf einem Server, der schon echte
> Nutzer:innen hat, vorher `server/src/seed.js` lesen.

---

## Danach: Adresse in den App-Build eintragen

In [`eas.json`](../eas.json) bei **beiden** Profilen (`preview` und `production`)
den Platzhalter ersetzen:

```json
"env": { "EXPO_PUBLIC_API_URL": "https://api.goenntertainment.de" }
```

Ohne diesen Schritt ist der Build unbrauchbar – die App zeigt beim Login nur
einen Timeout.

---

## Laravel (`api/`) ausrollen

Dieses Compose startet nur das Node-Backend. Wer Laravel daneben betreibt, rollt
das **ganze Repo** aus, nicht nur `api/`: `App\Support\BlockedTerms` liest
`shared/blocked-terms.json` neben `api/` (`dirname(__DIR__, 3)`, also
Repo-Stamm). Fehlt die Datei, antworten Registrierung und Profil-Änderung mit
500 – absichtlich, damit ein Server ohne Filter sofort auffällt. Außerdem nötig:
PHP-Erweiterung `intl` (für die Unicode-Normalisierung; ohne sie fallen
exotische Schriften wie 𝐟𝐞𝐭𝐭𝐞 Buchstaben durch).

## Laufender Betrieb

**Neue Version ausrollen** (nach `git push` vom PC):

```bash
git pull && docker compose up -d --build api
```

**Logs mitlesen:**

```bash
docker compose logs -f api
```

**Datenbank sichern** – bitte einrichten, das ist der einzige unersetzliche Teil:

```bash
docker compose exec db mysqldump -uroot -p"$DB_ROOT_PASSWORD" goenntertainment > backup-$(date +%F).sql
```

Die Nutzer-Uploads liegen daneben in `deploy/storage/` und gehören ins selbe
Backup. Am besten als täglichen Cronjob plus Hetzner-Snapshot (~1 €/Monat).

**Firewall:** Nur 22 (SSH), 80 und 443 müssen offen sein. Port 3306 (MySQL) und
8000 (API) sind absichtlich **nicht** nach außen geöffnet – die API ist nur über
Caddy erreichbar, die Datenbank nur containerintern.
