# Änderungen – kurz für dich (Shawn)

Hier steht in einfachen Worten, was ich in der App gemacht habe. Neueste zuletzt.

---

## 1) Backend-API gebaut (im Laravel-Projekt, nicht hier)

Damit die Handy-App sich überhaupt anmelden kann, hat das Laravel-Projekt jetzt
eine „API": eigene Adressen, über die die App **Registrieren, Login, Logout** und
„wer bin ich" macht. Die App bekommt beim Login einen **Schlüssel (Token)** und
schickt den ab dann bei jeder Anfrage mit. Das lief in einem eigenen Pull Request
und ist schon zusammengeführt.

## 2) App an die API angebunden

- Die App kann sich jetzt **registrieren und einloggen** – echte Daten, echter Server.
- Der Token wird **sicher gespeichert**, du bleibst also eingeloggt.
- Neue Aufteilung: **ausgeloggt** siehst du Willkommen/Login/Registrieren, **eingeloggt**
  die App (Home). Das schaltet automatisch um.
- **Home** zeigt deine echten Daten (Name, Benutzername, Konto-Typ) und einen Abmelden-Knopf.
- Getestet: Registrieren → Home, Abmelden → Willkommen, Login → Home. Hat funktioniert.

## 3) Altes Design + Login-Overlay zurückgeholt

- Der **weiche Pastell-Hintergrund**, der **Lila-Pink-Schriftzug** „Gönntertainment" und
  das **Maskottchen** (die kleinen Kreise) sind wieder da – wie auf der alten Webseite.
