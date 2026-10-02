# GÖ4Fun auf einen Server bringen (Docker)

Ziel: eine feste `https://`-Adresse, die von überall erreichbar ist – ohne Tunnel,
ohne dass dein PC läuft. Diese Adresse wird in den App-Build eingebacken.

## Was hier läuft

Alles, was auf dem Server gebraucht wird, steckt in **Containern**: fertig
gepackten Paketen, die ihre PHP- bzw. Node-Version und alle Bibliotheken selbst
mitbringen. Auf dem Server muss dafür nur **Docker** installiert sein.

```
Internet ─► caddy   HTTPS-Zertifikat, Port 80/443
              └─► api    Laravel (api/)   – Anmeldung, Konto, Zwei-Faktor …
                    └─► node   Node (server/)  – alles, was noch nicht umgezogen ist
            db     MySQL – von beiden Backends benutzt
```

Das ist dieselbe Aufstellung wie am Entwicklungs-PC (Laravel vorn, Node
dahinter). Von außen erreichbar ist nur Caddy; `api`, `node` und `db` sprechen
nur untereinander.

Die **Handy-App selbst** steckt nicht in einem Container – sie wird mit EAS als
APK bzw. iOS-App gebaut und bekommt die Server-Adresse mit (siehe unten).

| Datei | Wofür |
|---|---|
| `deploy/docker-compose.yml` | welche Container es gibt und wie sie zusammenhängen |
| `api/Dockerfile` | Bauplan für den Laravel-Container (PHP 8.4 + Apache) |
| `server/Dockerfile` | Bauplan für den Node-Container |
| `deploy/Caddyfile` | HTTPS und Weiterleitung an Laravel |
| `deploy/.env` | deine Zugangsdaten (aus `.env.example`, **nie ins Git**) |

---

## Was du brauchst

| | Was | Kosten |
|---|---|---|
| 1 | Ein kleiner Linux-Server (VPS), z. B. **Hetzner CX22** – 2 Kerne, 4 GB RAM, Standort Nürnberg | ~4,50 €/Monat |
| 2 | Eine Domain, z. B. `goenntertainment.de` | ~10 €/Jahr |
| 3 | Optional: ein Mail-Zugang (SMTP) für die 2FA-Codes, z. B. Brevo | gratis bis 300 Mails/Tag |

Warum Hetzner: deutsches Unternehmen, Server in Deutschland – die
unkomplizierte Antwort auf die DSGVO-Frage.

4 GB RAM reichen für MySQL, Laravel und Node gut. Der 2-GB-Tarif geht auch, wird
bei vielen gleichzeitigen Bild-Uploads aber knapp.

---

## Schritt 1 – Domain auf den Server zeigen lassen

Beim Domain-Anbieter einen **A-Eintrag** anlegen:

```
api    A    <IPv4 deines Servers>
```

Ergebnis: `api.goenntertainment.de`. **Das muss vor Schritt 5 stehen** – Caddy
bekommt das Zertifikat nur, wenn Let's Encrypt die Domain schon auflösen kann.

```bash
nslookup api.goenntertainment.de
```

## Schritt 2 – Docker auf dem Server installieren

Per SSH auf dem Server:

```bash
curl -fsSL https://get.docker.com | sh
```

Prüfen – gebraucht wird Docker Compose **ab 2.17**:

```bash
docker compose version
```

## Schritt 3 – Projekt auf den Server holen

```bash
git clone https://github.com/Shawn1606/goenntertainment-app.git goenntertainment
cd goenntertainment/deploy
```

Gebraucht werden die Ordner `api/`, `server/`, `shared/` und `deploy/`.
`shared/` enthält die Listen, die App, Node und Laravel gemeinsam lesen (gesperrte
Begriffe, häufige Passwörter). Fehlt der Ordner, bricht der Bau mit einem Fehler
zu `shared` ab – gewollt: Ohne den Wortfilter startet die API nicht, statt still
ohne ihn zu laufen.

## Schritt 4 – Zugangsdaten eintragen