- Das **Login-Fenster fährt von unten hoch** (das „Overlay"), genau wie früher.
- **Willkommen** und **Registrieren** sehen wieder im alten Stil aus.
- Die extra Login-Seite habe ich entfernt – Login passiert jetzt im hochfahrenden Fenster,
  so wie im Original.
- Getestet: Login über das Overlay → Home. Hintergrund, Verlauf und Maskottchen werden
  sauber angezeigt, keine Fehler.

## 4) Dein Feedback zum Start-Bildschirm umgesetzt

- **„GÖ" sticht jetzt heraus**: die ersten beiden Buchstaben sind viel größer, das „Ö"
  ist groß geschrieben → **GÖ**nntertainment.
- **Der Anmelde-Knopf ist weg.** Anmelden geht jetzt nur noch durchs **Hochwischen** –
  und der graue Text sagt das jetzt klar: „↑ Nach oben wischen zum Anmelden".
- **Die umarmenden Figuren sind größer und weiter unten**; der Titel sitzt oben, es ist
  nicht mehr alles in der Mitte.
- **Der graue Strich ganz unten ist entfernt.**

Getestet: Start-Bildschirm sieht wie gewünscht aus, und Anmelden über das hochfahrende
Fenster führt weiter auf die Home-Seite.

## 5) Neuer, kürzerer Name: GÖ4Fun

Aus „Gönntertainment" ist **GÖ4Fun** geworden (kürzer, geht leichter von der Zunge:
GÖ = gönn, „4Fun" = for Fun). Das **GÖ** ist groß hervorgehoben – auf der Startseite
und oben auf der Home-Seite. Der alte Name ist überall ersetzt.

Nur der interne Projektname (für die Technik) bleibt gleich – geändert ist der Name,
den du in der App **siehst**.

## 6) GÖ4Fun als Logo + bewegter Hintergrund

- **GÖ4Fun sieht jetzt aus wie ein Logo**: „GÖ" im Farbverlauf, die **4** sitzt in einer
  runden farbigen Kugel (Badge), „Fun" kräftig daneben. Auf Start- und Home-Seite.
- **Der Hintergrund hat jetzt bunte Kugeln, die sich langsam wie Wellen bewegen** –
  ein weiches, fließendes Driften.

Wichtig / ehrlich: Die **Bewegung** konnte ich in meinem Test-Browser **nicht anschauen**
(der zeigt keine laufenden Bilder). Auf dem **Handy läuft die Animation** aber. Schau's
dir in Expo Go an – wenn's zu schnell, zu langsam oder zu stark ist, sag Bescheid, dann
stelle ich Tempo und Stärke nach.

## 7) Logo flowiger + Hintergrund aus deiner Referenz

- **Das eckige Badge-Logo ist weg.** Jetzt ist es ein weiches Wortbild: „GÖ" im
  Farbverlauf, „4Fun" in ruhigem Grau daneben – fließend, wie in deinem Bild.
- **Der Hintergrund ist wie in deiner Referenz**: heller Pastellton, ein Pfirsich-Schein
  oben rechts, zwei schwebende Kreise und **lila Wellen unten**, die sich langsam
  hin und her bewegen.

Wie vorher: die **Bewegung** sehe ich in meinem Test-Browser nicht (technische Grenze),
auf dem **Handy läuft sie**. Bitte am Handy anschauen und sagen, ob Tempo/Stärke passen.

## 8) Logo in fließender Schrift

Statt gerader Blockschrift ist „GÖ4Fun" jetzt in einer **geschwungenen Schrift**
geschrieben (wie das „flow"-Logo, das du geschickt hast) – im Farbverlauf, mit dem
großen GÖ, das durch die Großbuchstaben heraussticht. Name bleibt GÖ4Fun.

---

## Was noch offen ist

- Die **Home-Seite** hat noch nicht den Pastell-Look (nur die Willkommens-/Login-Seiten).
- **Google-Login** in der App – braucht noch deinen eigenen Google-Zugang.
- **Interessen** bei der Registrierung – dafür fehlt im Backend noch eine Adresse.
- **Passwort vergessen** und echte **Aktivitäten** aus dem Server (statt Beispiel-Daten).

## Wo ich die Schritte sonst noch festhalte

- Genauere, technische Version: `change/ai.md` (im selben Ordner).
- Jeder Speicherpunkt (Commit) in der Git-Historie und im Pull Request #1 auf GitHub.

## 9) Rest vom alten Backend nach JS geholt

Der Kern des Backends (Anmelden, Google, Interessen, Aktivitäten inkl. Beitreten) war schon
in JavaScript im Ordner `server/` – du siehst ihn in Cursor. Gefehlt haben noch drei Dinge,
die ich jetzt aus dem alten Laravel nachgezogen habe:

- **Datenbank-Bauplan** (`server/schema.sql`): legt alle Tabellen an, ganz ohne Laravel.
- **Start-Daten** (`server/src/seed.js`): die Interessen-Liste und der Admin-Zugang. Starten mit
  `npm run seed` im Ordner `server`.
- **Passwort vergessen** (im Backend): nimmt die E-Mail an und setzt mit einem Link ein neues
  Passwort. Getestet und funktioniert.

Ehrlich / noch offen:
- Der **E-Mail-Versand** braucht noch einen Mail-Zugang (SMTP) – eigener Schritt. Bis dahin
  steht der Link nur in der Server-Konsole (zum Testen).
- Der **„Passwort vergessen"-Screen** in der App zeigt bisher nur eine Bestätigung, ruft das
  neue Backend aber noch nicht auf. Kann ich als nächstes anbinden, wenn du willst.

Damit kann das alte Laravel jetzt komplett weg – alles läuft in `server/`.

## 10) „Passwort vergessen" hängt jetzt am echten Backend

Der Screen zeigt nicht mehr nur eine Bestätigung, sondern schickt die E-Mail wirklich an
den neuen Server. Läuft und ist geprüft. (Der echte Mail-Versand per SMTP bleibt der letzte
offene Schritt.)

## 11) App lud keine Accounts mehr → Backend war schlicht nicht gestartet

**Was war los?** Die App konnte sich nicht mehr mit dem Server verbinden und hat
keine Accounts/Aktivitäten geladen.

**Warum?** Seit der Umstellung von Laravel auf das neue Backend im Ordner `server/`
muss dieser Server von Hand gestartet werden. Das alte Laravel lief bei dir über
Herd quasi immer im Hintergrund – das neue Node-Backend nicht. Es lief einfach
nichts auf Port 8000, deshalb kam die App an keine Daten (Fehler „Keine Verbindung
zum Server").

**Geprüft:** Sobald das Backend läuft, ist alles heil – Datenbank verbindet,
Login/Registrieren/Interessen/Aktivitäten antworten, 5 Accounts sind in der DB.
Es war also kein Programmfehler, sondern der Server war nur aus.

**Was ich geändert habe, damit das nicht wieder passiert:**
- Neuer Ein-Wort-Befehl im Hauptordner: **`npm run server`** startet das Backend
  (musst du nicht mehr erst in den `server`-Ordner wechseln). Zum Befüllen der
  Datenbank: `npm run server:seed`.
- Die README erklärt jetzt oben: **erst Backend starten, dann die App.**

**So startest du künftig alles (zwei Terminals):**
1. `npm run server`  → Backend (Port 8000), muss laufen bleiben
2. `npx expo start`  → die App

Wenn in der App „Keine Verbindung zum Server" steht, läuft Schritt 1 nicht.

## 12) Backend war spürbar langsam → zwei Bremsen entfernt

Du fandest den Server „unfassbar langsam". Der Code selbst war schnell (~5 ms pro
Anfrage) – es waren zwei konkrete Stellen, beide jetzt behoben:

**a) `localhost` kostete ~200 ms pro Anfrage (Windows-Eigenheit).**
`localhost` wird unter Windows zuerst als IPv6 (`::1`) probiert, der Server lauschte
aber nur auf IPv4 → jede Anfrage lief in einen Fehlversuch und danach erst auf
`127.0.0.1`. Der Server lauscht jetzt auf beidem (IPv4 **und** IPv6).
→ `localhost` von ~210 ms auf **~4 ms**.

**b) Login/Registrieren blockierten den ganzen Server.**
Die Passwort-Prüfung (bcrypt) lief „synchron" – das legt bei jedem Login für ~0,3 s
den kompletten Server lahm, auch für alle anderen. Jetzt läuft sie nebenher
(nicht-blockierend) und mit einem bewährten, etwas schnelleren Sicherheits-Level.
→ Login von ~313 ms (blockierend) auf **~85 ms**, Registrieren auf **~131 ms**.

Am Rande gelernt: Den Server **immer** mit `npm run server` starten (nicht per Hand
aus dem Hauptordner) – sonst findet er die Zugangsdaten in `server/.env` nicht und
meldet „Access denied … using password: NO".