```bash
cp .env.example .env
nano .env
```

Pflicht sind `DOMAIN`, `DB_PASSWORD`, `DB_ROOT_PASSWORD` und `APP_KEY`.
Also required: `NODE_INTERNAL_SECRET`, the secret Laravel and Node share for Node's internal
routes (generate it once with `openssl rand -hex 32`), and `APP_NET_PREFIX`, the containers'
private /24 network (see the comment in `.env.example`). Without them `docker compose` refuses
to start.

Also required: `ANTHROPIC_API_KEY`, the key of the AI moderation that checks every new event,
post, comment, profile image and story before it is stored. Node does not start without it, and
in production it also refuses `MODERATION_ENABLED=false`. The operator decides whose provider
account and key this is.

Also required: `MODERATION_DAILY_CALL_LIMIT`, the most AI moderation calls per UTC day across all
accounts, a whole number of at least 1. Each check of a new event, post, comment, profile image
or story is one call; once the day's limit is used up, node refuses them until the next UTC day,
whatever `MODERATION_FAIL_OPEN` says. How much is spent on the provider is the operator's
decision, so there is no default, and node does not start without it.

And four retention settings, each a number of whole days. How long data that is no longer needed
is kept is the operator's decision, so there are no defaults; node deletes what is older every
hour (more in the comments in `.env.example`):

- `EVIDENCE_RETENTION_DAYS`: evidence images of bans and of AI moderation reports (the image
  goes, the record stays); at least 1.
- `MODERATION_REPORT_RETENTION_DAYS`: the AI moderation log, which copies every checked text and
  image; at least 1.
- `TOKEN_RETENTION_DAYS`: sign-in tokens and two-factor and password-reset codes that are no
  longer valid, counted from when they stopped being valid; at least 1.
- `USAGE_RETENTION_DAYS`: event views and active days; at least 120 (the streak window).

Without these six settings, too, `docker compose` refuses to start.

Also required, each an operator decision without a default (the comments in `.env.example` say
who decides and in which form): the mail provider and sender, `MAIL_HOST`, `MAIL_USERNAME`,
`MAIL_PASSWORD` (both may be empty for a relay without login) and `MAIL_FROM_ADDRESS`; the
backups, `BACKUP_DIR` (an absolute path outside this clone, owned by root, mode 700) and
`BACKUP_RETENTION_DAYS`; the logs, `LOG_MAX_SIZE` and `LOG_MAX_FILES`; and the MySQL binary log,
`MYSQL_BINLOG_RETENTION_DAYS` (days, or `off`). `scripts/preflight.sh` checks the file before a
start.

Passwörter erzeugen:

```bash
openssl rand -base64 24
```

Den `APP_KEY` erzeugen (ergibt eine Zeile, die mit `base64:` beginnt):

```bash
echo "base64:$(openssl rand -base64 32)"
```

> **Den `APP_KEY` einmal erzeugen und nie wieder ändern.** Laravel verschlüsselt
> damit die Geheimnisse der Zwei-Faktor-Anmeldung. Mit einem neuen Schlüssel käme
> niemand mit eingeschalteter 2FA mehr in sein Konto. Heb ihn zusätzlich
> außerhalb des Servers auf (z. B. im Passwort-Manager).

Für 2FA-Codes per E-Mail und die Codes von „Passwort vergessen" außerdem
`MAIL_HOST`, `MAIL_USERNAME` und `MAIL_PASSWORD` eintragen. Ohne sie läuft alles,
nur E-Mail-Codes kommen nicht an – auch niemand kann dann sein Passwort zurücksetzen.

## Schritt 5 – Starten

```bash
docker compose up -d --build
```

Beim ersten Mal dauert es einige Minuten: die zwei Abbilder bauen, MySQL
einrichten, `server/schema.sql` einspielen, Zertifikat holen. Das Schema wird
**automatisch** angelegt – nichts von Hand einspielen und **kein**
`php artisan migrate` (das Schema gehört dem Node-Backend; Laravels
Standard-Migrationen würden die Tabelle `users` doppelt anlegen wollen).

Zusehen, bis alles „healthy" ist:

```bash
docker compose ps
```

## Schritt 6 – Nachsehen, ob es läuft

```bash
curl https://api.goenntertainment.de/api/health
```

Erwartet: `{"ok":true}`. Kommt ein Zertifikatsfehler, zeigt die Domain noch
nicht auf den Server:

```bash
docker compose logs caddy --tail 30
```

## Schritt 7 – Kategorien und Admin-Konto anlegen

Das legt die Kategorien (Sport, Musik …) an und – wenn `ADMIN_EMAIL` und
`ADMIN_PASSWORD` in `.env` stehen – das Admin-Konto:

```bash
docker compose exec node npm run seed
```

> Achtung: `seed` legt auch Beispieldaten an. Auf einem Server, der schon echte
> Nutzer:innen hat, vorher `server/src/seed.js` lesen.

The admin step only creates the admin. If an account with `ADMIN_EMAIL` or the username
`admin` already exists, it refuses, changes nothing and exits with code 1; it never promotes an
account or resets the admin's password. To run only the admin step:

```bash
docker compose exec node npm run seed:admin
```

`seed:admin` exits with code 1 when `ADMIN_EMAIL` or `ADMIN_PASSWORD` is empty. The usernames and
the e-mail domain the seed uses for its own accounts are reserved (`shared/reserved-accounts.json`):
nobody can register them.

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

## Laufender Betrieb

**Neue Version ausrollen** (nachdem sie auf GitHub in `main` ist):

```bash
git pull && docker compose up -d --build
```

Docker baut nur neu, was sich geändert hat, und tauscht die Container aus. Die
Datenbank und die Uploads bleiben dabei erhalten (sie liegen in `db-data` bzw.
`deploy/storage/` und `deploy/storage-private/`).

Coming from a version without the AI moderation key, its daily call limit and the retention
settings: add `ANTHROPIC_API_KEY`, `MODERATION_DAILY_CALL_LIMIT` and the four `*_RETENTION_DAYS`
settings to `deploy/.env` first (step 4), or the new version does not start.

**Logs mitlesen:**

```bash
docker compose logs -f api node
```

**Datenbank sichern** – bitte einrichten, das ist der einzige unersetzliche Teil:

```bash
docker compose exec db sh -c 'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" goenntertainment' > backup-$(date +%F).sql
```

Die Nutzer-Uploads liegen in `deploy/storage/` und gehören ins selbe Backup. Am
besten als täglicher Cronjob plus Hetzner-Snapshot (~1 €/Monat).

Ban evidence, the AI moderation's evidence and story images lie in `deploy/storage-private/`
(F-11): only the node service mounts it, and Node serves those files only to who may see them.
It belongs in the backup too, and it must never be mounted into a web server. Files an older
version left in `deploy/storage/evidence` or `deploy/storage/stories` are moved there when node
starts.

**Firewall:** Nur 22 (SSH), 80 und 443 müssen offen sein. MySQL, Laravel und
Node haben absichtlich **keine** Ports nach außen – erreichbar ist nur Caddy.

## Wenn etwas nicht startet

| Meldung | Ursache |
|---|---|
| `APP_KEY fehlt in deploy/.env` | Schritt 4: `APP_KEY` erzeugen und eintragen |
| `api` bleibt „unhealthy" | `docker compose logs api` – meist falsches `DB_PASSWORD` |
| Uploads scheitern mit „Serverfehler" | `docker compose logs storage-init` – der Upload-Ordner gehört nicht UID 1000 |
| „Das Bild ist zu groß" | Bild über 5 MB – die Grenze zieht das Node-Backend |

## Geprüft wird automatisch

Bei jedem Push baut GitHub beide Abbilder, startet alles (ohne Caddy) und
spielt eine Registrierung samt Bild-Upload durch – siehe
`.github/workflows/docker.yml`. Läuft das grün, bauen und starten die Container
auch auf dem Server.
